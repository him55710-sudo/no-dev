// One actual local inference per selected public fixture. Never applies or runs output.
import { build } from "esbuild";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve, basename, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";

const [
  model,
  port = "11435",
  lang = "ko",
  selection = "all",
  label = "evaluation",
] = process.argv.slice(2);
if (
  !model ||
  !["ko", "en"].includes(lang) ||
  !/^[a-zA-Z0-9_-]+$/.test(label) ||
  !Number.isInteger(Number(port)) ||
  Number(port) < 1024 ||
  Number(port) > 65535
)
  throw Error(
    "Usage: node scripts/evaluate-explanations.mjs MODEL [PORT] [ko|en] [all|regression|new|ID,ID] [LABEL]",
  );
const root = resolve("examples/local-ai/semantic");
const cases = JSON.parse(
  await readFile(resolve(root, "cases.json"), "utf8"),
).filter(
  (c) =>
    selection === "all" ||
    c.group === selection ||
    selection.split(",").includes(c.id),
);
if (!cases.length) throw Error("No selected cases");
await mkdir("test-results", { recursive: true });
const directory = await mkdtemp(
  resolve("test-results", `explanations-${label}-`),
);
const bundle = resolve(directory, "client.cjs");
// Freeze the implementation once: later worktree edits cannot change an ongoing run.
await build({
  entryPoints: ["extension/src/ollama.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { OllamaClient } = createRequire(import.meta.url)(bundle);
const hash = (data) => createHash("sha256").update(data).digest("hex");
// Public fixtures only. Capture final text even when the product rejects a quote,
// but never save a model's private thinking field. The product itself has no logger.
let capture;
const relay = createServer(async (req, res) => {
  if (
    !["/api/status", "/api/tags", "/api/show", "/api/chat"].includes(req.url)
  ) {
    res.writeHead(404).end();
    return;
  }
  const body = [];
  for await (const chunk of req) body.push(chunk);
  const bytes = Buffer.concat(body);
  if (req.url === "/api/chat") capture = { request: JSON.parse(bytes) };
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: Number(port),
      path: req.url,
      method: req.method,
      agent: false,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": bytes.length,
      },
    },
    (response) => {
      res.writeHead(response.statusCode || 502, {
        "Content-Type": "application/json",
      });
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 2 * 1024 * 1024) chunks.push(chunk);
        res.write(chunk);
      });
      response.on("end", () => {
        if (req.url === "/api/chat" && capture && size <= 2 * 1024 * 1024) {
          try {
            const raw = JSON.parse(Buffer.concat(chunks));
            capture.final = {
              content: raw.message?.content,
              done: raw.done,
              done_reason: raw.done_reason,
              prompt_eval_count: raw.prompt_eval_count,
              eval_count: raw.eval_count,
              total_duration: raw.total_duration,
              load_duration: raw.load_duration,
              error: raw.error,
            };
          } catch {
            capture.captureError = "Response was not JSON";
          }
        }
        res.end();
      });
      response.on("error", () => res.destroy());
    },
  );
  upstream.on("error", () => res.destroy());
  res.on("close", () => upstream.destroy());
  upstream.end(bytes);
});
await new Promise((done) => relay.listen(0, "127.0.0.1", done));
const capturePort = relay.address().port;
const report = {
  startedAt: new Date().toISOString(),
  model,
  responseLanguage: lang,
  platform: process.platform,
  node: process.version,
  implementation: {
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    transportSha256: hash(await readFile("extension/src/ollama.ts")),
    protocolSha256: hash(await readFile("src/core/localAssistant.ts")),
    frozenClientSha256: hash(await readFile(bundle)),
  },
  kind: "actual local Ollama; public synthetic examples; one attempt per selected case; no changes applied or executed",
  capture:
    "Loopback-only relay preserves request and final text, including rejected outputs. Model thinking is not recorded.",
  limitations:
    "Quote coverage only checks expected source text appears in citations. It is NOT semantic accuracy. Prose requires manual review against the published criteria; all errors are retained. Elapsed time is not a controlled performance comparison.",
  results: [],
};
const output = resolve(directory, "report.json");
console.log(`Report: ${relative(process.cwd(), output)}`);
for (const c of cases) {
  const file = resolve(root, c.file);
  const source = await readFile(file, "utf8");
  for (const quote of c.quoteChecks)
    if (!source.includes(quote))
      throw Error(`Invalid fixture oracle ${c.id}: ${quote}`);
  const row = {
    id: c.id,
    file: basename(file),
    language: c.language,
    sourceSha256: hash(source),
    source,
    reviewCriteria: c.review,
  };
  capture = undefined;
  const started = Date.now();
  try {
    row.response = await new OllamaClient(capturePort).generate(model, {
      source,
      language: c.language,
      task: "explain",
      lang,
      instruction: "",
    });
    row.protocolAccepted = true;
    row.quoteCoverage = c.quoteChecks.map((quote) => ({
      quote,
      covered: row.response.proposal.citations.some((citation) =>
        citation.quote.includes(quote),
      ),
    }));
    console.log(
      JSON.stringify({
        id: c.id,
        accepted: true,
        elapsedMs: row.response.elapsedMs,
        citedChecks: row.quoteCoverage.filter((q) => q.covered).length,
        totalChecks: c.quoteChecks.length,
      }),
    );
  } catch (error) {
    row.protocolAccepted = false;
    row.error = error.message;
    console.log(
      JSON.stringify({ id: c.id, accepted: false, error: row.error }),
    );
  }
  row.requestElapsedMs = Date.now() - started;
  row.wire = capture;
  report.results.push(row);
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
report.completedAt = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${relative(process.cwd(), output)}`);
relay.closeAllConnections();
await new Promise((done) => relay.close(done));
