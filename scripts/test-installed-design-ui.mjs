// Manual UI validation only. The test transport is not shipped in the VSIX.
import assert from "node:assert/strict";
import { runTests, runVSCodeCommand } from "@vscode/test-electron";
import { build } from "esbuild";
import JSZip from "jszip";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

assert.equal(
  process.env.PUREOBOM_DESIGN_UI,
  "1",
  "Explicitly enable the manual installed UI test.",
);
const realProvider = !!process.argv[2];
if (realProvider) {
  assert.equal(
    process.env.PUREOBOM_RUN_CODEX,
    "1",
    "Real-provider mode requires explicit opt-in.",
  );
  assert.ok(
    process.env.PUREOBOM_CODEX_PATH,
    "Pass the reviewed Codex executable path.",
  );
}
const directory = await mkdtemp(resolve(tmpdir(), "pureobom-installed-ui-"));
const source = resolve(directory, "project"),
  profile = resolve(directory, "profile"),
  extensions = resolve(directory, "extensions"),
  driver = resolve(directory, "driver");
const exec = promisify(execFile);
const git = async (...args) =>
  (
    await exec("git", ["-C", source, ...args], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
if (realProvider) {
  // A disposable clone of a reviewed local baseline. Never run in the user's original.
  await exec(
    "git",
    ["clone", "--no-hardlinks", resolve(process.argv[2]), source],
    { windowsHide: true },
  );
} else {
  await cp("tests/fixtures/installed-recovery", source, { recursive: true });
  await git("init");
  await git("config", "user.name", "Installed UI fixture");
  await git("config", "user.email", "fixture@example.invalid");
  await git("config", "core.autocrlf", "false");
  await git("add", ".");
  await git("commit", "-m", "Installed UI fixture");
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalHashes = {};
for (const path of (await git("ls-files", "-z")).split("\0").filter(Boolean))
  originalHashes[path] = digest(await readFile(resolve(source, path)));
await mkdir(resolve(profile, "User"), { recursive: true });
await writeFile(
  resolve(profile, "User/settings.json"),
  JSON.stringify({
    "pureobom.codexPath": realProvider
      ? process.env.PUREOBOM_CODEX_PATH
      : process.execPath,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "workbench.startupEditor": "none",
    "telemetry.telemetryLevel": "off",
  }),
);
await mkdir(driver);
await writeFile(
  resolve(driver, "package.json"),
  JSON.stringify({
    name: "installed-ui-driver",
    publisher: "pureobom-tests",
    version: "0.0.0",
    engines: { vscode: "^1.96.0" },
    main: "driver.cjs",
    activationEvents: ["onStartupFinished"],
  }),
);
await writeFile(resolve(driver, "driver.cjs"), "exports.activate=()=>{};\n");
await build({
  entryPoints: ["extension/test/installedDesignUI.ts"],
  outfile: resolve(driver, "tests.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  logLevel: "info",
});
const { version } = JSON.parse(
  await readFile("extension/package.json", "utf8"),
);
const vsixPath = resolve(`release/pureobom-${version}.vsix`),
  vsix = await readFile(vsixPath),
  zip = await JSZip.loadAsync(vsix);
const files = {};
for (const path of [
  "out/extension.cjs",
  "out/worker.cjs",
  "media/design.js",
  "media/design.css",
])
  files[path] = digest(await zip.file(`extension/${path}`).async("nodebuffer"));
await runVSCodeCommand(
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
const configuration = {
  directory,
  source,
  extensions,
  version,
  artifact: { vsixSha256: digest(vsix), files },
  token: randomBytes(32).toString("hex"),
  realProvider,
  originalHashes,
  originalHead: (await git("rev-parse", "HEAD")).trim(),
  originalIndex: await git("diff", "--cached"),
  originalStatus: await git("status", "--porcelain"),
};
await writeFile(
  resolve(directory, "configuration.json"),
  JSON.stringify(configuration, null, 2),
);
console.log(`INSTALLED UI RUN ${directory}`);
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: driver,
  extensionTestsPath: resolve(driver, "tests.cjs"),
  extensionTestsEnv: {
    PUREOBOM_UI_CONFIGURATION: resolve(directory, "configuration.json"),
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
const report = await readFile(resolve(directory, "report.json"), "utf8");
await mkdir("test-results", { recursive: true });
await writeFile("test-results/installed-design-ui.json", report);
console.log(`INSTALLED UI HOST CHECKS PASSED ${resolve(directory, "report.json")}`);
