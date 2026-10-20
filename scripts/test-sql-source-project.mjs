import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/sqlc");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (
  git("rev-parse", "HEAD") !== "c69308b521a50f92fee48ae623702c5550c49d95" ||
  git("status", "--porcelain")
)
  throw Error("Expected clean pinned sqlc checkout");
if (!process.env.PUREOBOM_TEST_SQLC || !process.env.PUREOBOM_TEST_GO)
  throw Error(
    "Set absolute PUREOBOM_TEST_SQLC and PUREOBOM_TEST_GO executable paths",
  );
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/sql-source-project.json"),
  events = resolve("test-results/sql-source-project.events.json");
await build({
  entryPoints: ["extension/test/sqlSourceProject.ts"],
  outfile: "test-results/sql-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/sql-source-profile-"));
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
            label: "sqlc SQLite regression",
            type: "process",
            command: process.execPath,
            args: [resolve("scripts/run-sqlc-tests.mjs"), root, events],
            options: {
              cwd: root,
              env: {
                PUREOBOM_TEST_SQLC: process.env.PUREOBOM_TEST_SQLC,
                PUREOBOM_TEST_GO: process.env.PUREOBOM_TEST_GO,
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
    extensionTestsPath: resolve("test-results/sql-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_SQL_SOURCE_REPORT: report,
      PUREOBOM_SQL_SOURCE_EVENTS: events,
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
      resolve("test-results/sql-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(config);
  if (madeFolder) await rmdir(folder);
}
if (git("status", "--porcelain"))
  throw Error("Fixture was not restored cleanly");
