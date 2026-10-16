// Opt-in test. Requires the pinned public fixture, isolated Python dependencies, and local Ollama.
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
const checksOnly = process.argv.includes("--checks-only");
const benchmarkOnly = process.argv.includes("--benchmark-only");
const root = resolve("test-results/projects/itsdangerous");
const expected = "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd";
if (
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim() !== expected
)
  throw Error("Unexpected fixture revision");
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw Error("Fixture has changes; inspect before running");
await build({
  entryPoints: ["extension/test/realProjectIntegration.ts"],
  outfile: "extension/out/real-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
await mkdir(resolve("test-results/local-project-profiles"), {
  recursive: true,
});
const profile = await mkdtemp(
  resolve("test-results/local-project-profiles/run-"),
);
const python = resolve(
  process.platform === "win32"
    ? "test-results/python-venv/Scripts/python.exe"
    : "test-results/python-venv/bin/python",
);
const reportFile = resolve(
  benchmarkOnly
    ? "test-results/local-project-benchmark.json"
    : checksOnly
      ? "test-results/local-project-checks.json"
      : "test-results/local-project-report.json",
);
const fixtureFolder = resolve(root, ".vscode"),
  fixtureConfig = resolve(fixtureFolder, "tasks.json");
let madeFolder = false,
  wroteConfig = false;
try {
  if (benchmarkOnly) {
    // Prepare the fixture before opening VS Code, so setup watcher events do not
    // invalidate a check that starts immediately after extension activation.
    try {
      await mkdir(fixtureFolder);
      madeFolder = true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    await writeFile(
      fixtureConfig,
      JSON.stringify(
        {
          version: "2.0.0",
          tasks: [
            {
              label: "itsdangerous pytest",
              type: "process",
              command: python,
              args: [
                "-m",
                "pytest",
                "-q",
                `--junitxml=${reportFile.replace(/\.json$/, ".junit.xml")}`,
              ],
              options: { cwd: root },
              group: "test",
              problemMatcher: [],
            },
            {
              label: "itsdangerous measure",
              type: "process",
              command: python,
              args: [resolve("scripts/measure-itsdangerous.py"), root],
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
  }
  await runTests({
    version: "1.96.4",
    extensionDevelopmentPath: resolve("extension"),
    extensionTestsPath: resolve("extension/out/real-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_PROJECT_BENCHMARK_ONLY: benchmarkOnly ? "1" : "0",
      PUREOBOM_BENCHMARK_FIXTURE: resolve("scripts/measure-itsdangerous.py"),
      PUREOBOM_PROJECT_CHECKS_ONLY: checksOnly ? "1" : "0",
      PUREOBOM_PROJECT_PORT: process.env.PUREOBOM_PROJECT_PORT || "11435",
      PUREOBOM_PROJECT_MODEL:
        process.env.PUREOBOM_PROJECT_MODEL || "qwen2.5-coder:3b",
      PUREOBOM_PROJECT_PYTHON: python,
      PUREOBOM_PROJECT_REPORT: reportFile,
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
      resolve("test-results/local-project-vscode-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(fixtureConfig);
  if (madeFolder) await rmdir(fixtureFolder);
}
