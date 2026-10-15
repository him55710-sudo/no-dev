import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import JSZip from "jszip";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const prefix = `release/pureobom-${version}`;
for (const line of (await readFile(`${prefix}-SHA256SUMS.txt`, "utf8")).trim().split(/\r?\n/)) {
  const [expected, name] = line.split(/\s+/);
  assert.match(name, /^pureobom-[\w.-]+\.(?:zip|vsix)$/);
  const actual = createHash("sha256").update(await readFile(`release/${name}`)).digest("hex");
  assert.equal(actual, expected, `Checksum: ${name}`);
}
const source = await JSZip.loadAsync(await readFile(`${prefix}-source.zip`));
for (const file of ["LICENSE", "README.md", "README.ko.md", "pnpm-lock.yaml", "src/core/scenarios.ts", "src/components/ScenarioLab.tsx", "extension/package.nls.json", "extension/.vscodeignore", ".github/workflows/ci.yml", ".github/workflows/demo.yml", "docs/scenario-preview.png", "docs/RELEASE_VALIDATION.md", "examples/shipping.ts"]) assert.ok(source.file(file), `Missing source: ${file}`);
for (const name of Object.keys(source.files)) assert.ok(!/(^|\/)(node_modules|test-results|\.vscode-test|\.git|\.env[^/]*)(\/|$)/.test(name), `Private/generated path: ${name}`);
assert.equal(JSON.parse(await source.file("package.json").async("string")).version, version);
const demo = await JSZip.loadAsync(await readFile(`${prefix}-demo.zip`));
const html = await demo.file("dist/index.html").async("string");
assert.ok(!/(?:src|href)="\/(?!\/)/.test(html), "Static demo must use relative asset paths");
for (const file of ["scripts/serve.mjs", "START.cmd", "LICENSE", "JSZIP_LICENSE.txt", "extension/THIRD_PARTY_NOTICES.txt"]) assert.ok(demo.file(file), `Missing demo file: ${file}`);
const vsix = await JSZip.loadAsync(await readFile(`${prefix}.vsix`));
const manifest = JSON.parse(await vsix.file("extension/package.json").async("string"));
assert.equal(manifest.version, version);
for (const file of ["extension/out/extension.cjs", "extension/out/worker.cjs", "extension/media/view.js", "extension/media/view.css", "extension/LICENSE.txt", "extension/package.nls.ko.json"]) assert.ok(vsix.file(file), `Missing VSIX file: ${file}`);
assert.ok(!vsix.file("extension/out/integration.cjs"), "Do not ship test harness");
console.log(`Release ${version}: checksums, source manifest, demo assets, licenses and VSIX contents verified.`);
