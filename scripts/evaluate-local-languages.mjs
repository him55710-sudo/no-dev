// Explicit local-model evaluation of public synthetic fixtures, never user project code.
// A strict text oracle catches unintended changes; it is NOT a semantic quality score.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";

const [model, port = "11435", selection = "all", taskList = "explain,edit"] =
  process.argv.slice(2);
if (!model)
  throw Error(
    "Usage: node scripts/evaluate-local-languages.mjs MODEL [PORT] [LANGUAGE|all] [explain,edit]",
  );
const tasks = taskList.split(",");
if (tasks.some((task) => !["explain", "edit"].includes(task)))
  throw Error("Unknown evaluation task");
await mkdir("test-results", { recursive: true });
const bundle = resolve("test-results/language-evaluation-client.cjs");
await build({
  entryPoints: ["extension/src/ollama.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { OllamaClient } = createRequire(import.meta.url)(bundle);
const cases = JSON.parse(
  await readFile("examples/local-ai/cases.json", "utf8"),
).filter((c) => selection === "all" || c.language === selection);
if (!cases.length) throw Error("No matching fixture");
const label = model.replace(/[^a-zA-Z0-9._-]/g, "_");
const output = `test-results/languages-${label}-${selection}-${tasks.join("-")}.json`;
const report = {
  startedAt: new Date().toISOString(),
  model,
  platform: process.platform,
  node: process.version,
  implementation: {
    transportSha256: createHash("sha256")
      .update(await readFile("extension/src/ollama.ts"))
      .digest("hex"),
    protocolSha256: createHash("sha256")
      .update(await readFile("src/core/localAssistant.ts"))
      .digest("hex"),
  },
  kind: "actual Ollama on public synthetic fixtures; no code applied or executed",
  limitations:
    "One run per case; exact text matching is not semantic accuracy. Explanation prose requires human review. Runtime, compilation and project integration are not tested here.",
  results: [],
};
for (const c of cases) {
  const source = await readFile(resolve("examples/local-ai", c.file), "utf8");
  for (const task of tasks) {
    const row = {
      file: basename(c.file),
      language: c.language,
      task,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
    };
    try {
      const response = await new OllamaClient(Number(port)).generate(model, {
        source,
        language: c.language,
        task,
        lang: "ko",
        instruction: task === "edit" ? c.request : "",
      });
      row.response = response;
      row.protocolAccepted = true;
      if (task === "edit") {
        row.expectedSource = source.replace(c.from, c.to);
        row.matchesExpectedText =
          response.proposal.updated === row.expectedSource;
      }
      console.log(
        JSON.stringify({
          language: c.language,
          task,
          accepted: true,
          elapsedMs: response.elapsedMs,
          matchesExpectedText: row.matchesExpectedText,
        }),
      );
    } catch (error) {
      row.protocolAccepted = false;
      row.error = error.message;
      console.log(
        JSON.stringify({
          language: c.language,
          task,
          accepted: false,
          error: error.message,
        }),
      );
    }
    report.results.push(row);
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
}
report.completedAt = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Saved ${output}`);
