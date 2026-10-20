import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

assert.equal(
  process.env.PUREOBOM_RUN_CODEX,
  "1",
  "Enable real Codex inference explicitly.",
);

const directory = resolve("test-results/code-reading");
await mkdir(directory, { recursive: true });
const entry = resolve(directory, "narrator.mjs");
await build({
  entryPoints: ["extension/src/projectNarrator.ts"],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
const { ProjectNarrator } = await import(pathToFileURL(entry).href);
const paths = process.argv.slice(2);
if (!paths.length) paths.push("tests/fixtures/code-reading/shipping.ts");
const narrator = new ProjectNarrator({
  executable: process.env.PUREOBOM_CODEX_PATH || "codex",
  cwd: process.cwd(),
  cache: await mkdtemp(resolve(directory, "live-cache-")),
});
for (const path of paths) {
  const source = await readFile(path, "utf8");
  const before = createHash("sha256").update(source).digest("hex");
  const started = Date.now();
  try {
    const reading = await narrator.readFile(
      { path, content: source },
      before,
      new AbortController().signal,
      (progress) => console.log(JSON.stringify({ path, ...progress })),
    );
    const after = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    if (before !== after) throw Error("Reading changed the source file.");
    await writeFile(
      resolve(directory, path.replace(/[^a-z0-9.-]/gi, "_") + ".json"),
      JSON.stringify(
        {
          inferenceRun: true,
          elapsedMs: Date.now() - started,
          sourcePreserved: before === after,
          reading,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        path,
        blocks: reading.blocks.length,
        lines: reading.lineCount,
        elapsedMs: Date.now() - started,
        sourcePreserved: true,
      }),
    );
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
