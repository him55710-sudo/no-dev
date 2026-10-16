// Real VS Code edit/task/undo flow against pinned modern-normalize sources.
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  rmdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve("test-results/projects/modern-normalize");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== "3faa07fc91b8ffbe6243bc4f91e880a00185d0a2")
  throw Error("Unexpected modern-normalize revision");
const initialStatus = git("status", "--porcelain");
if (initialStatus !== "?? pnpm-lock.yaml")
  throw Error(
    "Fixture must be unchanged except for its generated dependency lock",
  );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lockHash = async (file) =>
  hash((await readFile(file, "utf8")).replace(/\r\n/g, "\n"));
const dependencyLockHash = await lockHash(join(root, "pnpm-lock.yaml"));
if (
  dependencyLockHash !==
  (await lockHash("scripts/fixtures/modern-normalize/pnpm-lock.yaml"))
)
  throw Error("Use the published modern-normalize dependency lock");
const runtime = await downloadAndUnzipVSCode("1.96.4");
await build({
  entryPoints: ["extension/test/webSourceProject.ts"],
  outfile: "test-results/web-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/web-source-profile-"));
const folder = join(root, ".vscode");
const config = join(folder, "tasks.json");
const report = resolve("test-results/web-source-project.json");
const taskReport = resolve("test-results/web-source-task.json");
let madeFolder = false;
let wroteConfig = false;
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
            label: "modern-normalize upstream Chrome tests",
            type: "process",
            command: process.execPath,
            args: [
              resolve("scripts/run-modern-normalize-tests.mjs"),
              root,
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
    extensionTestsPath: resolve("test-results/web-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_WEB_SOURCE_REPORT: report,
      PUREOBOM_WEB_SOURCE_TASK_REPORT: taskReport,
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
      resolve("test-results/web-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(config);
  if (madeFolder) await rmdir(folder);
}
if (git("status", "--porcelain") !== initialStatus)
  throw Error("Fixture source was not restored");
if ((await lockHash(join(root, "pnpm-lock.yaml"))) !== dependencyLockHash)
  throw Error("Fixture dependency lock changed during verification");
