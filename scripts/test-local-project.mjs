// Opt-in test. Requires the pinned public fixture, isolated Python dependencies, and local Ollama.
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
const checksOnly = process.argv.includes("--checks-only");
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
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: resolve("extension"),
  extensionTestsPath: resolve("extension/out/real-project.cjs"),
  extensionTestsEnv: {
    PUREOBOM_PROJECT_CHECKS_ONLY: checksOnly ? "1" : "0",
    PUREOBOM_PROJECT_PORT: process.env.PUREOBOM_PROJECT_PORT || "11435",
    PUREOBOM_PROJECT_MODEL:
      process.env.PUREOBOM_PROJECT_MODEL || "qwen2.5-coder:3b",
    PUREOBOM_PROJECT_PYTHON: resolve(
      process.platform === "win32"
        ? "test-results/python-venv/Scripts/python.exe"
        : "test-results/python-venv/bin/python",
    ),
    PUREOBOM_PROJECT_REPORT: resolve(
      checksOnly
        ? "test-results/local-project-checks.json"
        : "test-results/local-project-report.json",
    ),
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
