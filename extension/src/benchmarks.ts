import * as vscode from "vscode";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  resolve,
  basename,
  extname,
} from "node:path";
import {
  compareBenchmarks,
  type BenchmarkResult,
} from "../../src/core/benchmark";
import {
  executionSettings,
  ignoredCheckDirectories,
  ProjectChecks,
  type ProjectCheck,
} from "./projectChecks";
import { runBenchmark, type CommandPlan } from "./benchmarkRunner";

const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
export type BenchmarkPlan = {
  id: string;
  name: string;
  file: string;
  folder: string;
  argv: string[];
  cwd: string;
  python: string;
};
export type Measurement = BenchmarkPlan & {
  sourceSha256: string;
  startedAt: string;
  result: BenchmarkResult;
  check?: ProjectCheck;
};
export type BenchmarkState = {
  status: "idle" | "running" | "stopping" | "complete" | "failed" | "cancelled";
  phase?: "baseline" | "candidate";
  completed: number;
  baseline?: Measurement;
  candidate?: Measurement;
  invalidReason?: string;
  candidateStale?: boolean;
  error?: string;
};
type Prepared = {
  view: BenchmarkPlan;
  taskId: string;
  identity: string;
  sourceSha256: string;
  context: string | undefined;
  uri: vscode.Uri;
  folderUri: vscode.Uri;
  task: vscode.Task;
  settings: string;
  command: CommandPlan;
  script: string;
};

/** Measures an existing reviewed process task; never generates commands from model output. */
export class Benchmarks implements vscode.Disposable {
  readonly changes = new vscode.EventEmitter<BenchmarkState>();
  state: BenchmarkState = { status: "idle", completed: 0 };
  private prepared?: Prepared;
  private baselinePlan?: Prepared;
  private active?: { abort: AbortController; plan: Prepared };
  private disposed = false;
  private subscriptions: vscode.Disposable[] = [];
  constructor(
    private checks: ProjectChecks,
    private script = join(__dirname, "../runtime/benchmark.py"),
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.subscriptions.push(
      watcher,
      watcher.onDidChange((uri) => this.changed(uri)),
      watcher.onDidCreate((uri) => this.changed(uri)),
      watcher.onDidDelete((uri) => this.changed(uri)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length) this.changed(e.document.uri);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.invalidate("프로젝트 폴더 변경 / Workspace folders changed"),
      ),
      vscode.workspace.onDidChangeConfiguration(() => {
        const plan = this.active?.plan || this.baselinePlan;
        if (
          plan &&
          (executionSettings(plan.task) !== plan.settings ||
            this.python() !== plan.view.python)
        )
          this.invalidate("실행 설정 변경 / Execution settings changed");
      }),
    );
  }
  private publish(next: Partial<BenchmarkState>) {
    this.state = { ...this.state, ...next };
    if (!this.disposed) this.changes.fire(this.state);
  }
  private python() {
    return (
      vscode.workspace
        .getConfiguration("pureobom")
        .get<string>("benchmarkPython", "")
        .trim() || (process.platform === "win32" ? "python" : "python3")
    );
  }
  private invalidate(reason: string) {
    if (this.active || this.state.baseline)
      this.publish({ invalidReason: reason });
    if (this.active) this.cancel();
  }
  private changed(uri: vscode.Uri) {
    const plan = this.active?.plan || this.baselinePlan;
    if (!plan) return;
    if (uri.toString() === plan.uri.toString()) {
      if (this.active)
        this.invalidate("측정 중 파일 변경 / File changed during measurement");
      else if (this.state.candidate) this.publish({ candidateStale: true });
      return; // Editing the selected file between phases is expected.
    }
    if (
      vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !==
      plan.folderUri.toString()
    )
      return;
    const parts = uri.path.slice(plan.folderUri.path.length).split("/");
    if (!parts.some((part) => ignoredCheckDirectories.has(part)))
      this.invalidate("다른 프로젝트 파일 변경 / Another project file changed");
  }
  private async resolvePlan(
    context: string | undefined,
    taskId: string,
  ): Promise<Prepared> {
    const {
      selected: task,
      doc,
      folder,
      bytes,
    } = await this.checks.select(context, taskId);
    const execution = task.execution;
    const version = doc.version;
    if (!(execution instanceof vscode.ProcessExecution))
      throw Error(
        "측정은 process 작업만 지원합니다. / Measurement requires a process task, not a shell task.",
      );
    const config = vscode.workspace.getConfiguration(undefined, folder.uri);
    if (config.get("terminal.integrated.inheritEnv") === false)
      throw Error(
        "측정에는 환경 상속이 필요합니다. / Measurement requires terminal.integrated.inheritEnv.",
      );
    const interpolate = (value: string) =>
      value.replace(/\$\{([^}]+)\}/g, (_all, key: string) => {
        const known: Record<string, string> = {
          workspaceFolder: folder.uri.fsPath,
          workspaceFolderBasename: folder.name,
          file: doc.uri.fsPath,
          fileDirname: dirname(doc.uri.fsPath),
          fileBasename: basename(doc.uri.fsPath),
          fileBasenameNoExtension: basename(
            doc.uri.fsPath,
            extname(doc.uri.fsPath),
          ),
          fileExtname: extname(doc.uri.fsPath),
          relativeFile: doc.uri.fsPath.slice(folder.uri.fsPath.length + 1),
          pathSeparator: process.platform === "win32" ? "\\" : "/",
        };
        if (Object.hasOwn(known, key)) return known[key];
        if (key.startsWith("env:")) return process.env[key.slice(4)] || "";
        if (key.startsWith("config:")) {
          const setting = config.get(key.slice(7));
          if (
            typeof setting === "string" ||
            typeof setting === "number" ||
            typeof setting === "boolean"
          )
            return String(setting);
        }
        throw Error(
          `지원하지 않는 작업 변수 / Unsupported task variable: ${key}`,
        );
      });
    const platform =
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "osx"
          : "linux";
    const overrides = {
      ...config.get<Record<string, string | null>>(
        `terminal.integrated.env.${platform}`,
        {},
      ),
      ...execution.options?.env,
    };
    const env: Record<string, string | null> = Object.create(null);
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== null && typeof value !== "string")
        throw Error("Invalid task environment");
      env[key] = value === null ? null : interpolate(value);
    }
    const command = {
      argv: [execution.process, ...execution.args].map(interpolate),
      cwd: resolve(
        folder.uri.fsPath,
        interpolate(execution.options?.cwd || folder.uri.fsPath),
      ),
      env,
    };
    if (
      !command.argv[0] ||
      !isAbsolute(command.cwd) ||
      /\.(cmd|bat)$/i.test(command.argv[0])
    )
      throw Error(
        "네이티브 실행 파일을 선택하세요. / Choose a native executable, not a batch file.",
      );
    const python = this.python(),
      settings = executionSettings(task);
    const identity = hash(
      JSON.stringify({
        command,
        python,
        settings,
        script: hash(await readFile(this.script)),
        hostEnvironment: process.env,
        uri: doc.uri.toString(),
      }),
    );
    this.checks.confirm(context, doc, version);
    if (executionSettings(task) !== settings || this.python() !== python)
      throw Error("Measurement settings changed. Prepare again.");
    return {
      view: {
        id: randomUUID(),
        name: task.name,
        file: doc.uri.path.slice(folder.uri.path.length + 1),
        folder: folder.name,
        argv: command.argv,
        cwd: command.cwd,
        python,
      },
      taskId,
      identity,
      sourceSha256: hash(bytes),
      context,
      uri: doc.uri,
      folderUri: folder.uri,
      task,
      settings,
      command,
      script: this.script,
    };
  }
  async prepare(
    context: string | undefined,
    taskId: string,
  ): Promise<BenchmarkPlan> {
    if (this.active) throw Error("A measurement is already running.");
    const plan = await this.resolvePlan(context, taskId);
    if (this.active || this.disposed)
      throw Error("Measurement state changed. Try again.");
    this.prepared = plan;
    return plan.view;
  }
  async start(
    context: string | undefined,
    id: string,
    phase: unknown,
    reviewed: unknown,
  ) {
    if (this.disposed || this.active)
      throw Error("A measurement is already running or closed.");
    if (reviewed !== true)
      throw Error(
        "8회 실행할 명령을 먼저 확인하세요. / Review the command before running it eight times.",
      );
    if (phase !== "baseline" && phase !== "candidate")
      throw Error("Invalid measurement phase");
    const previous = this.prepared;
    if (!previous || previous.view.id !== id || previous.context !== context)
      throw Error(
        "측정 명령을 다시 확인하세요. / Prepare the measurement again.",
      );
    const plan = await this.resolvePlan(context, previous.taskId);
    if (
      plan.identity !== previous.identity ||
      plan.sourceSha256 !== previous.sourceSha256
    )
      throw Error(
        "명령 또는 파일이 바뀌었습니다. / Command or file changed; prepare again.",
      );
    if (this.active || this.disposed)
      throw Error("Measurement state changed. Try again.");
    if (
      phase === "candidate" &&
      (!this.state.baseline ||
        this.state.invalidReason ||
        this.baselinePlan?.identity !== plan.identity)
    )
      throw Error(
        "같은 파일·명령·조건의 변경 전 측정이 필요합니다. / Record a baseline with the same file, command and conditions.",
      );
    const lease = this.checks.reserveMeasurement();
    const active = { abort: new AbortController(), plan };
    this.active = active;
    this.prepared = undefined;
    if (phase === "baseline") {
      this.baselinePlan = plan;
      this.state = { status: "idle", completed: 0 };
    }
    this.publish({
      status: "running",
      phase,
      completed: 0,
      error: undefined,
      candidate: undefined,
      candidateStale: false,
    });
    const startedAt = new Date().toISOString();
    const check = this.checks.evidence(plan.uri, plan.sourceSha256);
    void (async () => {
      try {
        const result = await runBenchmark(
          plan.view.python,
          plan.script,
          plan.command,
          active.abort.signal,
          (completed) => this.publish({ completed }),
        );
        if (active.abort.signal.aborted) throw Error("Measurement cancelled");
        if (hash(await readFile(plan.uri.fsPath)) !== plan.sourceSha256)
          throw Error("측정 중 파일 변경 / File changed during measurement");
        // Config events and file events can arrive while the final file is read.
        if (active.abort.signal.aborted || this.state.invalidReason)
          throw Error(this.state.invalidReason || "Measurement cancelled");
        const measurement: Measurement = {
          ...plan.view,
          sourceSha256: plan.sourceSha256,
          startedAt,
          result,
          check,
        };
        this.publish({ status: "complete", [phase]: measurement });
      } catch (e) {
        this.publish({
          status: active.abort.signal.aborted ? "cancelled" : "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        lease.dispose();
        if (this.active === active) this.active = undefined;
      }
    })();
    return { id: plan.view.id };
  }
  cancel() {
    if (!this.active) return;
    this.publish({ status: "stopping" });
    this.active.abort.abort();
  }
  report() {
    if (!this.state.baseline) throw Error("No completed baseline to export");
    const { baseline, candidate, invalidReason, candidateStale } = this.state;
    return {
      schema: 1,
      recordedAt: new Date().toISOString(),
      scope:
        "One command, 1 warm-up + 7 fresh processes per phase. OS peak process memory. Observed ranges, not confidence intervals. Output equality is not behavioral equivalence. Project change observation excludes generated/dependency folders and external inputs.",
      baseline,
      candidate,
      invalidReason,
      candidateStale,
      comparison:
        candidate && !invalidReason && !candidateStale
          ? compareBenchmarks(baseline.result, candidate.result)
          : undefined,
    };
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.subscriptions.forEach((s) => s.dispose());
    this.changes.dispose();
  }
}
