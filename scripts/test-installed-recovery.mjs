import { runTests, runVSCodeCommand } from "@vscode/test-electron";
import { build } from "esbuild";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const exec = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directory = await mkdtemp(
  resolve(tmpdir(), "pureobom-installed-recovery-"),
);
const source = resolve(directory, "project"),
  profile = resolve(directory, "profile"),
  extensions = resolve(directory, "extensions"),
  driver = resolve(directory, "driver");
await cp("tests/fixtures/installed-recovery", source, { recursive: true });
async function git(...args) {
  return (await exec("git", ["-C", source, ...args], { windowsHide: true }))
    .stdout;
}
await git("init");
await git("config", "user.name", "Installed recovery fixture");
await git("config", "user.email", "fixture@example.invalid");
await git("config", "core.autocrlf", "false");
await git("add", ".");
await git("commit", "-m", "Recovery fixture");
const policy = await readFile(resolve(source, "policy.js"), "utf8");
await writeFile(
  resolve(source, "policy.js"),
  "// user's staged note\r\n" + policy,
);
await git("add", "policy.js");
await writeFile(
  resolve(source, "policy.js"),
  "// user's unstaged note\r\n// user's staged note\r\n" + policy,
);
const originals = {};
for (const path of [
  "policy.js",
  "service.js",
  "ui.js",
  "test.js",
  "app-server",
  "package.json",
])
  originals[path] = digest(await readFile(resolve(source, path)));
const checkpoint = resolve(directory, "checkpoint.json");
await writeFile(
  checkpoint,
  JSON.stringify(
    {
      originalHashes: originals,
      originalHead: (await git("rev-parse", "HEAD")).trim(),
      originalIndex: await git("diff", "--cached"),
      originalStatus: await git("status", "--porcelain"),
      phases: [],
    },
    null,
    2,
  ),
);
await mkdir(resolve(profile, "User"), { recursive: true });
await writeFile(
  resolve(profile, "User/settings.json"),
  JSON.stringify({
    "pureobom.codexPath": process.execPath,
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
    name: "installed-recovery-driver",
    publisher: "pureobom-tests",
    version: "0.0.0",
    engines: { vscode: "^1.96.0" },
    main: "driver.cjs",
    activationEvents: ["onStartupFinished"],
  }),
);
await writeFile(resolve(driver, "driver.cjs"), "exports.activate=()=>{};\n");
const testEntry = resolve(driver, "tests.cjs");
await build({
  entryPoints: ["extension/test/installedRecovery.ts"],
  outfile: testEntry,
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
  "THIRD_PARTY_NOTICES.txt",
])
  files[path] = digest(await zip.file(`extension/${path}`).async("nodebuffer"));
const installation = await runVSCodeCommand(
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
console.log(installation.stdout.trim());
console.log(`Installed recovery run: ${directory}`);
const expected = {
  version,
  vsixSha256: digest(vsix),
  extensionsPath: extensions,
  files,
};
const phases = [
  "prepare-review",
  "review-and-apply",
  "undo-after-restart",
  "crash-during-apply",
  "recover-after-crash",
];
for (const phase of phases) {
  console.log(`Starting installed VS Code phase: ${phase}`);
  let failure;
  try {
    await runTests({
      version: "1.96.4",
      extensionDevelopmentPath: driver,
      extensionTestsPath: testEntry,
      extensionTestsEnv: {
        PUREOBOM_RECOVERY_PHASE: phase,
        PUREOBOM_RECOVERY_CHECKPOINT: checkpoint,
        PUREOBOM_JOB_STORAGE: resolve(
          profile,
          "User/globalStorage/pureobom-local.pureobom/implementation-jobs",
        ),
        PUREOBOM_EXPECTED_INSTALL: JSON.stringify(expected),
        PUREOBOM_FIXTURE_NODE: process.execPath,
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
  } catch (error) {
    failure = error;
  }
  if (phase === "crash-during-apply") {
    const state = JSON.parse(await readFile(checkpoint, "utf8"));
    if (
      !failure ||
      !state.crash ||
      state.crash.journalState !== "applying" ||
      state.crash.afterFiles < 1
    )
      throw (
        failure ??
        Error("The intended mid-transaction process exit was not observed")
      );
    state.crash.hostExit = {
      code: failure.code ?? null,
      signal: failure.signal ?? null,
    };
    await writeFile(checkpoint, JSON.stringify(state, null, 2));
  } else if (failure) throw failure;
}
const final = JSON.parse(await readFile(checkpoint, "utf8"));
if (!final.recovered || final.phases.length !== phases.length)
  throw Error("Installed recovery sequence did not finish");
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  vscode: "1.96.4",
  node: process.version,
  artifact: { version, vsixSha256: expected.vsixSha256, files },
  scope:
    "Installed VSIX in Production extension mode across five separate VS Code launches. Calls use the same validated request dispatcher as the Webview; this is not pointer/keyboard UI automation or model-quality evidence.",
  provider:
    "Explicit deterministic local stdio fixture; no external AI inference or credentials used.",
  dependencyEnvironment:
    "Synthetic repository outside the host checkout with no third-party dependencies. Checks use Node's built-in test runner through the real package-manager verification path.",
  phases: final.phases,
  crash: final.crash,
  restoredOriginalFiles: Object.keys(originals),
  preserved: [
    "staged user changes",
    "unstaged user changes",
    "acceptance tests",
    "source HEAD and index",
  ],
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/installed-recovery.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log("INSTALLED RECOVERY PASSED", JSON.stringify(report));
