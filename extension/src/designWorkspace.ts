import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
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
  type LivingSpec,
} from "../../src/workspace/spec";
import {
  cleanDraft,
  draftMatches,
  draftWriteSchema,
  draftIdentitySchema,
  draftRebaseSchema,
  type DesignDraft,
} from "../../src/workspace/drafts";
import { DesignDrafts } from "./designDrafts";
import { ExecutionProfiles } from "./executionProfiles";
import { CodexAppServer } from "./agent/appServer";
import {
  executionContextSchema,
  executionUseSchema,
  saveExecutionSchema,
  revokeExecutionSchema,
  executionKey,
  assertExecutionContext,
  type ExecutionContext,
} from "../../src/workspace/execution";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import {
  featureRequestSchema,
  projectFeatures,
  saveFeature,
  removeFeature,
  removeFeatureSchema,
  type Feature,
} from "../../src/workspace/features";
import { ManagedImplementationJobs } from "./agent/managedJobs";
import { availableChecks } from "./agent/verify";

const requestSchema = z
  .object({
    id: z.string().max(100),
    action: z.enum([
      "ready",
      "refresh",
      "source",
      "saveSpec",
      "saveDraft",
      "removeDraft",
      "rebaseDraft",
      "loadDrafts",
      "acceptBaseline",
      "saveFeature",
      "removeFeature",
      "implement",
      "saveExecution",
      "revokeExecution",
      "checkConnection",
      "executionSettings",
      "cancelJob",
      "decideJob",
      "jobDiff",
      "applyJob",
      "reviewJob",
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
    draftRevision: z.number().int().positive().optional(),
    projectKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
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
  private jobs: ManagedImplementationJobs;
  private diffContents = new Map<string, string>();
  private serial = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshWork?: Promise<void>;
  private disposed = false;
  private saving = false;
  private diskDesign = "";
  private drafts?: DesignDrafts;
  private executionProfiles?: ExecutionProfiles;
  private connectionServer?: CodexAppServer;
  private executionSerial = 0;
  private connectionSerial = 0;
  private disposables: vscode.Disposable[] = [];
  constructor(private context: vscode.ExtensionContext) {
    this.worker = new AnalysisClient(context.asAbsolutePath("out/worker.cjs"));
    this.jobs = new ManagedImplementationJobs(
      resolve(context.globalStorageUri.fsPath, "implementation-jobs"),
      context.asAbsolutePath("out/agent-host.cjs"),
      (job, connectionError) => {
        this.state.job = job;
        this.state.jobConnectionError = connectionError;
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
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("pureobom.codexPath") ||
          event.affectsConfiguration("pureobom.codexModel")
        ) {
          this.connectionSerial++;
          this.state.connection = undefined;
          void this.loadExecution();
        }
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
      this.connectionSerial++;
      void this.connectionServer?.close();
      this.connectionServer = undefined;
      this.jobs = new ManagedImplementationJobs(
        resolve(this.context.globalStorageUri.fsPath, "implementation-jobs"),
        this.context.asAbsolutePath("out/agent-host.cjs"),
        (job, connectionError) => {
          this.state.job = job;
          this.state.jobConnectionError = connectionError;
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
      this.drafts = new DesignDrafts(
        this.context.globalStorageUri.fsPath,
        await realpath(folder.uri.fsPath),
      );
      this.state.projectKey = this.drafts.projectKey;
      this.executionProfiles = new ExecutionProfiles(
        this.context.globalStorageUri.fsPath,
        this.drafts.projectKey,
      );
      await this.loadDrafts();
      await this.loadJobHistory();
    } else await this.loadDrafts();
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
    else if (
      request.action === "saveDraft" ||
      request.action === "removeDraft" ||
      request.action === "rebaseDraft"
    )
      result = await this.editDraft(request.action, request.payload);
    else if (request.action === "loadDrafts") {
      await this.loadDrafts();
      result = this.state.drafts;
    } else if (request.action === "acceptBaseline")
      result = await this.acceptBaseline(request.payload);
    else if (request.action === "saveFeature")
      result = await this.saveFeature(request.payload);
    else if (request.action === "removeFeature")
      result = await this.removeFeature(request.payload);
    else if (request.action === "implement")
      result = await this.implement(request.payload);
    else if (
      request.action === "saveExecution" ||
      request.action === "revokeExecution"
    )
      result = await this.editExecution(request.action, request.payload);
    else if (request.action === "checkConnection")
      result = await this.checkConnection(request.payload);
    else if (request.action === "executionSettings")
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:pureobom-local.pureobom codex",
      );
    else if (request.action === "jobHistory") await this.loadJobHistory();
    else if (request.action === "restoreJob") {
      const payload = z
        .object({ workspaceId: z.string().uuid() })
        .strict()
        .parse(request.payload);
      if (!this.folder) throw Error("프로젝트가 없습니다.");
      await this.jobs.restore(this.folder.uri.fsPath, payload.workspaceId);
    } else if (request.action === "cancelJob") {
      const payload = z
        .object({ jobId: z.string().uuid() })
        .strict()
        .parse(request.payload);
      await this.jobs.cancel(payload.jobId);
    } else if (request.action === "decideJob") {
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
      if (!vscode.workspace.isTrusted)
        throw Error("신뢰한 프로젝트에서 실행 요청을 허용해 주세요.");
      await this.jobs.decide(payload.id, payload.decision, payload.jobId);
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
      const file = await this.jobs.file(payload.index, payload.reviewId);
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
    } else if (request.action === "reviewJob") {
      this.assertExecutionReady();
      await this.jobs.reviewDecision(request.payload);
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
        await this.refresh();
        if (this.state.busy || this.state.stale)
          throw Error("구조 분석이 갱신된 뒤 반영해 주세요.");
        prepareChange(current!, this.state.graph!, "behavior");
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
    if (!this.folder || this.disposed) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    ++this.serial;
    this.state.stale = true;
    if (!this.refreshWork) {
      // Publish the shared promise before emitting busy state. A panel-ready or
      // filesystem callback may request another refresh during that emission.
      this.refreshWork = Promise.resolve().then(async () => {
        const deadline = Date.now() + 30000;
        try {
          do {
            clearTimeout(this.timer);
            this.timer = undefined;
            await this.refreshOnce();
            if (this.state.stale && Date.now() > deadline)
              throw Error(
                "프로젝트가 계속 바뀌고 있습니다. 편집을 마친 뒤 구조를 다시 읽어 주세요.",
              );
          } while (!this.disposed && this.folder && this.state.stale);
        } catch (error) {
          if (!this.disposed) this.fail(error);
          throw error;
        } finally {
          this.refreshWork = undefined;
        }
      });
    }
    // All callers wait for the latest requested analysis, including requests
    // superseded by file events. Never acknowledge a feature edit with old graph data.
    await this.refreshWork;
  }
  private async refreshOnce() {
    if (!this.folder || this.disposed) return;
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
        // Clean buffers can lag an external atomic rename (especially on Linux).
        // Only unsaved user edits override disk bytes in the observed graph.
        const content = open?.isDirty
          ? open.getText()
          : await readFile(actual, "utf8");
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
      const base = await this.worker.call<StructureGraph>("structure", {
        files,
      });
      const graph = await projectFeatures(
        base,
        this.state.specs.features ?? [],
      );
      const checks = (await availableChecks(folder.uri.fsPath)).names;
      if (serial !== this.serial || this.folder !== folder || this.disposed)
        return;
      this.state.graph = graph;
      this.state.checks = checks;
      this.state.notices = notices;
      this.state.stale = false;
      this.state.busy = false;
      await this.loadExecution();
      this.emit();
    } catch (error) {
      // A rename/delete can invalidate an in-flight read as well as its result.
      // Let the shared refresh loop analyze the new revision in that case.
      if (serial === this.serial && this.folder === folder && !this.disposed)
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
  private async loadDrafts() {
    const store = this.drafts;
    if (!store) return;
    try {
      const drafts = await store.list();
      if (this.drafts !== store) return;
      this.state.drafts = drafts;
      this.state.draftError = undefined;
    } catch (error) {
      if (this.drafts !== store) return;
      this.state.draftError = `초안 기록을 읽지 못했습니다. 기존 파일은 보존합니다. ${String(error)}`;
    }
    this.emit();
  }
  private currentDraftBase(base: LivingSpec) {
    const saved = this.state.specs.specs.find((spec) => spec.id === base.id);
    if (saved) return saved;
    if (base.revision || !this.state.graph)
      throw Error(
        "초안의 원래 설계나 연결 대상이 없습니다. 입력 내용을 보관한 뒤 대상을 다시 확인해 주세요.",
      );
    return specForTargets(this.state.specs, this.state.graph, base.targetIds);
  }
  private async editDraft(
    action: "saveDraft" | "removeDraft" | "rebaseDraft",
    raw: unknown,
  ) {
    const store = this.drafts;
    const editingPanel = this.panel;
    if (!store) throw Error("초안을 보관할 프로젝트가 없습니다.");
    const request =
      action === "saveDraft"
        ? draftWriteSchema.parse(raw)
        : action === "rebaseDraft"
          ? draftRebaseSchema.parse(raw)
          : draftIdentitySchema.parse(raw);
    if (request.projectKey !== store.projectKey)
      throw Error("초안을 작성한 프로젝트가 아닙니다.");
    let result: DesignDraft | undefined;
    if ("base" in request) result = await store.save(request);
    else if ("expectedDesign" in request) {
      const comparison = draftRebaseSchema.parse(raw);
      await this.loadDesign();
      if (this.drafts !== store)
        throw Error("비교 중 프로젝트가 바뀌었습니다.");
      this.emit();
      const draft = await store.read(request.specId);
      if (!draft) throw Error("다시 연결할 초안이 없습니다.");
      const current = this.currentDraftBase(draft.base);
      if (
        this.state.stale ||
        this.state.busy ||
        this.state.graph?.revision !== comparison.expectedGraphRevision ||
        !draftMatches({ base: comparison.expectedDesign }, current)
      )
        throw Error(
          "비교 중 설계나 코드가 바뀌었습니다. 초안과 최신 설계를 다시 비교해 주세요.",
        );
      result = await store.rebase(
        request.specId,
        request.expectedRevision,
        current,
      );
    } else await store.remove(request.specId, request.expectedRevision);
    if (this.drafts === store) {
      // The editing panel receives this draft in the response. Avoid resending
      // the entire compiler graph and all other drafts for every keystroke.
      const id = result?.base.id ?? ("specId" in request ? request.specId : "");
      this.state.drafts = (this.state.drafts ?? []).filter(
        (draft) => draft.base.id !== id,
      );
      if (result) this.state.drafts.push(result);
      // An accepted write may finish after its original panel was closed. The
      // replacement panel has no pending response handler for that request.
      if (this.panel !== editingPanel) this.emit();
    }
    return result;
  }
  async save(raw: unknown) {
    if (!vscode.workspace.isTrusted)
      throw Error("설계를 저장하려면 신뢰한 작업 공간이 필요합니다.");
    if (this.saving) throw Error("설계를 저장하는 중입니다.");
    const graph = this.state.graph;
    if (!graph || this.state.stale || this.state.busy)
      throw Error("현재 구조 분석이 완료된 뒤 저장해 주세요.");
    const payload = saveSchema.parse(raw);
    if (payload.draftRevision && payload.projectKey !== this.drafts?.projectKey)
      throw Error("초안을 작성한 프로젝트가 아닙니다.");
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
    this.saving = true;
    try {
      const commit = async (draft?: DesignDraft) => {
        const validate = () => {
          if (
            draft &&
            (!draftMatches(draft, this.currentDraftBase(draft.base)) ||
              JSON.stringify(cleanDraft(draft.content)) !==
                JSON.stringify(payload.content))
          )
            throw Error(
              "초안 작성 후 설계나 코드가 바뀌었습니다. 최신 설계와 비교한 뒤 다시 저장해 주세요.",
            );
        };
        validate();
        const next = saveSpec(
          this.state.specs,
          { ...original, content: payload.content },
          payload.expectedRevision,
        );
        return this.persistDesign(next, original.id, validate);
      };
      if (payload.draftRevision) {
        if (!this.drafts) throw Error("저장할 초안이 없습니다.");
        const saved = await this.drafts.consume(
          original.id,
          payload.draftRevision,
          commit,
        );
        await this.loadDrafts();
        return saved;
      }
      return await commit();
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
  async saveFeature(raw: unknown): Promise<Feature> {
    this.assertExecutionReady();
    if (this.saving) throw Error("설계를 저장하는 중입니다.");
    if (this.jobs.isRunning || this.state.job?.phase === "recovery")
      throw Error("진행 중인 구현·복구를 마친 뒤 기능 묶음을 편집해 주세요.");
    const request = featureRequestSchema.parse(raw);
    const graph = this.state.graph;
    if (!graph || this.state.busy || this.state.stale)
      throw Error("구조 분석이 완료된 뒤 기능 묶음을 편집해 주세요.");
    const serial = this.serial;
    const id = request.id ?? randomUUID();
    const next = specDocumentSchema.parse({
      ...this.state.specs,
      features: saveFeature(
        this.state.specs.features ?? [],
        graph,
        request,
        id,
      ),
    });
    this.saving = true;
    try {
      await this.persistDesign(next, "", () => {
        this.assertExecutionReady();
        if (this.serial !== serial)
          throw Error("구조가 바뀌었습니다. 기능 묶음을 다시 열어 주세요.");
      });
      await this.refresh();
      return next.features!.find((feature) => feature.id === id)!;
    } finally {
      this.saving = false;
    }
  }
  async removeFeature(raw: unknown) {
    this.assertExecutionReady();
    if (
      this.saving ||
      this.jobs.isRunning ||
      this.state.job?.phase === "recovery"
    )
      throw Error(
        "진행 중인 저장·구현·복구를 마친 뒤 기능 묶음을 해제해 주세요.",
      );
    const request = removeFeatureSchema.parse(raw);
    const graph = this.state.graph;
    if (!graph || this.state.busy || this.state.stale)
      throw Error("구조 분석이 완료된 뒤 기능 묶음을 해제해 주세요.");
    const serial = this.serial;
    const next = specDocumentSchema.parse({
      ...this.state.specs,
      features: removeFeature(this.state.specs.features ?? [], graph, request),
    });
    this.saving = true;
    try {
      await this.persistDesign(next, "", () => {
        this.assertExecutionReady();
        if (this.serial !== serial)
          throw Error("구조가 바뀌었습니다. 기능 묶음을 다시 열어 주세요.");
      });
      await this.refresh();
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
  private async executionContext(): Promise<ExecutionContext> {
    if (!this.folder || !this.state.projectKey)
      throw Error("프로젝트가 없습니다.");
    const configuration = vscode.workspace.getConfiguration("pureobom");
    const folder = this.folder;
    const projectKey = this.state.projectKey;
    const executable = configuration.get<string>("codexPath") || "codex";
    const model = configuration.get<string>("codexModel") || "";
    const checks = await availableChecks(folder.uri.fsPath, true);
    if (
      this.folder !== folder ||
      this.state.projectKey !== projectKey ||
      this.disposed
    )
      throw Error("프로젝트가 바뀌었습니다.");
    return executionContextSchema.parse({
      projectKey,
      executable,
      model,
      manager: checks.manager,
      scripts: checks.scripts,
    });
  }
  private async loadExecution() {
    const store = this.executionProfiles;
    if (!store || this.disposed) return;
    const serial = ++this.executionSerial;
    try {
      const [context, profile] = await Promise.all([
        this.executionContext(),
        store.read(),
      ]);
      if (
        this.executionProfiles !== store ||
        this.disposed ||
        this.executionSerial !== serial
      )
        return;
      if (
        this.state.execution &&
        executionKey(this.state.execution.context) !== executionKey(context)
      ) {
        this.connectionSerial++;
        this.state.connection = undefined;
      }
      this.state.execution = { context, profile };
      this.state.executionError = undefined;
    } catch (error) {
      if (
        this.executionProfiles !== store ||
        this.disposed ||
        this.executionSerial !== serial
      )
        return;
      this.state.execution = undefined;
      this.state.connection = undefined;
      this.state.executionError = `구현 설정을 읽지 못했습니다. 기존 기록은 보존합니다. ${String(error)}`;
    }
    this.emit();
  }
  private async editExecution(action: string, raw: unknown) {
    const store = this.executionProfiles;
    if (!store || !vscode.workspace.isTrusted)
      throw Error("신뢰한 로컬 프로젝트에서 실행 설정을 변경해 주세요.");
    try {
      if (action === "saveExecution") {
        const request = saveExecutionSchema.parse(raw);
        assertExecutionContext(request, await this.executionContext());
        return await store.save(request);
      }
      const request = revokeExecutionSchema.parse(raw);
      if (request.projectKey !== store.projectKey)
        throw Error("다른 프로젝트의 실행 설정입니다.");
      return await store.revoke(request.expectedRevision);
    } finally {
      await this.loadExecution();
    }
  }
  private async checkConnection(raw: unknown) {
    if (!this.folder || !vscode.workspace.isTrusted)
      throw Error("신뢰한 로컬 프로젝트에서 Codex 연결을 확인해 주세요.");
    if (this.connectionServer || this.jobs.isRunning)
      throw Error(
        "진행 중인 연결 확인 또는 구현 작업이 끝난 뒤 확인해 주세요.",
      );
    const expected = executionContextSchema.parse(raw);
    const context = await this.executionContext();
    if (executionKey(expected) !== executionKey(context))
      throw Error("구현 설정이 바뀌었습니다. 새로 읽고 확인해 주세요.");
    if (this.connectionServer || this.jobs.isRunning || this.disposed)
      throw Error("다른 연결 확인 또는 구현 작업이 진행 중입니다.");
    const folder = this.folder;
    const serial = ++this.connectionSerial;
    const server = new CodexAppServer({
      executable: context.executable,
      cwd: folder.uri.fsPath,
      requestTimeoutMs: 15000,
    });
    this.connectionServer = server;
    this.state.connection = {
      status: "checking",
      message: "Codex 실행기와 로그인 상태를 확인합니다.",
    };
    this.emit();
    let result: NonNullable<DesignWorkspaceState["connection"]>;
    try {
      const provider = (await server.start()).userAgent;
      const account = await server.account();
      const ready = account.signedIn || !account.requiresOpenaiAuth;
      result = {
        status: ready ? "ready" : "signin",
        provider,
        message: ready
          ? "Codex에 연결되었습니다. 구현 실행 시 로그인 상태를 다시 확인합니다."
          : "Codex CLI에서 로그인한 뒤 연결을 다시 확인해 주세요.",
        checkedAt: new Date().toISOString(),
      };
    } catch {
      // Do not copy raw provider/account output into persistent state or the Webview.
      result = {
        status: "failed",
        message:
          "Codex에 연결하지 못했습니다. 설정의 실행 파일 경로와 CLI 설치·로그인을 확인해 주세요.",
        checkedAt: new Date().toISOString(),
      };
    } finally {
      await server.close();
      if (this.connectionServer === server) this.connectionServer = undefined;
    }
    if (
      !this.disposed &&
      this.folder === folder &&
      this.connectionSerial === serial &&
      this.state.execution &&
      executionKey(this.state.execution.context) === executionKey(context)
    ) {
      this.state.connection = result;
      this.emit();
    }
    return result;
  }
  async implement(raw: unknown) {
    this.assertExecutionReady();
    if (this.jobs.isRunning)
      throw Error("현재 구현 작업이 끝난 뒤 다시 시작해 주세요.");
    const payload = saveSchema
      .extend({
        execution: executionUseSchema,
      })
      .strict()
      .parse(raw);
    const store = this.executionProfiles!;
    const folder = this.folder!;
    assertExecutionContext(payload.execution, await this.executionContext());
    const start = async () => {
      if (this.executionProfiles !== store)
        throw Error("프로젝트가 바뀌었습니다.");
      const saved = await this.save({
        specId: payload.specId,
        targetIds: payload.targetIds,
        content: payload.content,
        expectedRevision: payload.expectedRevision,
        draftRevision: payload.draftRevision,
        projectKey: payload.projectKey,
      });
      const change = prepareChange(saved, this.state.graph!, "behavior")!;
      const context = await this.executionContext();
      assertExecutionContext(payload.execution, context);
      if (this.folder !== folder) throw Error("프로젝트가 바뀌었습니다.");
      return this.jobs.start(folder.uri.fsPath, change, {
        executable: context.executable,
        model: context.model || undefined,
        checks: payload.execution.checks,
        allowExternal: true,
        verification: { manager: context.manager, scripts: context.scripts },
        specSnapshot: saved,
      });
    };
    try {
      return await store.use(payload.execution, start);
    } finally {
      await this.loadExecution();
    }
  }
  async loadJobHistory() {
    if (!this.folder) return;
    const jobs = this.jobs;
    try {
      const history = await jobs.history(this.folder.uri.fsPath);
      if (this.jobs !== jobs || this.disposed) return;
      this.state.jobHistory = history.entries;
      this.state.jobHistoryErrors = history.errors;
    } catch (error) {
      if (this.jobs !== jobs || this.disposed) return;
      this.state.jobHistoryErrors = [String(error)];
    }
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
    this.disposed = true;
    this.connectionSerial++;
    clearTimeout(this.timer);
    this.serial++;
    this.panel?.dispose();
    this.worker.dispose();
    this.jobs.dispose();
    void this.connectionServer?.close();
    this.changes.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
