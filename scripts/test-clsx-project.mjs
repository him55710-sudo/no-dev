// Actual VS Code project checks against an isolated pinned JS repository.
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/clsx");
const expected = "925494cf31bcd97d3337aacd34e659e80cae7fe2";
if (
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim() !== expected
)
  throw Error("Unexpected clsx revision");
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw Error("Fixture has changes; inspect before running");
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/clsx-project-checks.json");
const taskReport = resolve("test-results/clsx-task-output.json");
await build({
  entryPoints: ["extension/test/clsxProjectIntegration.ts"],
  outfile: "test-results/clsx-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/clsx-profile-"));
const configFolder = join(root, ".vscode"),
  configFile = join(configFolder, "tasks.json");
let madeFolder = false,
  wroteConfig = false;
try {
  try {
    await mkdir(configFolder);
    madeFolder = true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  await writeFile(
    configFile,
    JSON.stringify(
      {
        version: "2.0.0",
        tasks: [
          {
            label: "clsx upstream tests",
            type: "process",
            command: process.execPath,
            args: [
              resolve("scripts/run-clsx-tests.mjs"),
              root,
              runtime,
              taskReport,
            ],
            options: { cwd: root },
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
    extensionTestsPath: resolve("test-results/clsx-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_CLSX_REPORT: report,
      PUREOBOM_CLSX_TASK_REPORT: taskReport,
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
      resolve("test-results/clsx-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(configFile);
  if (madeFolder) await rmdir(configFolder);
}
