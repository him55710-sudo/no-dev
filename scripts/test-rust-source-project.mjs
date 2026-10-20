import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/humantime");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (
  git("rev-parse", "HEAD") !== "7994b7129851ea3b0e5df8bee67870898e52fa1c" ||
  git("status", "--porcelain")
)
  throw Error("Expected clean pinned humantime checkout");
if (!process.env.PUREOBOM_TEST_CARGO)
  throw Error("Set an absolute PUREOBOM_TEST_CARGO executable path");
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/rust-source-project.json"),
  events = resolve("test-results/rust-source-project.events.json");
await build({
  entryPoints: ["extension/test/rustSourceProject.ts"],
  outfile: "test-results/rust-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/rust-source-profile-"));
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
            label: "humantime Rust regression",
            type: "process",
            command: process.execPath,
            args: [resolve("scripts/run-humantime-tests.mjs"), root, events],
            options: {
              cwd: root,
              env: {
                PUREOBOM_TEST_CARGO: process.env.PUREOBOM_TEST_CARGO,
                RUSTUP_HOME: process.env.RUSTUP_HOME,
                CARGO_HOME: process.env.CARGO_HOME,
                CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR,
                CARGO_ENCODED_RUSTFLAGS: process.env.CARGO_ENCODED_RUSTFLAGS,
                CARGO_ENCODED_RUSTDOCFLAGS:
                  process.env.CARGO_ENCODED_RUSTDOCFLAGS,
                PATH: process.env.PATH,
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
    extensionTestsPath: resolve("test-results/rust-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_TEST_CARGO: process.env.PUREOBOM_TEST_CARGO,
      PUREOBOM_RUST_SOURCE_REPORT: report,
      PUREOBOM_RUST_SOURCE_EVENTS: events,
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
      resolve("test-results/rust-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(config);
  if (madeFolder) await rmdir(folder);
}
if (git("status", "--porcelain"))
  throw Error("Fixture was not restored cleanly");
