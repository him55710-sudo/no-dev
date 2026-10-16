// Explicit developer probe. Reads only the named file; does not apply or execute model output.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
const [
  file,
  language,
  model,
  port = "11434",
  task = "explain",
  instruction = "",
] = process.argv.slice(2);
if (!file || !language || !model)
  throw Error(
    "Usage: node scripts/probe-local-assistant.mjs FILE LANGUAGE MODEL [PORT] [TASK] [REQUEST]",
  );
await mkdir("test-results", { recursive: true });
const clientFile = resolve("test-results/local-assistant-client.cjs");
await build({
  entryPoints: ["extension/src/ollama.ts"],
  outfile: clientFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "silent",
});
const { OllamaClient } = createRequire(import.meta.url)(clientFile);
const source = await readFile(file, "utf8");
const report = {
  checkedAt: new Date().toISOString(),
  file: basename(file),
  language,
  model,
  task,
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  sourceBytes: Buffer.byteLength(source),
  kind: "actual local Ollama inference; no code applied or tests executed",
};
try {
  const result = await new OllamaClient(Number(port)).generate(model, {
    source,
    language,
    task,
    instruction,
    lang: "ko",
  });
  report.result = result;
  await writeFile(
    "test-results/local-assistant-probe.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "success",
      file: report.file,
      model: result.model.name,
      digest: result.model.digest,
      elapsedMs: result.elapsedMs,
      citations: result.proposal.citations.length,
      edits: result.proposal.edits.length,
      summary: result.proposal.summary,
    }),
  );
} catch (error) {
  report.error = error.message;
  await writeFile(
    "test-results/local-assistant-probe.json",
    JSON.stringify(report, null, 2),
  );
  console.error(JSON.stringify({ status: "failed", error: report.error }));
  process.exitCode = 1;
}
