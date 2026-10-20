// Original upstream net8.0 test project, with build outputs isolated from source watches.
import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(process.argv[2]),
  destination = resolve(process.argv[3]);
const tools = resolve(
  process.env.PUREOBOM_DOTNET_TOOLS || "test-results/tools/dotnet",
);
const outputRoot = resolve(
  process.env.PUREOBOM_CSHARP_OUTPUTS || dirname(destination),
);
await mkdir(outputRoot, { recursive: true });
const results = await mkdtemp(join(outputRoot, "guardclauses-results-"));
const args = [
  "test",
  join(root, "test/GuardClauses.UnitTests/GuardClauses.UnitTests.csproj"),
  "--framework",
  "net8.0",
  "-p:TargetFrameworks=net8.0",
  "-p:GeneratePackageOnBuild=false",
  "--artifacts-path",
  join(outputRoot, "guardclauses-build"),
  "--logger",
  "trx;LogFileName=results.trx",
  "--results-directory",
  results,
];
const report = {
  checkedAt: new Date().toISOString(),
  command: process.env.PUREOBOM_TEST_DOTNET || "dotnet",
  args,
  targetFramework: "net8.0",
  runtimePolicy:
    "DOTNET_ROLL_FORWARD=Major; SDK 10 host with matching .NET 10 runtime",
  counts: { passed: 0, failed: 0, skipped: 0, total: 0 },
  failedTests: [],
  exitCode: 1,
};
try {
  const result = spawnSync(report.command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
      DOTNET_CLI_UI_LANGUAGE: "en-US",
      DOTNET_ROLL_FORWARD: "Major",
      DOTNET_CLI_HOME: join(tools, "cli-home"),
      NUGET_PACKAGES: join(tools, "nuget-cache"),
    },
  });
  report.stdout = result.stdout;
  report.stderr = result.stderr;
  if (result.error || result.status === null)
    throw Error(
      result.error?.message || "Test process did not return an exit code",
    );
  report.exitCode = result.status;
  const trx = await readFile(join(results, "results.trx"), "utf8");
  const counters = trx.match(/<Counters\s+([^>]+)\/>/)?.[1];
  if (!counters) throw Error("TRX counters missing");
  const attributes = Object.fromEntries(
    [...counters.matchAll(/(\w+)="(\d+)"/g)].map((m) => [m[1], Number(m[2])]),
  );
  report.counts = {
    passed: attributes.passed,
    failed: attributes.failed,
    skipped: attributes.notExecuted,
    total: attributes.total,
  };
  const decode = (s) =>
    s
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  report.failedTests = [...trx.matchAll(/<UnitTestResult\b([^>]+)>/g)]
    .filter((m) => /outcome="Failed"/.test(m[1]))
    .map((m) => decode(m[1].match(/testName="([^"]*)"/)?.[1] || "unknown"));
  if (
    !report.counts.total ||
    Object.values(report.counts).some((n) => !Number.isInteger(n))
  )
    throw Error("Invalid TRX test counts");
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
