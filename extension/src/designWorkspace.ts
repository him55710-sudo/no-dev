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
  draftSpec,
  saveSpec,
  specContentSchema,
  specDocumentSchema,
  type SpecDocument,
} from "../../src/workspace/spec";
import type { DesignWorkspaceState } from "../../src/workspace/state";

const requestSchema = z
  .object({
    id: z.string().max(100),
    action: z.enum(["ready", "refresh", "source", "saveSpec"]),
    payload: z.unknown().optional(),
  })
  .strict();
const saveSchema = z
  .object({
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
  private serial = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private saving = false;
  private diskDesign = "";
  private disposables: vscode.Disposable[] = [];
  constructor(private context: vscode.ExtensionContext) {
    this.worker = new AnalysisClient(context.asAbsolutePath("out/worker.cjs"));
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
          } else result = await this.save(request.payload);
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
  async refresh() {
    if (!this.folder) return;
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
      if (serial !== this.serial || this.folder !== folder) return;
      this.state.graph = graph;
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
    const original = draftSpec(graph, payload.targetIds);
    const previous = this.state.specs.specs.find(
      (spec) => spec.id === original.id,
    );
    const next: SpecDocument = saveSpec(
      this.state.specs,
      { ...(previous ?? original), content: payload.content },
      payload.expectedRevision,
    );
    this.saving = true;
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
      temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temporary, text, { flag: "wx" });
      await rename(temporary, path);
      temporary = undefined;
      this.diskDesign = text;
      this.state.specs = next;
      this.emit();
      return next.specs.find((spec) => spec.id === original.id)!;
    } finally {
      this.saving = false;
      if (temporary) await unlink(temporary).catch(() => {});
    }
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
    this.changes.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
