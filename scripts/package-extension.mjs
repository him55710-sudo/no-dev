import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createVSIX } from "@vscode/vsce";
await mkdir("release", { recursive: true });
const manifest = JSON.parse(await readFile("extension/package.json", "utf8"));
const licenses = await Promise.all(
  [
    [
      "TypeScript 5.9.3 — Microsoft Corporation",
      "node_modules/typescript/LICENSE.txt",
    ],
    [
      "React 19.2.0 — Meta Platforms, Inc. and affiliates",
      "node_modules/react/LICENSE",
    ],
    [
      "React DOM 19.2.0 — Meta Platforms, Inc. and affiliates",
      "node_modules/react-dom/LICENSE",
    ],
    [
      "Scheduler 0.27.0 — Meta Platforms, Inc. and affiliates",
      "node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler/LICENSE",
    ],
  ].map(
    async ([title, path]) =>
      `${title}\n${"=".repeat(72)}\n${await readFile(path, "utf8")}\n`,
  ),
);
await writeFile("extension/THIRD_PARTY_NOTICES.txt", licenses.join("\n"));
await createVSIX({
  cwd: resolve("extension"),
  packagePath: resolve(`release/pureobom-${manifest.version}.vsix`),
  dependencies: false,
  allowMissingRepository: true,
});
