import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createVSIX } from "@vscode/vsce";
import { bundledNotices } from "./bundled-notices.mjs";
await mkdir("release", { recursive: true });
const manifest = JSON.parse(await readFile("extension/package.json", "utf8"));
const inputs = JSON.parse(
  await readFile("extension/out/bundle-inputs.json", "utf8"),
);
await writeFile(
  "extension/THIRD_PARTY_NOTICES.txt",
  await bundledNotices(inputs),
);
await createVSIX({
  cwd: resolve("extension"),
  packagePath: resolve(`release/pureobom-${manifest.version}.vsix`),
  dependencies: false,
  allowMissingRepository: true,
});
