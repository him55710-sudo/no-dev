// Diagnostic measurement only: instrument a temporary copy of the process-scope
// source and launch synthetic Node children. No app, provider or model runs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

await mkdir("test-results", { recursive: true });
const root = await mkdtemp(resolve("test-results", "startup-timing-"));
const original = await readFile("extension/src/agent/ownedProcess.ts", "utf8");
assert.ok(original.includes("  Add-Type -TypeDefinition @'"));
assert.match(original, /('@\r?\n)  \$code =/);
const source = original
  .replace(
    "  Add-Type -TypeDefinition @'",
    "  [Console]::Error.WriteLine('scope-start')\n  Add-Type -TypeDefinition @'",
  )
  .replace(
    /('@\r?\n)  \$code =/,
    "$1  [Console]::Error.WriteLine('scope-compiled')\n  $code =",
  );
const bundle = resolve(root, "scope.cjs");
await build({
  stdin: { contents: source, loader: "ts", resolveDir: process.cwd() },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
});
const { spawnOwnedProcess } = createRequire(import.meta.url)(bundle);
async function measure(label) {
  const start = performance.now(),
    stages = [];
  const child = spawnOwnedProcess(
    process.execPath,
    ["-e", "process.stderr.write('target-ready\\n')"],
    { cwd: process.cwd() },
  );
  let timedOut = false,
    error;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 20000);
  const done = new Promise((resolve) => {
    child.once("error", (value) => {
      error = value.message;
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let pending = "";
  child.stderr.on("data", (bytes) => {
    pending += bytes.toString();
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      stages.push({
        name: pending.slice(0, end).trim(),
        elapsedMs: Math.round(performance.now() - start),
      });
      pending = pending.slice(end + 1);
    }
  });
  child.stdout.resume();
  child.stdin.on("error", (value) => {
    error ??= value.message;
  });
  child.stdin.end();
  const exit = await done;
  clearTimeout(timer);
  return {
    label,
    ...exit,
    timedOut,
    error,
    elapsedMs: Math.round(performance.now() - start),
    stages,
  };
}
const results = [
  await measure("first"),
  await measure("second"),
  ...(await Promise.all([measure("concurrent-1"), measure("concurrent-2")])),
];
const report = {
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  processScopeSourceHash: createHash("sha256").update(original).digest("hex"),
  scope:
    "Instrumented current process-scope source; synthetic Node child only. Does not reproduce or explain every prior timeout. Stage times are observed on stderr receipt, not OS-level CPU profiling.",
  results,
};
await writeFile(
  "test-results/startup-timing.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (
  results.some((result) => result.code !== 0 || result.timedOut || result.error)
)
  process.exitCode = 1;
