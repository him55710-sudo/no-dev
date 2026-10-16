import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { AnalysisClient } from "./analysisClient";
import {
  sha256,
  sourceNode,
  structureLimits,
  type StructureGraph,
} from "../../src/workspace/model";
import {
  specForTargets,
  acceptBaseline,
  baselineRequestSchema,
  prepareChange,
  saveSpec,
  specContentSchema,
  specDocumentSchema,
  type SpecDocument,
} from "../../src/workspace/spec";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import { ImplementationJobs } from "./agent/jobs";
import { availableChecks } from "./agent/verify";

const requestSchema = z
  .object({
    id: z.string().max(100),
    action: z.enum([
      "ready",
      "refresh",
      "source",
      "saveSpec",
      "acceptBaseline",
      "implement",
      "cancelJob",
      "decideJob",
      "jobDiff",
      "applyJob",
      "undoJob",
      "recoverJob",
      "restoreJob",
      "jobHistory",
    ]),
    payload: z.unknown().optional(),
  })
  .strict();
const saveSchema = z
  .object({
    specId: z.string().min(1).max(4096).optional(),
    targetIds: z.array(z.string().max(4096)).min(1).max(100),
    content: specContentSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const excluded =
  "**/{node_modules,.git,.next,dist,build,coverage,vendor,release,test-results,.vscode-test,.pureobom}/**";
const included =
  "**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,json,jsonc,md,py,go,rs,java,cs,html,css,sql}";

export class DesignWorkspace implements vscode.Disposable {
  readonly changes = new vscode.EventEmitter<DesignWorkspaceState>();
  state: DesignWorkspaceState = {
    busy: false,
    stale: false,
    projectName: "",
    selectedId: "system",
    specs: { schemaVersion: 1, specs: [] },
    notices: [],
    trusted: vscode.workspace.isTrusted,
  };
  private panel?: vscode.WebviewPanel;
  private folder?: vscode.WorkspaceFolder;
  private worker: AnalysisClient;
  private jobs: ImplementationJobs;
  private diffContents = new Map<string, string>();
  private serial = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private saving = false;
  private diskDesign = "";
  private disposables: vscode.Disposable[] = [];
  constructor(private context: vscode.ExtensionContext) {
    this.worker = new AnalysisClient(context.asAbsolutePath("out/worker.cjs"));
    this.jobs = new ImplementationJobs(
      resolve(context.globalStorageUri.fsPath, "implementation-jobs"),
      (job) => {
        this.state.job = job;
        this.emit();
      },
    );
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        "pureobom-design-diff",
        {
          provideTextDocumentContent: (uri) =>
            this.diffContents.get(uri.toString()) ?? "",
        },
      ),
    );
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const changed = (uri: vscode.Uri) => {
      if (!this.panel || !this.folder || uri.scheme !== "file") return;
      const path = relative(this.folder.uri.fsPath, uri.fsPath).replaceAll(
        sep,
        "/",
      );
      if (
        path.startsWith("../") ||
        isAbsolute(path) ||
        path
          .split("/")
          .some((p) =>
            [
              "node_modules",
              ".git",
              ".next",
              "dist",
              "build",
              "coverage",
              "release",
              "test-results",
              ".vscode-test",
              ".pureobom",
            ].includes(p),
          )
      )
        return;
      if (
        !/\.(?:[cm]?[jt]sx?|jsonc?|md|py|go|rs|java|cs|html|css|sql)$/.test(
          path,
        )
      )
        return;
      this.state.stale = true;
      this.serial++;
      this.emit();
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => void this.refresh().catch((e) => this.fail(e)),
        700,
      );
    };
    this.disposables.push(
      watcher,
      watcher.onDidCreate(changed),
      watcher.onDidDelete(changed),
      watcher.onDidChange(changed),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length) changed(e.document.uri);
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.state.trusted = true;
        this.emit();
      }),
    );
  }
  private emit() {
    this.changes.fire(this.state);
    void this.panel?.webview.postMessage({
      type: "workspaceState",
      state: this.state,
    });
  }
  private fail(error: unknown) {
    this.state.busy = false;
    this.state.error = error instanceof Error ? error.message : String(error);
    this.emit();
  }
  async open(revealCurrent = false) {
    const editor = vscode.window.activeTextEditor;
    const folder =
      (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) ??
      vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== "file")
      throw Error("로컬 프로젝트 폴더를 먼저 열어 주세요.");
    if (this.folder?.uri.toString() !== folder.uri.toString()) {
      if (this.jobs.isRunning || this.saving)
        throw Error("진행 중인 구현 작업이 끝난 뒤 프로젝트를 바꿔 주세요.");
      this.jobs.dispose();
      this.jobs = new ImplementationJobs(
        resolve(this.context.globalStorageUri.fsPath, "implementation-jobs"),
        (job) => {
          this.state.job = job;
          this.emit();
        },
      );
      this.folder = folder;
      this.diskDesign = "";
      this.state = {
        busy: false,
        stale: false,
        projectName: folder.name,
        selectedId: "system",
        specs: { schemaVersion: 1, specs: [] },
        notices: [],
        trusted: vscode.workspace.isTrusted,
      };
      await this.loadDesign();
      await this.loadJobHistory();
    }
    if (!this.panel) {
      const panel = (this.panel = vscode.window.createWebviewPanel(
        "pureobom.design",
        "풀어봄 · 시스템 설계",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, "media"),
          ],
        },
      ));
      panel.webview.html = this.html(panel.webview);
      const receiver = panel.webview.onDidReceiveMessage(async (raw) => {
        let id: string | undefined;
        try {
          const request = requestSchema.parse(raw);
          id = request.id;
          const result = await this.handleRequest(request);
          void panel.webview.postMessage({ type: "response", id, result });
        } catch (error) {
          void panel.webview.postMessage({
            type: "response",
            id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      panel.onDidDispose(() => {
        receiver.dispose();
        if (this.panel === panel) this.panel = undefined;
      });
    } else this.panel.reveal(vscode.ViewColumn.One);
    await this.refresh();
    if (revealCurrent && editor && this.state.graph) {
      const path = relative(
        folder.uri.fsPath,
        editor.document.uri.fsPath,
      ).replaceAll(sep, "/");
      this.state.selectedId =
        sourceNode(
          this.state.graph,
          path,
          editor.document.offsetAt(editor.selection.active),
        )?.id ?? "system";
      this.emit();
    }
  }
  /** The Webview and host API share the same validation and execution guards. */
  async handleRequest(raw: unknown) {
    const request = requestSchema.parse(raw);
    let result: unknown;
    if (request.action === "ready") this.emit();
    else if (request.action === "refresh") await this.refresh();
    else if (request.action === "source") {
      const payload = z
        .object({
          nodeId: z.string().max(4096),
          sourceIndex: z.number().int().nonnegative().default(0),
        })
        .strict()
        .parse(request.payload);
      await this.source(payload.nodeId, payload.sourceIndex);
    } else if (request.action === "saveSpec")
      result = await this.save(request.payload);
    else if (request.action === "acceptBaseline")
      result = await this.acceptBaseline(request.payload);
    else if (request.action === "implement")
      result = await this.implement(request.payload);
    else if (request.action === "jobHistory") await this.loadJobHistory();
    else if (request.action === "restoreJob") {
      const payload = z
        .object({ workspaceId: z.string().uuid() })
        .strict()
        .parse(request.payload);
      if (!this.folder) throw Error("프로젝트가 없습니다.");
      await this.jobs.restore(this.folder.uri.fsPath, payload.workspaceId);
    } else if (request.action === "cancelJob") this.jobs.cancel();
    else if (request.action === "decideJob") {
      const payload = z
        .object({
          jobId: z.string(),
          id: z.string(),
          decision: z.enum(["accept", "decline", "cancel"]),
        })
        .strict()
        .parse(request.payload);
      if (payload.jobId !== this.state.job?.id)
        throw Error("현재 작업의 승인 요청이 아닙니다.");
      this.jobs.decide(payload.id, payload.decision);
    } else if (request.action === "jobDiff") {
      const payload = z
        .object({
          reviewId: z.string(),
          index: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.payload);
      if (payload.reviewId !== this.state.job?.reviewId)
        throw Error("현재 검토 중인 작업이 아닙니다.");
      const file = this.jobs.file(payload.index);
      const uri = (side: "before" | "after") =>
        vscode.Uri.from({
          scheme: "pureobom-design-diff",
          path: `/${payload.reviewId}/${side}/${file.path}`,
        });
      for (const side of ["before", "after"] as const)
        this.diffContents.set(uri(side).toString(), file[side] ?? "");
      await vscode.commands.executeCommand(
        "vscode.diff",
        uri("before"),
        uri("after"),
        file.path,
        { preview: true },
      );
    } else {
      this.assertExecutionReady();
      const payload = z
        .object({ reviewId: z.string() })
        .strict()
        .parse(request.payload);
      const job = this.state.job;
      if (!job) throw Error("구현 작업이 없습니다.");
      if (request.action === "applyJob") {
        await this.loadDesign();
        this.emit();
        const current = this.state.specs.specs.find(
          (spec) => spec.id === job.specId,
        );
        if (
          current?.revision !== job.specRevision ||
          JSON.stringify(current) !== this.jobs.savedSpec
        )
          throw Error(
            "구현 중 설계가 바뀌었습니다. 새 설계로 다시 구현해 주세요.",
          );
        await this.jobs.apply(payload.reviewId);
      } else if (request.action === "recoverJob")
        await this.jobs.recover(payload.reviewId);
      else await this.jobs.undo(payload.reviewId);
      await this.refresh();
      await this.loadJobHistory();
    }
    return result;
  }
  async refresh() {
    if (!this.folder) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const serial = ++this.serial;
    const folder = this.folder;
    this.state.busy = true;
    this.state.error = undefined;
    this.emit();
    try {
      const rootPath = await realpath(folder.uri.fsPath);
      const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, included),
        excluded,
        structureLimits.files + 1,
      );
      if (uris.length > structureLimits.files)
        throw Error(
          "500개보다 많은 파일이 있습니다. 분석할 하위 프로젝트 폴더를 열어 주세요.",
        );
      const notices: string[] = [],
        files: { path: string; content: string }[] = [];
      let bytes = 0;
      for (const uri of uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
        const path = relative(folder.uri.fsPath, uri.fsPath).replaceAll(
          sep,
          "/",
        );
        if (path.split("/").some((p) => p.startsWith(".") && p !== ".github"))
          continue;
        const actual = await realpath(uri.fsPath);
        const rel = relative(rootPath, actual);
        if (rel.startsWith(".." + sep) || isAbsolute(rel)) {
          notices.push(`프로젝트 밖으로 연결된 파일 제외: ${path}`);
          continue;
        }
        const open = vscode.workspace.textDocuments.find(
          (doc) => doc.uri.toString() === uri.toString(),
        );
        const content = open ? open.getText() : await readFile(actual, "utf8");
        if (content.includes("\0")) {
          notices.push(`바이너리 파일 제외: ${path}`);
          continue;
        }
        const size = Buffer.byteLength(content, "utf8");
        if (size > structureLimits.fileBytes) {
          notices.push(`512KB를 초과한 파일 제외: ${path}`);
          continue;
        }
        bytes += size;
        if (bytes > structureLimits.bytes)
          throw Error(
            "프로젝트가 8MB 분석 범위를 초과했습니다. 하위 프로젝트 폴더를 열어 주세요.",
          );
        files.push({ path, content });
      }
      const graph = await this.worker.call<StructureGraph>("structure", {
        files,
      });
      const checks = (await availableChecks(folder.uri.fsPath)).names;
      if (serial !== this.serial || this.folder !== folder) return;
      this.state.graph = graph;
      this.state.checks = checks;
      this.state.notices = notices;
      this.state.stale = false;
      this.state.busy = false;
      this.emit();
    } catch (error) {
      if (serial === this.serial) this.fail(error);
      throw error;
    }
  }
  async source(nodeId: string, sourceIndex = 0) {
    const graph = this.state.graph;
    if (!this.folder || !graph || this.state.stale || this.state.busy)
      throw Error("분석이 갱신된 뒤 원문을 열어 주세요.");
    const item =
      graph.nodes.find((node) => node.id === nodeId) ??
      graph.edges.find((edge) => edge.id === nodeId);
    const ref = item?.sources[sourceIndex];
    if (!ref) throw Error("연결된 원문이 없습니다.");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(this.folder.uri, ref.path),
    );
    if ((await sha256(doc.getText())) !== ref.fileHash) {
      this.state.stale = true;
      this.emit();
      throw Error("원문이 바뀌었습니다. 구조를 새로 읽어 주세요.");
    }
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });
    const selection = new vscode.Selection(
      doc.positionAt(ref.start),
      doc.positionAt(ref.end),
    );
    editor.selection = selection;
    editor.revealRange(
      selection,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }
  private async designPath(create = false) {
    if (!this.folder) throw Error("프로젝트가 없습니다.");
    const directory = resolve(this.folder.uri.fsPath, ".pureobom");
    if (create) await mkdir(directory, { recursive: true });
    try {
      if ((await lstat(directory)).isSymbolicLink())
        throw Error("설계 폴더의 심볼릭 링크는 지원하지 않습니다.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const path = resolve(directory, "specs.json");
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw Error("설계 파일의 심볼릭 링크는 지원하지 않습니다.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return path;
  }
  private async readDesign(path: string) {
    try {
      const info = await lstat(path);
      if (info.size > 1024 * 1024)
        throw Error("설계 파일이 1MB를 초과했습니다.");
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }
  private async loadDesign() {
    const text = await this.readDesign(await this.designPath());
    this.state.specs = text
      ? specDocumentSchema.parse(JSON.parse(text))
      : { schemaVersion: 1, specs: [] };
    this.diskDesign = text;
  }
  async save(raw: unknown) {
    if (!vscode.workspace.isTrusted)
      throw Error("설계를 저장하려면 신뢰한 작업 공간이 필요합니다.");
    if (this.saving) throw Error("설계를 저장하는 중입니다.");
    const graph = this.state.graph;
    if (!graph || this.state.stale || this.state.busy)
      throw Error("현재 구조 분석이 완료된 뒤 저장해 주세요.");
    const payload = saveSchema.parse(raw);
    const previous = payload.specId
      ? this.state.specs.specs.find((spec) => spec.id === payload.specId)
      : undefined;
    if (payload.specId && !previous) throw Error("저장된 설계가 없습니다.");
    const original =
      previous ?? specForTargets(this.state.specs, graph, payload.targetIds);
    if (
      previous &&
      JSON.stringify(payload.targetIds) !== JSON.stringify(previous.targetIds)
    )
      throw Error(
        "설계 대상을 바꾸려면 기준 코드 비교에서 다시 연결해 주세요.",
      );
    const next: SpecDocument = saveSpec(
      this.state.specs,
      { ...original, content: payload.content },
      payload.expectedRevision,
    );
    this.saving = true;
    try {
      return await this.persistDesign(next, original.id);
    } finally {
      this.saving = false;
    }
  }
  async acceptBaseline(raw: unknown) {
    this.assertExecutionReady();
    if (this.saving) throw Error("설계를 저장하는 중입니다.");
    if (this.jobs.isRunning || this.state.job?.phase === "recovery")
      throw Error("진행 중인 구현·복구를 마친 뒤 기준 코드를 확정해 주세요.");
    const request = baselineRequestSchema.parse(raw);
    const folder = this.folder;
    this.saving = true;
    try {
      // Re-scan instead of trusting a potentially delayed filesystem event.
      await this.refresh();
      this.assertExecutionReady();
      const graph = this.state.graph;
      if (
        !graph ||
        this.state.busy ||
        this.state.stale ||
        this.folder !== folder
      )
        throw Error("구조 분석이 갱신 중입니다. 비교를 다시 열어 주세요.");
      const serial = this.serial;
      // Clean editor buffers can briefly lag disk changes. Check physical bytes too.
      const root = await realpath(folder!.uri.fsPath);
      for (const file of graph.files) {
        const path = await realpath(resolve(root, file.path));
        const rel = relative(root, path);
        if (
          rel.startsWith(".." + sep) ||
          isAbsolute(rel) ||
          (await sha256(await readFile(path, "utf8"))) !== file.hash
        )
          throw Error("검토 중 코드가 바뀌었습니다. 비교를 다시 열어 주세요.");
      }
      const next = acceptBaseline(this.state.specs, graph, request);
      return await this.persistDesign(next, request.specId, () => {
        this.assertExecutionReady();
        if (this.serial !== serial || this.folder !== folder)
          throw Error("검토 중 코드가 바뀌었습니다. 비교를 다시 열어 주세요.");
      });
    } finally {
      this.saving = false;
    }
  }
  private async persistDesign(
    next: SpecDocument,
    specId: string,
    validate = () => {},
  ) {
    const folder = this.folder;
    let temporary: string | undefined;
    try {
      const path = await this.designPath(true);
      const current = await this.readDesign(path);
      if (current !== this.diskDesign) {
        await this.loadDesign();
        this.emit();
        throw Error(
          "설계 파일이 외부에서 바뀌었습니다. 저장된 내용을 다시 열어 비교해 주세요.",
        );
      }
      const text = JSON.stringify(next, null, 2) + "\n";
      if (Buffer.byteLength(text, "utf8") > 1024 * 1024)
        throw Error(
          "설계와 기준선 기록이 1MB를 초과합니다. 기존 기록을 보관한 뒤 정리해 주세요.",
        );
      validate();
      temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temporary, text, { flag: "wx" });
      if ((await this.readDesign(path)) !== current)
        throw Error(
          "저장 중 설계 파일이 외부에서 바뀌었습니다. 다시 열어 비교해 주세요.",
        );
      validate();
      if (this.folder !== folder)
        throw Error("저장 중 프로젝트가 바뀌었습니다.");
      await rename(temporary, path);
      temporary = undefined;
      this.diskDesign = text;
      this.state.specs = next;
      this.emit();
      return next.specs.find((spec) => spec.id === specId)!;
    } finally {
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  private assertExecutionReady() {
    if (!this.folder || !vscode.workspace.isTrusted)
      throw Error("신뢰한 로컬 프로젝트에서만 구현할 수 있습니다.");
    const dirty = vscode.workspace.textDocuments.filter(
      (doc) =>
        doc.uri.scheme === "file" &&
        doc.isDirty &&
        vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.toString() ===
          this.folder!.uri.toString(),
    );
    if (dirty.length)
      throw Error(
        "편집 중인 파일을 저장한 뒤 구현·반영해 주세요. 저장되지 않은 내용을 덮어쓰지 않습니다.",
      );
  }
  async implement(raw: unknown) {
    this.assertExecutionReady();
    if (this.jobs.isRunning)
      throw Error("현재 구현 작업이 끝난 뒤 다시 시작해 주세요.");
    const payload = saveSchema
      .extend({
        allowExternal: z.literal(true),
        checks: z
          .array(z.enum(["test", "build", "typecheck", "check"]))
          .min(1)
          .max(4),
      })
      .strict()
      .parse(raw);
    const available = (await availableChecks(this.folder!.uri.fsPath)).names;
    if (payload.checks.some((name) => !available.includes(name)))
      throw Error("선택한 검사 명령이 프로젝트에 없습니다.");
    const saved = await this.save({
      specId: payload.specId,
      targetIds: payload.targetIds,
      content: payload.content,
      expectedRevision: payload.expectedRevision,
    });
    const change = prepareChange(saved, this.state.graph!, "behavior")!;
    const configuration = vscode.workspace.getConfiguration("pureobom");
    return this.jobs.start(this.folder!.uri.fsPath, change, {
      executable: configuration.get<string>("codexPath") || "codex",
      model: configuration.get<string>("codexModel") || undefined,
      checks: [...new Set(payload.checks)],
      allowExternal: payload.allowExternal,
      specSnapshot: saved,
    });
  }
  async loadJobHistory() {
    if (!this.folder) return;
    const history = await this.jobs.history(this.folder.uri.fsPath);
    this.state.jobHistory = history.entries;
    this.state.jobHistoryErrors = history.errors;
    this.emit();
  }
  private html(webview: vscode.Webview) {
    const nonce = randomBytes(24).toString("base64");
    const resource = (name: string) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", name),
      );
    return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"><link rel="stylesheet" href="${resource("design.css")}"><title>풀어봄 · 시스템 설계</title></head><body><div id="root"></div><script nonce="${nonce}" src="${resource("design.js")}"></script></body></html>`;
  }
  dispose() {
    clearTimeout(this.timer);
    this.serial++;
    this.panel?.dispose();
    this.worker.dispose();
    this.jobs.dispose();
    this.changes.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
