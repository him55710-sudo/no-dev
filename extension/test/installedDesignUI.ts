import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import type { DesignWorkspace } from "../src/designWorkspace";
import { observeSpec } from "../../src/workspace/spec";

/** Test-only loopback transport for the unmodified installed Webview bundle.
 * This is browser UI + installed host evidence, not native VS Code pointer evidence. */
export async function run() {
  const configuration = JSON.parse(
    await readFile(process.env.PUREOBOM_UI_CONFIGURATION!, "utf8"),
  );
  const { directory, source, token, extensions, originalHashes } =
    configuration;
  const extension = vscode.extensions.getExtension<{
    designWorkspace: DesignWorkspace;
    runtimeMode: vscode.ExtensionMode;
  }>("pureobom-local.pureobom")!;
  assert.ok(extension);
  const location = relative(extensions, extension.extensionPath);
  assert.ok(location && !location.startsWith("..") && !isAbsolute(location));
  const digest = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  for (const [path, hash] of Object.entries(configuration.artifact.files))
    assert.equal(
      digest(await readFile(resolve(extension.extensionPath, path))),
      hash,
      path,
    );
  const api = await extension.activate();
  assert.equal(api.runtimeMode, vscode.ExtensionMode.Production);
  const workspace = api.designWorkspace;
  await vscode.commands.executeCommand("pureobom.openWorkspace");
  assert.ok(workspace.state.graph);
  let revision = 1,
    phase = "",
    origin = "",
    finish!: () => void;
  let failure: unknown;
  const completed = new Promise<void>((done) => {
    finish = done;
  });
  const requests: Record<string, unknown>[] = [],
    jobs: unknown[] = [],
    clientErrors: unknown[] = [];
  const subscription = workspace.changes.event((state) => {
    revision++;
    if (state.job && phase !== state.job.phase) {
      phase = state.job.phase;
      jobs.push(JSON.parse(JSON.stringify(state.job)));
      console.log(`UI JOB ${phase}`);
    }
  });
  const prefix = "/" + token;
  const js = await readFile(
    resolve(extension.extensionPath, "media/design.js"),
  );
  const css = await readFile(
    resolve(extension.extensionPath, "media/design.css"),
  );
  const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>설치본 설계 화면 검증</title><link rel="stylesheet" href="${prefix}/design.css"></head><body><aside style="position:fixed;bottom:0;right:0;z-index:10000;padding:6px;background:#fff;border:1px solid #555;color:#222;font:12px sans-serif">설치 번들 + 실제 호스트 · 테스트 전송 경로 <button id="finish">검증 종료·기록 저장</button><span id="driver-result"></span></aside><div id="root"></div><script src="${prefix}/transport.js"></script><script src="${prefix}/design.js"></script></body></html>`;
  const transport = `
let revision=0, polling=false;
function deliver(value){window.dispatchEvent(new MessageEvent('message',{data:value}));}
async function poll(){if(polling)return;polling=true;try{const response=await fetch('${prefix}/state?since='+revision);if(response.status===200){const value=await response.json();revision=value.revision;deliver({type:'workspaceState',state:value.state});}}finally{polling=false;}}
window.acquireVsCodeApi=()=>({postMessage:message=>{fetch('${prefix}/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)}).then(response=>response.json()).then(deliver).catch(error=>deliver({type:'response',id:message.id,error:String(error)}));},getState:()=>undefined,setState:()=>{}});
setInterval(()=>poll().catch(()=>{}),250);
window.addEventListener('error',event=>fetch('${prefix}/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:event.message})}));
window.addEventListener('unhandledrejection',event=>fetch('${prefix}/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(event.reason)})}));
document.getElementById('finish').onclick=async()=>{const response=await fetch('${prefix}/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const value=await response.json();document.getElementById('driver-result').textContent=value.error||'기록 저장 완료';};
`;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
    try {
      if (
        request.headers.host !== new URL(origin).host ||
        !url.pathname.startsWith(prefix + "/")
      )
        return send(404, { error: "Unknown test route" });
      if (request.method === "GET") {
        if (url.pathname === prefix + "/state") {
          if (url.searchParams.get("since") === String(revision)) {
            response.writeHead(204);
            response.end();
            return;
          }
          return send(200, { revision, state: workspace.state });
        }
        const resource = new Map<string, [string, string | Buffer]>([
          [prefix + "/", ["text/html; charset=utf-8", html]],
          [
            prefix + "/transport.js",
            ["text/javascript; charset=utf-8", transport],
          ],
          [prefix + "/design.js", ["text/javascript; charset=utf-8", js]],
          [prefix + "/design.css", ["text/css; charset=utf-8", css]],
        ]).get(url.pathname);
        if (!resource) return send(404, { error: "Not found" });
        response.writeHead(200, {
          "Content-Type": resource[0],
          "Content-Security-Policy":
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        });
        response.end(resource[1]);
        return;
      }
      if (
        request.method !== "POST" ||
        request.headers.origin !== origin ||
        request.headers["content-type"] !== "application/json"
      )
        return send(403, { error: "Same-origin test browser required" });
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 1024 * 1024)
          throw Error("Request exceeds limit");
      }
      const payload = JSON.parse(body);
      if (url.pathname === prefix + "/client-error") {
        clientErrors.push(payload);
        return send(200, {});
      }
      if (url.pathname === prefix + "/request") {
        const entry: Record<string, unknown> = {
          action: payload.action,
          at: new Date().toISOString(),
        };
        requests.push(entry);
        try {
          const result = await workspace.handleRequest(payload);
          entry.ok = true;
          if (["implement", "applyJob", "undoJob"].includes(payload.action)) {
            entry.job = JSON.parse(JSON.stringify(workspace.state.job));
            entry.specs = workspace.state.specs;
            entry.graph = {
              files: workspace.state.graph!.files,
              revision: workspace.state.graph!.revision,
            };
            entry.observations = workspace.state.specs.specs.map((spec) => ({
              id: spec.id,
              status: observeSpec(spec, workspace.state.graph!).status,
            }));
          }
          return send(200, { type: "response", id: payload.id, result });
        } catch (error) {
          entry.ok = false;
          entry.error = String(error);
          return send(200, {
            type: "response",
            id: payload.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (url.pathname === prefix + "/finish") {
        try {
          assert.equal(
            workspace.state.job?.phase,
            "undone",
            "Complete implementation, review, apply and undo in the UI first.",
          );
          for (const action of [
            "checkConnection",
            "saveExecution",
            "implement",
            "reviewJob",
            "applyJob",
            "undoJob",
          ])
            assert.ok(
              requests.some((entry) => entry.action === action && entry.ok),
              `Missing successful UI action: ${action}`,
            );
          assert.deepEqual(clientErrors, []);
          for (const [path, hash] of Object.entries(originalHashes))
            assert.equal(
              digest(await readFile(resolve(source, path))),
              hash,
              path,
            );
          const exec = promisify(execFile);
          const git = async (...args: string[]) =>
            (await exec("git", ["-C", source, ...args], { windowsHide: true }))
              .stdout;
          assert.equal(
            (await git("rev-parse", "HEAD")).trim(),
            configuration.originalHead,
          );
          assert.equal(
            await git("diff", "--cached"),
            configuration.originalIndex,
          );
          assert.equal(
            await git("status", "--porcelain"),
            configuration.originalStatus,
          );
          const report = {
            schemaVersion: 1,
            checkedAt: new Date().toISOString(),
            platform: process.platform,
            vscode: vscode.version,
            artifact: configuration.artifact,
            scope:
              "Unmodified installed Webview JS/CSS operated through a browser, using a token-scoped loopback replacement for acquireVsCodeApi. Requests execute in the installed Production VS Code host. Native VS Code Webview DOM/pointer delivery is not verified.",
            provider: configuration.realProvider
              ? "Installed real Codex CLI; review recorded by validation agent, not a usability participant."
              : "Explicit deterministic stdio fixture; no external inference.",
            requests,
            jobs,
            clientErrors,
            finalSpecs: workspace.state.specs,
            originalRestored: true,
          };
          await writeFile(
            resolve(directory, "report.json"),
            JSON.stringify(report, null, 2) + "\n",
          );
          send(200, { saved: true });
          finish();
          return;
        } catch (error) {
          return send(400, { error: String(error) });
        }
      }
      send(404, { error: "Not found" });
    } catch (error) {
      send(400, { error: String(error) });
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const url = origin + prefix + "/";
  await writeFile(
    resolve(directory, "browser.json"),
    JSON.stringify({ url, extensionHostPid: process.pid, source }, null, 2),
  );
  console.log(`INSTALLED UI BROWSER ${url}`);
  const timer = setTimeout(
    () => {
      failure = Error("Manual UI validation timed out after 60 minutes");
      finish();
    },
    60 * 60 * 1000,
  );
  try {
    await completed;
    if (failure) throw failure;
  } finally {
    clearTimeout(timer);
    subscription.dispose();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    workspace.dispose();
  }
}
