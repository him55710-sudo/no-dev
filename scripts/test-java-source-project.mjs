// Run a reviewed regression against the pinned upstream minimal-json project.
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/minimal-json");
const javaHome = process.env.PUREOBOM_TEST_JAVA_HOME || process.env.JAVA_HOME;
if (!javaHome) throw Error("Set PUREOBOM_TEST_JAVA_HOME or JAVA_HOME");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== "5518c876226ae07f8291d6b41209bc3c979f4a55")
  throw Error("Unexpected minimal-json revision");
if (git("status", "--porcelain"))
  throw Error("Fixture has changes; inspect before running");
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/java-source-project.json");
const events = resolve("test-results/java-source-project.events.jsonl");
const runner = resolve("scripts/run-minimal-json-tests.mjs");
await build({
  entryPoints: ["extension/test/javaSourceProject.ts"],
  outfile: "test-results/java-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/java-source-profile-"));
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
            label: "minimal-json Java AST regression",
            type: "process",
            command: process.execPath,
            args: [runner, root, events],
            options: { cwd: root, env: { PUREOBOM_TEST_JAVA_HOME: javaHome } },
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
    extensionTestsPath: resolve("test-results/java-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_JAVA_SOURCE_REPORT: report,
      PUREOBOM_JAVA_SOURCE_EVENTS: events,
      PUREOBOM_TEST_JAVA_HOME: javaHome,
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
      resolve("test-results/java-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(config);
  if (madeFolder) await rmdir(folder);
}
if (git("status", "--porcelain"))
  throw Error("Fixture was not restored cleanly");
