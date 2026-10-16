// Regenerate only the pinned SQLite example, then run its unchanged upstream test.
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]);
const destination = resolve(process.argv[3]);
const cwd = join(root, "examples/authors");
const config = join(cwd, ".pureobom-sqlite.json");
const generated = ["db.go", "models.go", "query.sql.go"].map((name) =>
  join(cwd, "sqlite", name),
);
const backups = await Promise.all(generated.map((path) => readFile(path)));
const report = {
  checkedAt: new Date().toISOString(),
  commands: [],
  counts: { passed: 0, failed: 0, skipped: 0 },
  exitCode: 1,
};
let wroteConfig = false;
const run = (command, args, directory) => {
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GOTOOLCHAIN: "local" },
  });
  report.commands.push({
    command,
    args,
    cwd: directory,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  });
  if (result.error || result.status === null)
    throw Error(result.error?.message || "Process ended without an exit code");
  return result;
};
try {
  await writeFile(
    config,
    JSON.stringify(
      {
        version: "2",
        sql: [
          {
            schema: "sqlite/schema.sql",
            queries: "sqlite/query.sql",
            engine: "sqlite",
            gen: { go: { package: "authors", out: "sqlite" } },
          },
        ],
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  wroteConfig = true;
  const generatedResult = run(
    process.env.PUREOBOM_TEST_SQLC || "sqlc",
    ["generate", "-f", config],
    cwd,
  );
  if (generatedResult.status !== 0) throw Error("sqlc generation failed");
  report.generatedSha256 = createHash("sha256")
    .update(await readFile(generated[2]))
    .digest("hex");
  const result = run(
    process.env.PUREOBOM_TEST_GO || "go",
    ["test", "-json", "-tags", "examples", "-count=1", "./authors/sqlite"],
    join(root, "examples"),
  );
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.Test && event.Action === "pass") report.counts.passed++;
    if (event.Test && event.Action === "fail") report.counts.failed++;
    if (event.Test && event.Action === "skip") report.counts.skipped++;
  }
  report.exitCode = result.status;
} catch (error) {
  report.error = String(error);
} finally {
  // Restore only the three exact generated files, including their original line endings.
  if (wroteConfig) {
    for (let i = 0; i < generated.length; i++)
      await writeFile(generated[i], backups[i]);
    await unlink(config);
  }
  await writeFile(destination, JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    counts: report.counts,
    exitCode: report.exitCode,
    error: report.error,
  }),
);
process.exitCode = report.exitCode;
