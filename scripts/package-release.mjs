import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const extension = JSON.parse(await readFile("extension/package.json", "utf8"));
if (manifest.version !== extension.version)
  throw Error("Root and extension versions must match");
const version = manifest.version;
const output = `release/pureobom-${version}`;
const source = new JSZip();
const excluded = new Set(["out", "node_modules", "view.js", "view.css"]);
async function addDirectory(zip, directory, filter = () => true) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const relative = `${directory}/${entry.name}`;
    if (!filter(entry.name, relative) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await addDirectory(zip, relative, filter);
    else zip.file(relative, await readFile(relative));
  }
}
for (const directory of [
  "src",
  "tests",
  "scripts",
  "public",
  "examples",
  "validation",
  "patches",
  "docs",
  ".github",
  "extension",
]) {
  await addDirectory(
    source,
    directory,
    (name, relative) =>
      !excluded.has(name) && !relative.endsWith(".tsbuildinfo"),
  );
}
for (const file of [
  "README.md",
  "README.ko.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  ".gitignore",
  "START.cmd",
])
  source.file(file, await readFile(file));
await mkdir("release", { recursive: true });
const options = {
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
};
await writeFile(`${output}-source.zip`, await source.generateAsync(options));
const web = new JSZip();
await addDirectory(web, "dist");
for (const file of [
  "scripts/serve.mjs",
  "START.cmd",
  "LICENSE",
  "extension/THIRD_PARTY_NOTICES.txt",
])
  web.file(file, await readFile(file));
web.file(
  "JSZIP_LICENSE.txt",
  await readFile("node_modules/jszip/LICENSE.markdown"),
);
web.file(
  "README.txt",
  `Pureobom ${version}\n\nRequires Node.js 24+. No npm install is needed for this prebuilt demo.\nWindows: double-click START.cmd.\nmacOS/Linux: node scripts/serve.mjs\nSystem design walkthrough: http://127.0.0.1:4173/workspace-demo.html\nThe walkthrough contains recorded screenshots and evidence, including a separate deliberate failure; it does not run a model or change code. Native VS Code Webview interaction remains unverified.\nEarlier single-file interactive preview: http://127.0.0.1:4173/?demo=shipping&lang=en\nKorean: http://127.0.0.1:4173/?demo=shipping&lang=ko\nKeep the server running. Ctrl+C stops it.\nAll analysis runs locally; demo mode does not read or save your workspace.\nThe single-file preview has limited JS/TS syntax and edits, not a full application test.\n`,
);
await writeFile(`${output}-demo.zip`, await web.generateAsync(options));
const artifacts = [
  `${output}.vsix`,
  `${output}-source.zip`,
  `${output}-demo.zip`,
];
const checksums = [];
for (const file of artifacts) {
  const data = await readFile(file);
  checksums.push(
    `${createHash("sha256").update(data).digest("hex")}  ${path.basename(file)}`,
  );
  console.log(`${path.basename(file)}: ${data.length} bytes`);
}
await writeFile(`${output}-SHA256SUMS.txt`, checksums.join("\n") + "\n");
