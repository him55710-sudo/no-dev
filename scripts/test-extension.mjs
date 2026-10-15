import { runTests } from "@vscode/test-electron";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const workspace = resolve("test-results/extension-workspace");
await mkdir(workspace, { recursive: true });
await writeFile(
  resolve(workspace, "shipping.ts"),
  `import { helper } from './helper';\nconst freeShippingThreshold = 50000;\nconst shippingFee = 3000;\nexport function calculateShipping(subtotal: number) {\n  if (subtotal < 0) throw new Error('negative');\n  if (subtotal >= freeShippingThreshold) return 0;\n  return shippingFee;\n}\n`,
);
await writeFile(resolve(workspace, "helper.ts"), "export const helper = 1;\n");
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: resolve("extension"),
  extensionTestsPath: resolve("extension/out/integration.cjs"),
  launchArgs: [
    workspace,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--user-data-dir",
    resolve("test-results/vscode-user"),
    "--extensions-dir",
    resolve("test-results/vscode-extensions"),
  ],
});
