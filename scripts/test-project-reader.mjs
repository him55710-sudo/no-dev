import { runTests, runVSCodeCommand } from "@vscode/test-electron";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const base = resolve("test-results/project-reader"),
  profile = resolve(base, "installed-profile"),
  extensions = resolve(base, "installed-extensions"),
  driver = resolve(base, "driver");
await mkdir(driver, { recursive: true });
await mkdir(resolve(profile, "User"), { recursive: true });
await writeFile(
  resolve(profile, "User/settings.json"),
  JSON.stringify({
    "extensions.autoUpdate": false,
    "typescript.disableAutomaticTypeAcquisition": true,
    "workbench.startupEditor": "none",
  }),
);
await writeFile(
  resolve(driver, "package.json"),
  JSON.stringify({
    name: "project-reader-test-driver",
    publisher: "pureobom-tests",
    version: "0.0.0",
    engines: { vscode: "^1.96.0" },
    main: "driver.cjs",
    activationEvents: ["onStartupFinished"],
  }),
);
await writeFile(resolve(driver, "driver.cjs"), "exports.activate=()=>{};");
await build({
  entryPoints: ["extension/test/projectReader.ts"],
  outfile: "extension/out/project-reader-integration.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
});
const vsix = resolve("release/pureobom-0.7.0-project.vsix");
const installed = await runVSCodeCommand(
  [
    "--install-extension",
    vsix,
    "--force",
    "--user-data-dir",
    profile,
    "--extensions-dir",
    extensions,
  ],
  { version: "1.96.4" },
);
console.log(installed.stdout.trim());
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: driver,
  extensionTestsPath: resolve("extension/out/project-reader-integration.cjs"),
  extensionTestsEnv: {
    PUREOBOM_REVIEW_SCREENSHOTS: process.env.PUREOBOM_REVIEW_SCREENSHOTS || "0",
    PUREOBOM_PROJECT_READER_REPORT: resolve(base, "installed-live.json"),
    PUREOBOM_TEST_NODE: resolve(base, "node-v22.21.1-win-x64/node.exe"),
  },
  launchArgs: [
    resolve(
      process.env.LOCALAPPDATA,
      "Temp/pureobom-project-reader/escape-string-regexp",
    ),
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
