import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import JSZip from "jszip";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const prefix = `release/pureobom-${version}`;
for (const line of (await readFile(`${prefix}-SHA256SUMS.txt`, "utf8"))
  .trim()
  .split(/\r?\n/)) {
  const [expected, name] = line.split(/\s+/);
  assert.match(name, /^pureobom-[\w.-]+\.(?:zip|vsix)$/);
  const actual = createHash("sha256")
    .update(await readFile(`release/${name}`))
    .digest("hex");
  assert.equal(actual, expected, `Checksum: ${name}`);
}
const source = await JSZip.loadAsync(await readFile(`${prefix}-source.zip`));
for (const file of [
  "LICENSE",
  "README.md",
  "README.ko.md",
  "pnpm-lock.yaml",
  "src/core/scenarios.ts",
  "src/components/ScenarioLab.tsx",
  "extension/src/agentHost.ts",
  "extension/src/agent/host.ts",
  "extension/src/agent/hostProtocol.ts",
  "extension/src/agent/managedJobs.ts",
  "tests/agent-host.test.ts",
  "extension/src/agent/ownedProcess.ts",
  "tests/owned-process.test.ts",
  "scripts/test-owned-process-live.mjs",
  "docs/WINDOWS_PROCESS_SCOPE.md",
  "extension/src/navigationStore.ts",
  "src/workspace/navigation.ts",
  "src/workspace/navigationWriter.ts",
  "src/workspace/useWorkspaceNavigation.ts",
  "tests/workspace-navigation.test.ts",
  "tests/navigation-writer.test.ts",
  "src/workspace/observations.ts",
  "src/workspace/ObservationComparison.tsx",
  "tests/workspace-observations.test.ts",
  "docs/WORKSPACE_OBSERVATIONS.md",
  "extension/package.nls.json",
  "extension/.vscodeignore",
  ".github/workflows/ci.yml",
  ".github/workflows/demo.yml",
  "docs/scenario-preview.png",
  "docs/RELEASE_VALIDATION.md",
  "examples/shipping.ts",
])
  assert.ok(source.file(file), `Missing source: ${file}`);
for (const name of Object.keys(source.files))
  assert.ok(
    !/(^|\/)(node_modules|test-results|\.vscode-test|\.git|\.env[^/]*)(\/|$)/.test(
      name,
    ),
    `Private/generated path: ${name}`,
  );
assert.equal(
  JSON.parse(await source.file("package.json").async("string")).version,
  version,
);
const demo = await JSZip.loadAsync(await readFile(`${prefix}-demo.zip`));
const html = await demo.file("dist/index.html").async("string");
assert.ok(
  !/(?:src|href)="\/(?!\/)/.test(html),
  "Static demo must use relative asset paths",
);
for (const file of [
  "scripts/serve.mjs",
  "START.cmd",
  "LICENSE",
  "JSZIP_LICENSE.txt",
  "extension/THIRD_PARTY_NOTICES.txt",
])
  assert.ok(demo.file(file), `Missing demo file: ${file}`);
const vsix = await JSZip.loadAsync(await readFile(`${prefix}.vsix`));
const manifest = JSON.parse(
  await vsix.file("extension/package.json").async("string"),
);
assert.equal(manifest.version, version);
for (const file of [
  "extension/out/extension.cjs",
  "extension/out/worker.cjs",
  "extension/out/agent-host.cjs",
  "extension/media/view.js",
  "extension/media/view.css",
  "extension/media/design.js",
  "extension/media/design.css",
  "extension/LICENSE.txt",
  "extension/package.nls.ko.json",
])
  assert.ok(vsix.file(file), `Missing VSIX file: ${file}`);
assert.ok(
  !vsix.file("extension/out/integration.cjs"),
  "Do not ship test harness",
);
for (const name of Object.keys(vsix.files).filter((name) =>
  /^extension\/out\/.*\.cjs$/.test(name),
))
  assert.ok(
    [
      "extension/out/extension.cjs",
      "extension/out/worker.cjs",
      "extension/out/agent-host.cjs",
    ].includes(name),
    `Unexpected runtime bundle: ${name}`,
  );
// Execute the shipped analysis worker, so an accidentally unbundled dependency
// cannot pass merely because the archive contains a file called worker.cjs.
const workerDirectory = await mkdtemp(join(tmpdir(), "pureobom-package-"));
const workerFile = join(workerDirectory, "worker.cjs");
await writeFile(
  workerFile,
  await vsix.file("extension/out/worker.cjs").async("string"),
);
const shippedWorker = new Worker(workerFile, {
  env: { ...process.env, NODE_PATH: "" },
});
try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Packaged worker startup timed out")),
      20000,
    );
    shippedWorker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    shippedWorker.once("message", (message) => {
      clearTimeout(timer);
      message.error ? reject(Error(message.error)) : resolve(message.result);
    });
    shippedWorker.postMessage({
      id: 1,
      type: "validateAssistant",
      payload: { language: "jsonc", source: '{ // shipping\n "fee": 3000,\n}' },
    });
  });
  assert.equal(
    result.status,
    "syntax-passed",
    "Packaged JSONC parser runs without node_modules",
  );
} finally {
  await shippedWorker.terminate();
  await unlink(workerFile);
  await rmdir(workerDirectory);
}
console.log(
  `Release ${version}: checksums, source manifest, demo assets, licenses, VSIX contents and packaged worker verified.`,
);
