import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import type { DesignWorkspace } from "../src/designWorkspace";
import {
  observeSpec,
  currentObservations,
  type LivingSpec,
} from "../../src/workspace/spec";
import { compareObservations } from "../../src/workspace/observations";
import type { ImplementationJob } from "../../src/workspace/job";

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
  const partialPath = resolve(directory, "reconnect-partial.json");
  const previous = configuration.runIndex
    ? JSON.parse(await readFile(partialPath, "utf8"))
    : undefined;
  // Test-only observation of processes belonging to this exact isolated project.
  // No PID is killed or adopted, and unrelated process details are not returned.
  async function processWitness() {
    assert.equal(
      process.platform,
      "win32",
      "This live reconnection witness currently targets Windows.",
    );
    const script = `$workers = @(Get-CimInstance Win32_Process -Filter "Name='Code.exe' OR Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('agent-host.cjs') -and $_.CommandLine.Contains($env:PUREOBOM_WITNESS_ROOT) });
if ($workers.Count -ne 1) { throw 'Expected one project-owned agent host' }
$worker = $workers[0];
$providers = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $worker.ProcessId) | Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -match 'app-server' });
if ($providers.Count -ne 1) { throw 'Expected one directly owned Codex app-server' }
$provider = $providers[0];
@{workerPid=$worker.ProcessId;workerCreated=$worker.CreationDate.ToUniversalTime().ToString('o');providerPid=$provider.ProcessId;providerCreated=$provider.CreationDate.ToUniversalTime().ToString('o');providerExecutable=$provider.ExecutablePath} | ConvertTo-Json -Compress`;
    const result = await promisify(execFile)(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, PUREOBOM_WITNESS_ROOT: source },
      },
    );
    return JSON.parse(result.stdout);
  }
  let reconnection: unknown;
  let navigationRestoration: unknown;
  let observationWitness:
    | {
        saved: LivingSpec;
        originals: Record<string, string>;
        changed: ReturnType<typeof compareObservations>;
        accepted?: LivingSpec;
        restored?: ReturnType<typeof compareObservations>;
      }
    | undefined = previous?.observationWitness;
  if (
    previous &&
    (configuration.navigationValidation || configuration.observationValidation)
  ) {
    assert.equal(workspace.state.job, undefined);
    assert.notEqual(process.pid, previous.before.extensionHostPid);
    assert.deepEqual(
      workspace.state.navigation?.view,
      previous.before.navigation,
    );
    assert.deepEqual(workspace.state.specs, previous.before.specs);
    navigationRestoration = {
      before: previous.before,
      after: {
        at: new Date().toISOString(),
        extensionHostPid: process.pid,
        navigation: structuredClone(workspace.state.navigation?.view),
        specs: structuredClone(workspace.state.specs),
      },
    };
    await writeFile(
      resolve(directory, "navigation-restoration.json"),
      JSON.stringify(navigationRestoration, null, 2),
    );
    console.log("SAVED NAVIGATION AND DESIGN RESTORED IN A NEW INSTALLED HOST");
  } else if (previous) {
    assert.equal(workspace.state.job?.id, previous.before.job.id);
    assert.equal(workspace.state.job?.worktree, previous.before.job.worktree);
    assert.equal(workspace.state.job?.phase, "approval");
    assert.deepEqual(
      workspace.state.job?.approvals,
      previous.before.job.approvals,
    );
    const processes = await processWitness();
    assert.deepEqual(processes, previous.before.processes);
    assert.notEqual(process.pid, previous.before.extensionHostPid);
    reconnection = {
      before: previous.before,
      after: {
        at: new Date().toISOString(),
        extensionHostPid: process.pid,
        job: structuredClone(workspace.state.job),
        processes,
      },
    };
    await writeFile(
      resolve(directory, "reconnection.json"),
      JSON.stringify(reconnection, null, 2),
    );
    console.log("SAME LIVE CODEX PROCESS AND PENDING APPROVAL RECONNECTED");
  }
  let revision = 1,
    phase = "",
    origin = "",
    finish!: () => void;
  let failure: unknown;
  const completed = new Promise<void>((done) => {
    finish = done;
  });
  const requests: Record<string, unknown>[] = previous?.requests ?? [],
    jobs: unknown[] = previous?.jobs ?? [],
    clientErrors: unknown[] = previous?.clientErrors ?? [];
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
  const restartControl =
    (configuration.reconnectValidation ||
      configuration.navigationValidation ||
      configuration.observationValidation) &&
    !configuration.runIndex
      ? `<button id="restart">${configuration.observationValidation ? "관측 기준 보관 후 창 재시작 검증" : configuration.navigationValidation ? "탐색 위치 보관 후 창 재시작 검증" : "승인 대기 중 창 재시작 검증"}</button>`
      : "";
  const observationControl = configuration.observationValidation
    ? `<button id="observation-change">${configuration.runIndex ? "검증용 원본 복원" : "검증용 외부 코드 변경"}</button>`
    : "";
  const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>설치본 설계 화면 검증</title><link rel="stylesheet" href="${prefix}/design.css"></head><body><aside style="position:fixed;bottom:0;right:0;z-index:10000;padding:6px;background:#fff;border:1px solid #555;color:#222;font:12px sans-serif">설치 번들 + 실제 호스트 · 테스트 전송 경로 ${observationControl}${restartControl}<button id="finish">검증 종료·기록 저장</button><span id="driver-result"></span></aside><div id="root"></div><script src="${prefix}/transport.js"></script><script src="${prefix}/design.js"></script></body></html>`;
  const transport = `
let revision=0, polling=false;
function deliver(value){window.dispatchEvent(new MessageEvent('message',{data:value}));}
async function poll(){if(polling)return;polling=true;try{const response=await fetch('${prefix}/state?since='+revision);if(response.status===200){const value=await response.json();revision=value.revision;deliver({type:'workspaceState',state:value.state});}}finally{polling=false;}}
window.acquireVsCodeApi=()=>({postMessage:message=>{fetch('${prefix}/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)}).then(response=>response.json()).then(deliver).catch(error=>deliver({type:'response',id:message.id,error:String(error)}));},getState:()=>undefined,setState:()=>{}});
setInterval(()=>poll().catch(()=>{}),250);
window.addEventListener('error',event=>fetch('${prefix}/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:event.message})}));
window.addEventListener('unhandledrejection',event=>fetch('${prefix}/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(event.reason)})}));
document.getElementById('finish').onclick=async()=>{const response=await fetch('${prefix}/finish',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const value=await response.json();document.getElementById('driver-result').textContent=value.error||'기록 저장 완료';};
const restart=document.getElementById('restart');if(restart)restart.onclick=async()=>{restart.disabled=true;try{const response=await fetch('${prefix}/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const value=await response.json();document.getElementById('driver-result').textContent=value.error||'창을 닫고 같은 작업에 다시 연결합니다.';if(value.error)restart.disabled=false;}catch(error){document.getElementById('driver-result').textContent=String(error);}};
const observationChange=document.getElementById('observation-change');if(observationChange)observationChange.onclick=async()=>{observationChange.disabled=true;const response=await fetch('${prefix}/observation-change',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const value=await response.json();document.getElementById('driver-result').textContent=value.error||'검증용 코드 변경과 재분석 완료';if(value.error)observationChange.disabled=false;};
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
      if (url.pathname === prefix + "/observation-change") {
        assert.ok(
          configuration.observationValidation && !configuration.realProvider,
        );
        assert.equal(workspace.state.job, undefined);
        const saved = workspace.state.specs.specs[0];
        assert.equal(workspace.state.specs.specs.length, 1);
        assert.ok(
          saved.content.desired.includes("viewer") &&
            saved.content.acceptance.length,
        );
        if (!configuration.runIndex) {
          assert.equal(observationWitness, undefined);
          const originals: Record<string, string> = Object.fromEntries(
            await Promise.all(
              ["policy.js", "service.js"].map(async (path) => [
                path,
                await readFile(resolve(source, path), "utf8"),
              ]),
            ),
          );
          for (const [path, text] of Object.entries(originals))
            assert.equal(digest(Buffer.from(text)), originalHashes[path]);
          assert.ok(originals["policy.js"].includes(' || role === "viewer"'));
          assert.ok(
            originals["service.js"].includes("  project.title = title;"),
          );
          await writeFile(
            resolve(source, "policy.js"),
            originals["policy.js"].replace(' || role === "viewer"', ""),
          );
          await writeFile(
            resolve(source, "service.js"),
            originals["service.js"].replace(
              "  project.title = title;",
              "  audit();\n  project.title = title;",
            ) + '\nexport function audit() { return "recorded"; }\n',
          );
          await workspace.refresh();
          const changed = compareObservations(
            saved.baseline.observations,
            currentObservations(saved, workspace.state.graph!),
          );
          const policy = changed.facts.find(
            (item) => item.current?.label === "canEdit",
          )!;
          assert.equal(policy.status, "changed");
          assert.ok(policy.before!.summary.includes("viewer"));
          assert.ok(!policy.current!.summary.includes("viewer"));
          assert.ok(
            changed.relations.some(
              (item) =>
                item.status === "added" && item.current?.to.label === "audit",
            ),
          );
          assert.deepEqual(workspace.state.specs.specs[0], saved);
          observationWitness = {
            saved: structuredClone(saved),
            originals,
            changed,
          };
        } else {
          assert.ok(observationWitness?.accepted);
          for (const [path, text] of Object.entries(
            observationWitness.originals,
          ))
            await writeFile(resolve(source, path), text);
          await workspace.refresh();
          observationWitness.restored = compareObservations(
            saved.baseline.observations,
            currentObservations(saved, workspace.state.graph!),
          );
          const policy = observationWitness.restored.facts.find(
            (item) => item.current?.label === "canEdit",
          )!;
          assert.equal(policy.status, "changed");
          assert.ok(policy.current!.summary.includes("viewer"));
          assert.deepEqual(
            workspace.state.specs.specs[0],
            observationWitness.accepted,
          );
        }
        return send(200, { changed: true });
      }
      if (url.pathname === prefix + "/restart") {
        assert.ok(
          (configuration.reconnectValidation ||
            configuration.navigationValidation ||
            configuration.observationValidation) &&
            !configuration.runIndex,
        );
        assert.deepEqual(clientErrors, []);
        if (configuration.observationValidation) {
          assert.ok(observationWitness);
          const accepted = workspace.state.specs.specs[0];
          assert.equal(
            accepted.revision,
            observationWitness.saved.revision + 1,
          );
          assert.deepEqual(accepted.content, observationWitness.saved.content);
          assert.deepEqual(
            accepted.baselineHistory![0].baseline,
            observationWitness.saved.baseline,
          );
          assert.ok(
            !accepted.baseline
              .observations!.facts.find((fact) => fact.label === "canEdit")!
              .summary.includes("viewer"),
          );
          observationWitness.accepted = structuredClone(accepted);
          assert.equal(workspace.state.job, undefined);
          assert.ok(
            requests.some((entry) => entry.action === "source" && entry.ok),
          );
        } else if (configuration.navigationValidation) {
          assert.equal(workspace.state.job, undefined);
          assert.ok(workspace.state.navigation);
          assert.notEqual(workspace.state.navigation.view.selection, "system");
          assert.ok(workspace.state.navigation.view.scopeTrail.length > 1);
          assert.ok(workspace.state.navigation.view.savedSpecId);
          assert.ok(
            workspace.state.navigation.view.canvases.some(
              (canvas) => canvas.viewport && canvas.positions.length,
            ),
          );
          assert.ok(
            requests
              .filter((entry) => entry.action === "saveNavigation")
              .every((entry) => entry.ok === true),
            "Wait for navigation writes to complete.",
          );
        } else {
          assert.equal(workspace.state.job?.phase, "approval");
          assert.ok(workspace.state.job?.approvals.length);
        }
        const before =
          configuration.navigationValidation ||
          configuration.observationValidation
            ? {
                at: new Date().toISOString(),
                extensionHostPid: process.pid,
                navigation: structuredClone(workspace.state.navigation!.view),
                specs: structuredClone(workspace.state.specs),
              }
            : {
                at: new Date().toISOString(),
                extensionHostPid: process.pid,
                job: structuredClone(workspace.state.job),
                processes: await processWitness(),
              };
        await writeFile(
          partialPath,
          JSON.stringify(
            { before, requests, jobs, clientErrors, observationWitness },
            null,
            2,
          ),
        );
        send(200, { restarting: true });
        finish();
        return;
      }
      if (url.pathname === prefix + "/request") {
        const entry: Record<string, unknown> = {
          action: payload.action,
          at: new Date().toISOString(),
        };
        requests.push(entry);
        try {
          const result = await workspace.handleRequest(payload);
          if (
            configuration.navigationValidation &&
            payload.action === "saveNavigation"
          ) {
            entry.navigation = structuredClone(result);
            // Exercise input changes while a real disk write's acknowledgement
            // is still in flight. This delay exists only in the test transport.
            await new Promise((done) => setTimeout(done, 800));
          }
          entry.ok = true;
          if (
            configuration.observationValidation &&
            payload.action === "source"
          ) {
            const editor = vscode.window.activeTextEditor!;
            entry.sourceSelection = {
              path: vscode.workspace.asRelativePath(editor.document.uri),
              text: editor.document.getText(editor.selection),
            };
          }
          if (
            ["implement", "resumeJob", "applyJob", "undoJob"].includes(
              payload.action,
            )
          ) {
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
          if (configuration.reconnectValidation)
            assert.ok(
              reconnection,
              "Reconnect the live approval before finishing.",
            );
          if (configuration.observationValidation) {
            assert.ok(navigationRestoration && observationWitness?.restored);
            assert.equal(workspace.state.job, undefined);
            assert.deepEqual(jobs, []);
            assert.ok(requests.every((entry) => entry.ok === true));
          } else if (configuration.navigationValidation) {
            assert.ok(navigationRestoration);
            assert.equal(workspace.state.job, undefined);
            assert.deepEqual(
              workspace.state.navigation?.view,
              previous.before.navigation,
              "The restored UI must retain the host's saved navigation.",
            );
          } else
            assert.equal(
              workspace.state.job?.phase,
              "undone",
              "Complete implementation, review, apply and undo in the UI first.",
            );
          for (const action of configuration.observationValidation
            ? ["saveSpec", "source", "acceptBaseline"]
            : configuration.navigationValidation
              ? ["saveFeature", "saveSpec", "saveNavigation"]
              : [
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
          let continuationWitness: unknown;
          if (configuration.continuationValidation) {
            const final = workspace.state.job!;
            const original = (jobs as ImplementationJob[]).find(
              (job) =>
                job.id === final.continuedFrom && job.phase === "cancelled",
            );
            assert.ok(original?.worktree && final.continuedFrom);
            assert.notEqual(original.id, final.id);
            assert.ok(
              requests.some(
                (entry) => entry.action === "cancelJob" && entry.ok,
              ),
            );
            assert.ok(
              requests.some(
                (entry) => entry.action === "resumeJob" && entry.ok,
              ),
            );
            const partial = await readFile(
              resolve(original.worktree, "policy.js"),
              "utf8",
            );
            assert.ok(partial.startsWith("// partial implementation"));
            assert.ok(partial.includes('role === "viewer"'));
            assert.ok(
              final.checks.length &&
                final.checks.every((check) => check.status === "passed"),
            );
            continuationWitness = {
              previousJobId: original.id,
              resumedJobId: final.id,
              originalPartialSha256: digest(Buffer.from(partial)),
              oldWorkspacePreserved: true,
              freshChecks: final.checks,
            };
          }
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
              : configuration.observationValidation
                ? "No provider invoked; stored/current observation comparison and baseline restoration validation."
                : configuration.navigationValidation
                  ? "No provider invoked; navigation-only validation."
                  : "Explicit deterministic stdio fixture; no external inference.",
            requests,
            jobs,
            reconnection,
            navigationRestoration,
            observationWitness,
            continuationWitness,
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
