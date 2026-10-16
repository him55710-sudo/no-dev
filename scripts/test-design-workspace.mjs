import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir("test-results/design-workspace", { recursive: true });
const run = await mkdtemp(resolve("test-results/design-workspace/run-"));
const workspace = resolve(run, "project");
await cp("examples/system-workspace", workspace, { recursive: true });
await build({
  entryPoints: ["extension/test/designWorkspace.ts"],
  outfile: "extension/out/design-integration.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  logLevel: "info",
});
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: resolve("extension"),
  extensionTestsPath: resolve("extension/out/design-integration.cjs"),
  launchArgs: [
    workspace,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--user-data-dir",
    resolve(run, "profile"),
    "--extensions-dir",
    resolve(run, "extensions"),
  ],
});
