import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/guardclauses");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (
  git("rev-parse", "HEAD") !== "f96b823e4228252b2927cce3effa550c16b558a5" ||
  git("status", "--porcelain")
)
  throw Error("Expected clean pinned GuardClauses checkout");
if (!process.env.PUREOBOM_TEST_DOTNET)
  throw Error("Set an absolute PUREOBOM_TEST_DOTNET executable path");
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/csharp-source-project.json"),
  events = resolve("test-results/csharp-source-project.events.json");
await build({
  entryPoints: ["extension/test/csharpSourceProject.ts"],
  outfile: "test-results/csharp-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/csharp-source-profile-"));
const folder = join(root, ".vscode"),
  config = join(folder, "tasks.json");
let madeFolder = false,
  wroteConfig = false;
try {
  try {
    await mkdir(folder);
    madeFolder = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await writeFile(
    config,
    JSON.stringify(
      {
        version: "2.0.0",
        tasks: [
          {
            label: "GuardClauses C# regression",
            type: "process",
            command: process.execPath,
            args: [resolve("scripts/run-guardclauses-tests.mjs"), root, events],
            options: {
              cwd: root,
              env: {
                PUREOBOM_TEST_DOTNET: process.env.PUREOBOM_TEST_DOTNET,
                PUREOBOM_DOTNET_TOOLS: resolve("test-results/tools/dotnet"),
                PUREOBOM_CSHARP_OUTPUTS: resolve(
                  "test-results/guardclauses-checks",
                ),
              },
            },
            group: "test",
            problemMatcher: [],
          },
        ],
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  wroteConfig = true;
  await runTests({
    vscodeExecutablePath: runtime,
    extensionDevelopmentPath: resolve("extension"),
    extensionTestsPath: resolve("test-results/csharp-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_TEST_DOTNET: process.env.PUREOBOM_TEST_DOTNET,
      PUREOBOM_CSHARP_SOURCE_REPORT: report,
      PUREOBOM_CSHARP_SOURCE_EVENTS: events,
    },
    launchArgs: [
      root,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--user-data-dir",
      profile,
      "--extensions-dir",
      resolve("test-results/csharp-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(config);
  if (madeFolder) await rmdir(folder);
}
if (git("status", "--porcelain"))
  throw Error("Fixture was not restored cleanly");
