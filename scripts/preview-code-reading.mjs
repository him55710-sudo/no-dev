import { createServer } from "vite";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve("test-results/code-reading");
await mkdir(directory, { recursive: true });
const entry = resolve(directory, "analyze.mjs");
await build({
  entryPoints: ["src/workspace/analyze.ts"],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
});
const { analyzeStructure } = await import(pathToFileURL(entry).href);
const report = JSON.parse(
  await readFile(
    resolve(directory, "tests_fixtures_code-reading_shipping.ts.json"),
    "utf8",
  ),
);
const reading = report.reading;
const graph = await analyzeStructure([
  { path: reading.path, content: reading.source },
]);
reading.revision = graph.revision;
const state = {
  projectName: "배송비 계산 · 화면 검증",
  projectKey: "a".repeat(64),
  graph,
  selectedId: "system",
  busy: false,
  stale: false,
  trusted: true,
  specs: { schemaVersion: 1, specs: [] },
  notices: [],
  story: {
    title: "주문에 맞춰 배송비 정하기",
    summary: "주문 금액과 배송 방식에 따라 배송비를 계산하는 코드입니다.",
    flow: ["주문 금액 확인", "배송 방식 확인", "배송비 반환"],
    parts: [{ title: "배송비", summary: "배송비 계산", paths: [reading.path] }],
    unknowns: [],
    revision: graph.revision,
    createdAt: reading.createdAt,
    model: reading.model,
    sourceFileCount: 1,
    sourceBytes: Buffer.byteLength(reading.source),
    files: [
      {
        path: reading.path,
        title: "배송비 계산하기",
        summary: "일반 배송의 무료 기준과 빠른 배송의 요금을 정합니다.",
        steps: [],
        rules: [],
        unknowns: [],
        evidence: [],
      },
    ],
  },
  checks: ["test"],
  execution: {
    context: {
      projectKey: "a".repeat(64),
      executable: "fixture",
      model: "fixture",
      manager: "npm",
      scripts: { test: "fixture" },
    },
    profile: { revision: 0 },
  },
};
await writeFile(
  resolve(directory, "ui-state.json"),
  JSON.stringify({ state, reading }),
);
await writeFile(
  resolve(directory, "ui.html"),
  `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>코드를 읽고 수정하는 화면 검증</title><style>
:root{color-scheme:light dark;--vscode-editor-background:light-dark(#fff,#202420);--vscode-editor-foreground:light-dark(#26332b,#edf2ec);--vscode-input-background:light-dark(#f5f6f3,#30362f);--vscode-input-foreground:var(--vscode-editor-foreground);--vscode-button-background:light-dark(#28654a,#bddcc4);--vscode-button-foreground:light-dark(#fff,#183b25);--vscode-textLink-foreground:light-dark(#28654a,#bddcc4);--vscode-focusBorder:light-dark(#326e51,#bddcc4);--vscode-textBlockQuote-background:light-dark(#f1f4ed,#2a332a);--vscode-textCodeBlock-background:light-dark(#eef0ec,#2b312b);--vscode-errorForeground:light-dark(#a52828,#ffb5b5);--vscode-list-hoverBackground:var(--vscode-textBlockQuote-background)}
body{margin:0;background:var(--vscode-editor-background)}.fixture-tools{padding:12px 24px;font:12px system-ui;background:var(--vscode-textBlockQuote-background)}.fixture-tools button{margin-left:12px}.fixture-tools pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style></head><body><div id="root"></div><script type="module" src="/tests/ui/code-reading.tsx"></script></body></html>`,
);
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
console.log(server.resolvedUrls.local[0] + "test-results/code-reading/ui.html");
