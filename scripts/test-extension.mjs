import { runTests } from "@vscode/test-electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// A workspace may itself live inside an editor's hidden worktree directory.
const workspaces = resolve("test-results/extension-workspaces/.hidden-parent");
await mkdir(workspaces, { recursive: true });
const workspace = await mkdtemp(resolve(workspaces, "run-"));
await writeFile(
  resolve(workspace, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      noEmit: true,
      strict: true,
      types: [],
      jsx: "react-jsx",
    },
    include: ["*.ts", "*.tsx"],
    typeAcquisition: { enable: false },
  }),
);
await writeFile(
  resolve(workspace, "shipping.ts"),
  `import { helper } from './helper';\nconst freeShippingThreshold = 50000;\nconst shippingFee = 3000;\nexport function calculateShipping(subtotal: number) {\n  if (subtotal < 0) throw new Error('negative');\n  if (subtotal >= freeShippingThreshold) return 0;\n  return shippingFee;\n}\n`,
);
await writeFile(resolve(workspace, "helper.ts"), "export const helper = 1;\n");
await mkdir(resolve(workspace, ".private"));
await writeFile(
  resolve(workspace, ".private/hidden.ts"),
  "export const hidden = 1;\n",
);
await mkdir(resolve(workspace, ".vscode"), { recursive: true });
await writeFile(
  resolve(workspace, ".vscode/tasks.json"),
  JSON.stringify(
    {
      version: "2.0.0",
      tasks: [
        [
          "Pureobom check success",
          "require('node:assert/strict').equal(2 + 2, 4); console.log('assertion passed')",
        ],
        ["Pureobom check failure", "process.exit(7)"],
        ["Pureobom check delayed", "setTimeout(() => process.exit(0), 2000)"],
        ["Pureobom check cancel", "setInterval(() => {}, 1000)"],
        ["Pureobom check shell", "process.exit(0)"],
        ["Pureobom check background", "process.exit(0)"],
      ].map(([label, code]) => ({
        label,
        type: label.endsWith("shell") ? "shell" : "process",
        isBackground: label.endsWith("background"),
        command: process.execPath,
        args: [
          "-e",
          label.endsWith("shell") ? { value: code, quoting: "strong" } : code,
        ],
        group: "test",
        problemMatcher: [],
      })),
    },
    null,
    2,
  ),
);
const profiles = resolve("test-results/vscode-test-profiles");
await mkdir(profiles, { recursive: true });
const profile = await mkdtemp(resolve(profiles, "run-"));
await mkdir(resolve(profile, "User"));
await writeFile(
  resolve(profile, "User/settings.json"),
  JSON.stringify({ "typescript.tsserver.log": "verbose" }),
);
await runTests({
  version: "1.96.4",
  extensionDevelopmentPath: resolve("extension"),
  extensionTestsPath: resolve("extension/out/integration.cjs"),
  extensionTestsEnv: {
    PUREOBOM_INTEGRATION_REPORT: resolve(
      "test-results/extension-integration.json",
    ),
  },
  launchArgs: [
    workspace,
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--user-data-dir",
    profile,
    "--extensions-dir",
    resolve("test-results/vscode-extensions"),
  ],
});
