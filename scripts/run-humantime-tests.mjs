// Run the unchanged upstream tests; toolchain/dependencies must already be ready.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]),
  destination = resolve(process.argv[3]);
const cargo = process.env.PUREOBOM_TEST_CARGO || "cargo";
const args = [
  "test",
  "--manifest-path",
  join(root, "Cargo.toml"),
  "--all-features",
  "--no-fail-fast",
  "--locked",
  "--offline",
  "--color",
  "never",
];
const report = {
  checkedAt: new Date().toISOString(),
  command: cargo,
  args,
  counts: { passed: 0, failed: 0, skipped: 0, filtered: 0, total: 0 },
  suites: [],
  failedTests: [],
  exitCode: 1,
};
try {
  report.lockSha256 = createHash("sha256")
    .update(await readFile(join(root, "Cargo.lock")))
    .digest("hex");
  const result = spawnSync(cargo, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  report.stdout = result.stdout;
  report.stderr = result.stderr;
  report.cargoExitCode = result.status;
  report.compilerFlags = (process.env.CARGO_ENCODED_RUSTFLAGS || "").split(
    "\x1f",
  );
  report.docFlags = (process.env.CARGO_ENCODED_RUSTDOCFLAGS || "").split(
    "\x1f",
  );
  if (result.error || result.status === null)
    throw Error(result.error?.message || "Cargo returned no exit code");
  report.exitCode = result.status;
  report.suites = [
    ...result.stdout.matchAll(
      /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g,
    ),
  ].map((m) => ({
    status: m[1],
    passed: +m[2],
    failed: +m[3],
    skipped: +m[4],
    measured: +m[5],
    filtered: +m[6],
  }));
  if (report.suites.length !== 2)
    throw Error("Expected the upstream unit-test and doc-test summaries");
  for (const suite of report.suites) {
    for (const key of ["passed", "failed", "skipped", "filtered"])
      report.counts[key] += suite[key];
  }
  report.counts.total =
    report.counts.passed + report.counts.failed + report.counts.skipped;
  report.failedTests = [
    ...result.stdout.matchAll(/^test (.+) \.\.\. FAILED$/gm),
  ].map((m) => m[1]);
  if (
    !report.counts.total ||
    report.failedTests.length !== report.counts.failed
  )
    throw Error("Missing or inconsistent test counts");
} catch (error) {
  report.error = String(error);
  report.exitCode = 1;
}
await writeFile(destination, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    counts: report.counts,
    exitCode: report.exitCode,
    error: report.error,
  }),
);
process.exitCode = report.exitCode;
