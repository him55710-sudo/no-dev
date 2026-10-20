// Run the actual AST/edit/project-check flow against a clean, pinned external checkout.
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/itsdangerous");
const python = resolve(
  process.platform === "win32"
    ? "test-results/python-venv/Scripts/python.exe"
    : "test-results/python-venv/bin/python",
);
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd")
  throw Error("Unexpected itsdangerous revision");
if (git("status", "--porcelain"))
  throw Error("Fixture has changes; inspect before running");
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/python-source-project.json");
const xml = resolve("test-results/python-source-project.junit.xml");
await build({
  entryPoints: ["extension/test/pythonSourceProject.ts"],
  outfile: "test-results/python-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/python-source-profile-"));
const configFolder = join(root, ".vscode"),
  configFile = join(configFolder, "tasks.json");
let madeFolder = false,
  wroteConfig = false;
try {
  try {
    await mkdir(configFolder);
    madeFolder = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await writeFile(
    configFile,
    JSON.stringify(
      {
        version: "2.0.0",
        tasks: [
          {
            label: "itsdangerous Python AST regression",
            type: "process",
            command: python,
            args: ["-m", "pytest", "-q", "--tb=no", `--junitxml=${xml}`],
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
    extensionTestsPath: resolve("test-results/python-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_PYTHON_SOURCE_REPORT: report,
      PUREOBOM_PYTHON_SOURCE_XML: xml,
      PUREOBOM_PYTHON_SOURCE_EXECUTABLE: python,
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
      resolve("test-results/python-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(configFile);
  if (madeFolder) await rmdir(configFolder);
}
if (git("status", "--porcelain"))
  throw Error("Fixture was not restored cleanly");
