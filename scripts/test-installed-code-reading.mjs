import { runTests, runVSCodeCommand } from "@vscode/test-electron";
import { build } from "esbuild";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import JSZip from "jszip";

// Explicit opt-in, fresh local fixture, real model, isolated installed-extension profile.
assert.equal(
  process.env.PUREOBOM_RUN_CODEX,
  "1",
  "Enable the real Codex validation explicitly.",
);
const exec = promisify(execFile);
const directory = resolve("test-results/code-reading");
await mkdir(directory, { recursive: true });
const run = await mkdtemp(resolve(directory, "installed-"));
const source = resolve(run, "project"),
  profile = resolve(run, "profile"),
  extensions = resolve(run, "extensions"),
  driver = resolve(run, "driver");
await cp("tests/fixtures/code-reading-project", source, { recursive: true });
const git = async (...args) =>
  (await exec("git", ["-C", source, ...args], { windowsHide: true })).stdout;
await git("init");
await git("config", "user.name", "Code reading fixture");
await git("config", "user.email", "fixture@example.invalid");
await git("config", "core.autocrlf", "false");
await git("add", ".");
await git("commit", "-m", "Original shipping behavior");
const head = (await git("rev-parse", "HEAD")).trim();
await mkdir(resolve(profile, "User"), { recursive: true });
await writeFile(
  resolve(profile, "User/settings.json"),
  JSON.stringify({
    "pureobom.codexPath": process.env.PUREOBOM_CODEX_PATH || "codex",
    "extensions.autoUpdate": false,
    "typescript.disableAutomaticTypeAcquisition": true,
    "workbench.startupEditor": "none",
    "window.restoreWindows": "none",
  }),
);
await mkdir(driver);
await writeFile(
  resolve(driver, "package.json"),
  JSON.stringify({
    name: "code-reading-test-driver",
    publisher: "pureobom-tests",
    version: "0.0.0",
    engines: { vscode: "^1.96.0" },
    main: "driver.cjs",
    activationEvents: ["onStartupFinished"],
  }),
);
await writeFile(resolve(driver, "driver.cjs"), "exports.activate=()=>{};");
const testEntry = resolve(driver, "tests.cjs");
await build({
  entryPoints: ["extension/test/codeReading.ts"],
  outfile: testEntry,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
});
const manifest = JSON.parse(await readFile("extension/package.json", "utf8"));
const vsixPath = resolve(`release/pureobom-${manifest.version}.vsix`);
const bytes = await readFile(vsixPath);
const zip = await JSZip.loadAsync(bytes);
const bundleHash = createHash("sha256")
  .update(await zip.file("extension/out/extension.cjs").async("nodebuffer"))
  .digest("hex");
const installed = await runVSCodeCommand(
  [
    "--install-extension",
    vsixPath,
    "--force",
    "--user-data-dir",
    profile,
    "--extensions-dir",
    extensions,
  ],
  { version: "1.96.4" },
);
console.log(installed.stdout.trim());
console.log(`Installed code reading validation: ${run}`);
const reportPath = resolve(run, "report.json");
await writeFile(
  resolve(directory, "latest-installed-run.json"),
  JSON.stringify(
    {
      run,
      reportPath,
      source,
      head,
      vsixHash: createHash("sha256").update(bytes).digest("hex"),
      bundleHash,
    },
    null,
    2,
  ),
);
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: driver,
  extensionTestsPath: testEntry,
  extensionTestsEnv: {
    PUREOBOM_CODE_READING_REPORT: reportPath,
    PUREOBOM_TEST_NODE: process.execPath,
    PUREOBOM_CODE_READING_BUNDLE_SHA256: bundleHash,
  },
  launchArgs: [
    source,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--user-data-dir",
    profile,
    "--extensions-dir",
    extensions,
  ],
});
assert.equal((await git("rev-parse", "HEAD")).trim(), head);
assert.equal(await git("diff", "--cached"), "");
assert.equal(await git("diff"), "");
console.log("Original Git HEAD, index and tracked source preserved.");
