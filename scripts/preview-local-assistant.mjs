// Local UI verification only: simulated model/editor operations; real component and source comparison.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const folder = resolve("test-results/constraint-ui");
await mkdir(folder, { recursive: true });
await build({
  entryPoints: ["scripts/fixtures/local-assistant/ui.tsx"],
  outfile: resolve(folder, "view.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  logLevel: "silent",
});
await build({
  entryPoints: ["src/core/localAssistant.ts"],
  outfile: resolve(folder, "core.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { checkAssistantConstraint } = createRequire(import.meta.url)(
  resolve(folder, "core.cjs"),
);
const worker = new Worker(resolve("extension/out/worker.cjs"));
let seq = 0;
const pending = new Map(),
  calls = [];
worker.on("message", (r) => {
  const p = pending.get(r.id);
  pending.delete(r.id);
  r.error ? p.reject(Error(r.error)) : p.resolve(r.result);
});
const call = (payload) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type: "validateAssistant", payload });
  });
const source = "if (ready) run(); else wait();\n";
async function rpc(r) {
  calls.push(r);
  await writeFile(
    resolve(folder, "calls.json"),
    JSON.stringify(calls, null, 2),
  );
  if (r.action === "localModels")
    return {
      origin: "UI fixture (no model call)",
      models: [
        { name: "fixture:local", digest: "a".repeat(64), size: 1900000000 },
      ],
    };
  if (r.action === "localGenerate") {
    const good = r.payload.instruction.includes("valid whitespace");
    const after = good
      ? "if (ready)\n  run();\nelse\n  wait();"
      : "if (ready) { run(); } else { wait(); }";
    const validation = await call({
      language: "typescript",
      original: source,
      source: after + "\n",
    });
    const quote = source.trim();
    const en = r.payload.lang === "en";
    return {
      id: "fixture-" + seq,
      model: "fixture:local",
      digest: "a".repeat(64),
      elapsedMs: 1,
      summary: en
        ? "Controlled formatting proposal."
        : "검증용 서식 변경안입니다.",
      citations: [
        {
          quote,
          explanation: en ? "Original conditional." : "원래 조건문입니다.",
          start: 0,
          end: quote.length,
          line: 1,
        },
      ],
      edits: [
        {
          before: quote,
          after,
          reason: en ? "Formatting fixture." : "서식 검증용",
          start: 0,
          end: quote.length,
        },
      ],
      risks: [],
      checks: [],
      validation,
      constraint: checkAssistantConstraint(
        r.payload.editConstraint,
        validation.changeFacts,
      ),
    };
  }
  if (
    ["localPreview", "localApply", "localCancel", "localSource"].includes(
      r.action,
    )
  )
    return {};
  throw Error("Unsupported fixture operation");
}
const page = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local assistant constraint UI verification</title><link rel="stylesheet" href="/view.css"><style>html{--vscode-font-family:system-ui;--vscode-font-size:14px;--vscode-foreground:#20312b;--vscode-descriptionForeground:#65736a;--vscode-editor-background:#fafbf8;--vscode-input-background:white;--vscode-input-foreground:#20312b;--vscode-focusBorder:#267460;--vscode-button-background:#267460;--vscode-button-foreground:white;--vscode-panel-border:#dce2dc;color-scheme:light}body{margin:0}</style><body><div id="root"></div><script>window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:async m=>{const r=await(await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)})).json();window.postMessage({type:'response',id:m.id,...r},location.origin)}});</script><script src="/view.js"></script></body></html>`;
createServer(async (req, res) => {
  try {
    if (req.url === "/rpc" && req.method === "POST") {
      let body = "";
      for await (const c of req) {
        body += c;
        if (body.length > 100000) throw Error("Too large");
      }
      let response;
      try {
        response = { result: await rpc(JSON.parse(body)) };
      } catch (e) {
        response = { error: e.message };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(response));
    } else if (["/view.js", "/view.css"].includes(req.url)) {
      res.setHeader(
        "content-type",
        req.url.endsWith("css") ? "text/css" : "text/javascript",
      );
      res.end(await readFile(resolve(folder, req.url.slice(1))));
    } else if (req.url === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(page);
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
}).listen(4187, "127.0.0.1", () =>
  console.log("Constraint UI fixture: http://127.0.0.1:4187"),
);
