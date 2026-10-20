import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

// Build a separate public entry point; keep the interactive development build intact.
const root = await realpath(process.cwd());
const dist = path.join(root, "dist");
const reader = await readFile(path.join(dist, "index.html"), "utf8");
assert.match(
  reader,
  /<script[^>]+src="\.\/assets\//,
  "Run pnpm build before packaging Pages",
);
const walkthrough = await readFile(
  path.join(dist, "workspace-demo.html"),
  "utf8",
);
assert.ok(
  walkthrough.includes('id="failure"') && walkthrough.includes('id="limits"'),
);
const rewritePreviewLinks = (html) =>
  html.replaceAll('href="./?demo=', 'href="./reader.html?demo=');

await mkdir("release", { recursive: true });
const parent = await realpath("release");
assert.equal(
  parent,
  path.join(root, "release"),
  "Output must stay inside this workspace",
);
const output = path.join(parent, "site");
const marker = ".pureobom-generated-site";
const existing = await lstat(output).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
if (existing) {
  assert.ok(existing.isDirectory() && !existing.isSymbolicLink());
  assert.equal(
    await readFile(path.join(output, marker), "utf8"),
    "pureobom-pages\n",
  );
  // Only this exact, marked build directory may be cleared.
  assert.equal(output, path.join(root, "release", "site"));
  await rm(output, { recursive: true });
}
await mkdir(output);
await writeFile(path.join(output, marker), "pureobom-pages\n");
await cp(dist, output, { recursive: true });
await writeFile(
  path.join(output, "reader.html"),
  reader.replace(/\s*<meta property="og:(?:url|image[^\"]*)"[^>]*>/g, ""),
);
await writeFile(
  path.join(output, "index.html"),
  rewritePreviewLinks(walkthrough),
);
await writeFile(
  path.join(output, "workspace-demo.html"),
  rewritePreviewLinks(walkthrough),
);
const oldVideo = await readFile(path.join(output, "demo.html"), "utf8");
await writeFile(path.join(output, "demo.html"), rewritePreviewLinks(oldVideo));
await cp("LICENSE", path.join(output, "LICENSE.txt"));
await cp(
  "extension/THIRD_PARTY_NOTICES.txt",
  path.join(output, "THIRD_PARTY_NOTICES.txt"),
);
await writeFile(path.join(output, ".nojekyll"), "");

const zip = new JSZip();
const files = {};
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), "Do not package symlinks");
    if (entry.name === marker) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory())
      await collect(path.join(directory, entry.name), name + "/");
    else {
      const bytes = await readFile(path.join(directory, entry.name));
      files[name] = createHash("sha256").update(bytes).digest("hex");
      zip.file(name, bytes);
    }
  }
}
await collect(output);
// Check local links under a repository subpath, not just the origin root.
const base = new URL("https://example.invalid/no-dev/");
for (const name of [
  "index.html",
  "workspace-demo.html",
  "reader.html",
  "demo.html",
]) {
  const html = await readFile(path.join(output, name), "utf8");
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = new URL(match[1].replaceAll("&amp;", "&"), new URL(name, base));
    if (url.origin !== base.origin) continue;
    assert.ok(
      url.pathname.startsWith(base.pathname),
      `Root-relative link: ${name} -> ${url}`,
    );
    const file =
      decodeURIComponent(url.pathname.slice(base.pathname.length)) ||
      "index.html";
    assert.ok(
      Object.hasOwn(files, file),
      `Missing local link: ${name} -> ${file}`,
    );
  }
}
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const archive = `pureobom-${version}-site.zip`;
const bytes = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});
await writeFile(path.join(parent, archive), bytes);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version,
  entry: "index.html",
  interactivePreview: "reader.html?demo=shipping&lang=ko",
  scope:
    "Packaged recorded system-design walkthrough and separate earlier single-file preview. Not a deployment or new implementation run.",
  archive,
  archiveSha256: createHash("sha256").update(bytes).digest("hex"),
  files,
};
await writeFile(
  path.join(parent, "site-evidence.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Pages package verified: ${Object.keys(files).length} files, ${bytes.length} bytes`,
);
console.log(`Preview directory: ${output}`);
console.log(`SHA-256: ${report.archiveSha256}`);
