import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createVSIX } from "@vscode/vsce";
import { bundledNotices } from "./bundled-notices.mjs";
await mkdir("release", { recursive: true });
const manifest = JSON.parse(await readFile("extension/package.json", "utf8"));
const licenses = await Promise.all(
  [
    [
      "web-tree-sitter 0.27.1 — Tree-sitter contributors",
      "node_modules/web-tree-sitter/LICENSE",
    ],
    [
      "tree-sitter-rust 0.24.2 — Max Brunsfeld",
      "extension/runtime/rust/LICENSE",
    ],
    [
      "sqlite3-parser 0.7.1 — Jake Teton-Landis",
      "node_modules/sqlite3-parser/LICENSE",
    ],
    ["parse5 8.0.1 — Ivan Nikulin", "node_modules/parse5/LICENSE"],
    [
      "entities 8.1.0 — Felix Boehm",
      "node_modules/.pnpm/entities@8.1.0/node_modules/entities/LICENSE",
    ],
    ["CSS Tree 3.2.1 — Roman Dvornov", "node_modules/css-tree/LICENSE"],
    [
      "mdn-data 2.27.1 — Mozilla contributors",
      "node_modules/.pnpm/mdn-data@2.27.1/node_modules/mdn-data/LICENSE",
    ],
    [
      "source-map-js 1.2.2 — Mozilla Foundation and contributors",
      "node_modules/.pnpm/source-map-js@1.2.2/node_modules/source-map-js/LICENSE",
    ],
    [
      "jsonc-parser 3.3.1 — Microsoft Corporation",
      "node_modules/jsonc-parser/LICENSE.md",
    ],
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
await writeFile(
  "extension/THIRD_PARTY_NOTICES.txt",
  "LOCAL MODIFICATION: @xyflow/react 12.12.0 ESM bundles include a ResizeObserver " +
    "scheduling/cleanup backport adapted from fpaupier's xyflow/xyflow PR #5999 " +
    "and the pane-disconnect fix described in MokiMeow's PR #6054. " +
    "See patches/README.md in the source distribution. Upstream MIT licenses follow.\n\n" +
    licenses.join("\n") +
    "\n" +
    (await bundledNotices(
      JSON.parse(await readFile("extension/out/bundle-inputs.json", "utf8")),
    )),
);
await createVSIX({
  cwd: resolve("extension"),
  packagePath: resolve(
    process.argv
      .find((arg) => arg.startsWith("--output="))
      ?.slice("--output=".length) ||
      `release/pureobom-${manifest.version}.vsix`,
  ),
  dependencies: false,
  allowMissingRepository: true,
});
