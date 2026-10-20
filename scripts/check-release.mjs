import { createHash } from "node:crypto";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  unlink,
  rmdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

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
  "patches/@xyflow__react@12.12.0.patch",
  "patches/README.md",
  "pnpm-workspace.yaml",
])
  assert.deepEqual(
    await source.file(file)?.async("nodebuffer"),
    await readFile(file),
    `Source dependency patch: ${file}`,
  );
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
  "docs/IMPLEMENTATION_CONTINUATION.md",
  "scripts/test-live-continuation.mjs",
  "scripts/recover-live-continuation.mjs",
  "docs/LIVE_CONTINUATION.md",
  "docs/SYSTEM_WORKSPACE_DEMO.md",
  "docs/SYSTEM_WORKSPACE_SUPPORT.md",
  "scripts/build-system-demo.mjs",
  "scripts/test-permission-failure.mjs",
  "validation/next-saas-starter/failure-peer.mjs",
  "validation/next-saas-starter/README.md",
  "validation/next-saas-starter/build.mjs",
  "validation/next-saas-starter/build-stripe-preload.cjs",
  "validation/next-saas-starter/database.mjs",
  "validation/next-saas-starter/permissions.fixture.tsx",
  "extension/src/agent/jobs.ts",
  "extension/src/agent/gitWorkspace.ts",
  "tests/agent-recovery.test.ts",
  "tests/agent-workspace.test.ts",
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
for (const file of [
  "workspace-demo.html",
  "workspace-demo.css",
  "media/system-workspace/evidence.json",
  "media/system-workspace/installed-next-applied.jpg",
  "media/system-workspace/installed-next-undone.jpg",
  "media/system-workspace/installed-next-member.jpg",
  "media/system-workspace/installed-next-owner.jpg",
]) {
  assert.deepEqual(
    await demo.file(`dist/${file}`)?.async("nodebuffer"),
    await readFile(`public/${file}`),
    `System walkthrough asset: ${file}`,
  );
}
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
for (const walkthrough of manifest.contributes.walkthroughs) {
  for (const step of walkthrough.steps) {
    const file = `extension/${step.media.markdown}`;
    assert.deepEqual(
      await vsix.file(file)?.async("nodebuffer"),
      await readFile(file),
      `Packaged walkthrough: ${file}`,
    );
    assert.deepEqual(
      await source.file(file)?.async("nodebuffer"),
      await readFile(file),
      `Source walkthrough: ${file}`,
    );
  }
}
assert.match(
  await vsix.file("extension/THIRD_PARTY_NOTICES.txt").async("string"),
  /sqlite3-parser 0\.7\.1/,
);
for (const file of [
  "extension/out/extension.cjs",
  "extension/out/worker.cjs",
  "extension/out/agent-host.cjs",
  "extension/runtime/benchmark.py",
  "extension/runtime/python_source.py",
  "extension/runtime/go_source.go",
  "extension/runtime/PureobomJavaSource.java",
  "extension/runtime/PureobomCSharpSource.cs",
  "extension/runtime/rust/tree-sitter-rust.wasm",
  "extension/runtime/rust/web-tree-sitter.wasm",
  "extension/runtime/rust/LICENSE",
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
await mkdir(join(workerDirectory, "out"));
await mkdir(join(workerDirectory, "runtime/rust"), { recursive: true });
for (const asset of ["tree-sitter-rust.wasm", "web-tree-sitter.wasm"])
  await writeFile(
    join(workerDirectory, "runtime/rust", asset),
    await vsix.file(`extension/runtime/rust/${asset}`).async("nodebuffer"),
  );
const workerFile = join(workerDirectory, "out/worker.cjs");
await writeFile(
  workerFile,
  await vsix.file("extension/out/worker.cjs").async("string"),
);
const shippedWorker = new Worker(workerFile, {
  env: { ...process.env, NODE_PATH: "" },
});
try {
  for (const [language, source] of [
    ["jsonc", '{ // shipping\n "fee": 3000,\n}'],
    ["rust", "fn value()->bool { 123 } fn opaque(){ m!(???); }"],
    ["html", '<p title="한글 &amp; 😀">Hello</p>'],
    ["sql", "SELECT 9_007_199_254_740_993, 'O''Brien';"],
    [
      "css",
      ".grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }",
    ],
  ]) {
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
        payload: {
          language,
          source,
          sqlDialect: language === "sql" ? "sqlite" : undefined,
        },
      });
    });
    assert.equal(
      result.status,
      "syntax-passed",
      `Packaged ${language} parser runs without node_modules`,
    );
  }
  let rustId = 10;
  const rustCall = (type, payload) =>
    new Promise((resolve, reject) => {
      const id = ++rustId;
      const cleanup = () => {
        clearTimeout(timer);
        shippedWorker.off("message", onMessage);
        shippedWorker.off("error", onError);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onMessage = (message) => {
        if (message.id !== id) return;
        cleanup();
        message.error ? reject(Error(message.error)) : resolve(message.result);
      };
      const timer = setTimeout(
        () => onError(Error("Packaged Rust worker timed out")),
        20000,
      );
      shippedWorker.on("message", onMessage);
      shippedWorker.once("error", onError);
      shippedWorker.postMessage({ id, type, payload });
    });
  const rustFile = {
    path: "sample.rs",
    content:
      "\uFEFF// 😀\r\nconst LIMIT:u64=9007199254740993u64;\r\nfn f()->bool { true }",
  };
  const rustAnalysis = await rustCall("rust", {
    file: rustFile,
    action: "analyze",
  });
  assert.ok(rustAnalysis.rust);
  const rustRule = rustAnalysis.rules.find(
    (r) => r.raw === "9007199254740993u64",
  );
  assert.equal(rustRule.line, 2);
  assert.equal(
    rustFile.content.slice(rustRule.start, rustRule.end),
    rustRule.raw,
  );
  const rustPatch = await rustCall("rust", {
    file: rustFile,
    action: "patch",
    ruleId: rustRule.id,
    value: "9007199254740995u64",
  });
  assert.equal(
    rustPatch.updated,
    rustFile.content.replace("9007199254740993u64", "9007199254740995u64"),
  );
  assert.equal(
    (
      await rustCall("validateAssistant", {
        language: "rust",
        source: "fn bad( {",
      })
    ).status,
    "syntax-failed",
  );
  await assert.rejects(
    rustCall("rust", {
      file: rustFile,
      action: "patch",
      ruleId: rustRule.id,
      value: "1; run(); const X:()=1",
    }),
  );
  console.log(
    "Packaged Rust WASM: parsing, Unicode/CRLF offsets, exact literal editing, malformed syntax and injection rejection verified outside the workspace.",
  );
} finally {
  await shippedWorker.terminate();
  await unlink(workerFile);
  for (const asset of ["tree-sitter-rust.wasm", "web-tree-sitter.wasm"])
    await unlink(join(workerDirectory, "runtime/rust", asset));
  await rmdir(join(workerDirectory, "runtime/rust"));
  await rmdir(join(workerDirectory, "runtime"));
  await rmdir(join(workerDirectory, "out"));
  await rmdir(workerDirectory);
}
console.log(
  `Release ${version}: checksums, source manifest, demo assets, licenses, VSIX contents and packaged worker verified.`,
);
// Run the actual shipped standard-library measurement worker outside the repo.
const measurementDirectory = await mkdtemp(
  join(tmpdir(), "pureobom-measure-package-"),
);
const measurementFile = join(measurementDirectory, "benchmark.py");
await writeFile(
  measurementFile,
  await vsix.file("extension/runtime/benchmark.py").async("string"),
);
try {
  const exec = promisify(execFile);
  const subprocess = exec(
    process.platform === "win32" ? "python" : "python3",
    ["-I", "-S", measurementFile],
    {
      cwd: measurementDirectory,
      timeout: 20000,
      maxBuffer: 65536,
      windowsHide: true,
      encoding: "utf8",
    },
  );
  subprocess.child.stdin.end(
    JSON.stringify({
      argv: [process.execPath, "-e", "console.log('packaged measurement')"],
      cwd: measurementDirectory,
      env: {},
    }) + "\n",
  );
  const { stdout } = await subprocess;
  const event = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .find((event) => event.type === "result");
  assert.equal(
    event?.result.samples.length,
    7,
    "Packaged measurement worker runs all seven samples",
  );
  assert.equal(
    new Set(event.result.samples.map((sample) => sample.stdoutSha256)).size,
    1,
  );
} finally {
  await unlink(measurementFile);
  await rmdir(measurementDirectory);
}
console.log(
  "Packaged Python measurement worker verified outside the workspace.",
);

// Verify the shipped AST helper, with no repository imports or user-code execution.
const pythonDirectory = await mkdtemp(
  join(tmpdir(), "pureobom-python-package-"),
);
const pythonFile = join(pythonDirectory, "python_source.py");
await writeFile(
  pythonFile,
  await vsix.file("extension/runtime/python_source.py").async("string"),
);
try {
  const exec = promisify(execFile);
  const source =
    '# 😀 exact\nlimit = 9007199254740993\ndef check(value):\n    if value < limit:\n        raise ValueError("below")\n    return value\n';
  const invoke = async (action) => {
    const subprocess = exec(
      process.platform === "win32" ? "python" : "python3",
      ["-I", "-S", pythonFile],
      {
        cwd: pythonDirectory,
        timeout: 10000,
        maxBuffer: 65536,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    subprocess.child.stdin.end(
      JSON.stringify({ source, path: "sample.py", ...action }),
    );
    const { stdout } = await subprocess;
    const response = JSON.parse(stdout);
    assert.equal(response.error, undefined);
    return response.result;
  };
  const analysis = await invoke({ action: "analyze" });
  assert.ok(analysis.python.version);
  assert.equal(analysis.functions[0].name, "check");
  assert.equal(analysis.rules[0].value, "9007199254740993");
  assert.equal(
    source.slice(analysis.rules[0].start, analysis.rules[0].end),
    "9007199254740993",
  );
  const patch = await invoke({
    action: "patch",
    ruleId: analysis.rules[0].id,
    value: "9007199254740995",
  });
  assert.equal(
    patch.updated,
    source.replace("9007199254740993", "9007199254740995"),
  );
  assert.equal(patch.semanticChecked, false);
} finally {
  await unlink(pythonFile);
  await rmdir(pythonDirectory);
}
console.log(
  "Packaged Python AST reader and exact literal edit verified outside the workspace.",
);

// Build only the bundled fixed helper. User Go text is stdin data, never compiled.
const goDirectory = await mkdtemp(join(tmpdir(), "pureobom-go-package-"));
const goFile = join(goDirectory, "go_source.go");
const goBinary = join(
  goDirectory,
  process.platform === "win32" ? "reader.exe" : "reader",
);
await writeFile(
  goFile,
  await vsix.file("extension/runtime/go_source.go").async("string"),
);
try {
  const env = Object.fromEntries(
    [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "LOCALAPPDATA",
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  Object.assign(env, {
    GOTOOLCHAIN: "local",
    GOENV: "off",
    GOWORK: "off",
    GO111MODULE: "off",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTELEMETRY: "off",
    GOFLAGS: "",
    CGO_ENABLED: "0",
    GOCACHE: resolve("test-results/go-package-cache"),
  });
  const exec = promisify(execFile);
  await exec(
    process.env.PUREOBOM_TEST_GO || "go",
    ["build", "-trimpath", "-o", goBinary, goFile],
    {
      cwd: goDirectory,
      env,
      timeout: 60000,
      maxBuffer: 65536,
      windowsHide: true,
    },
  );
  const source =
    "package sample\n// 😀 exact\nconst limit = 9007199254740993\nfunc check(value int) (int, error) { if value < limit { return 0, nil }; return value, nil }\n";
  const invoke = async (action) => {
    const subprocess = exec(goBinary, [], {
      cwd: goDirectory,
      env,
      timeout: 10000,
      maxBuffer: 65536,
      windowsHide: true,
      encoding: "utf8",
    });
    subprocess.child.stdin.end(
      JSON.stringify({ source, path: "sample.go", ...action }),
    );
    const { stdout } = await subprocess;
    const response = JSON.parse(stdout);
    assert.equal(response.error, undefined);
    return response.result;
  };
  const analysis = await invoke({ action: "analyze" });
  assert.ok(analysis.go.version);
  assert.equal(analysis.functions[0].name, "check");
  assert.equal(analysis.rules[0].value, "9007199254740993");
  assert.equal(
    source.slice(analysis.rules[0].start, analysis.rules[0].end),
    "9007199254740993",
  );
  const patch = await invoke({
    action: "patch",
    ruleId: analysis.rules[0].id,
    value: "9007199254740995",
  });
  assert.equal(
    patch.updated,
    source.replace("9007199254740993", "9007199254740995"),
  );
  assert.equal(patch.semanticChecked, false);
} finally {
  await unlink(goFile);
  try {
    await unlink(goBinary);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rmdir(goDirectory);
}
console.log(
  "Packaged Go AST reader and exact literal edit verified outside the workspace.",
);

// Compile the shipped fixed helper in isolation; user Java is only parser input.
const javaDirectory = await mkdtemp(join(tmpdir(), "pureobom-java-package-"));
const javaFile = join(javaDirectory, "PureobomJavaSource.java");
await writeFile(
  javaFile,
  await vsix.file("extension/runtime/PureobomJavaSource.java").async("string"),
);
try {
  const env = Object.fromEntries(
    [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "LOCALAPPDATA",
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const home = process.env.PUREOBOM_TEST_JAVA_HOME || process.env.JAVA_HOME;
  const executable = (name) =>
    home
      ? join(home, "bin", name + (process.platform === "win32" ? ".exe" : ""))
      : name;
  const exec = promisify(execFile);
  const options = {
    cwd: javaDirectory,
    env,
    timeout: 60000,
    maxBuffer: 65536,
    windowsHide: true,
    encoding: "utf8",
  };
  await exec(
    executable("javac"),
    [
      "-proc:none",
      "-implicit:none",
      "-encoding",
      "UTF-8",
      "--release",
      "21",
      "-classpath",
      javaDirectory,
      "-sourcepath",
      javaDirectory,
      "-d",
      javaDirectory,
      javaFile,
    ],
    options,
  );
  const source =
    'class Sample {\n // 😀 exact\n long limit = 9007199254740993L;\n int check(int value) { if (value < 0) throw new IllegalArgumentException("negative"); return value; }\n}\n';
  const invoke = async (action, ruleId = "", value = "") => {
    const subprocess = exec(
      executable("java"),
      [
        "-Xmx192m",
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "--class-path",
        javaDirectory,
        "PureobomJavaSource",
      ],
      options,
    );
    subprocess.child.stdin.end(
      [action, "Sample.java", source, ruleId, value]
        .map((s) => Buffer.from(s, "utf8").toString("base64"))
        .join("\n"),
    );
    const { stdout } = await subprocess;
    const response = JSON.parse(stdout);
    assert.equal(response.error, undefined);
    return response.result;
  };
  const analysis = await invoke("analyze");
  assert.ok(analysis.java.version);
  assert.equal(analysis.functions[0].name, "Sample.check(int)");
  assert.equal(analysis.rules[0].value, "9007199254740993L");
  assert.equal(
    source.slice(analysis.rules[0].start, analysis.rules[0].end),
    "9007199254740993L",
  );
  const patch = await invoke(
    "patch",
    analysis.rules[0].id,
    "9007199254740995L",
  );
  assert.equal(
    patch.updated,
    source.replace("9007199254740993L", "9007199254740995L"),
  );
  assert.equal(patch.semanticChecked, false);
} finally {
  if (
    !resolve(javaDirectory).startsWith(resolve(tmpdir()) + sep) ||
    !javaDirectory.split(sep).at(-1).startsWith("pureobom-java-package-")
  )
    throw Error("Unexpected Java package cleanup directory");
  await rm(javaDirectory, { recursive: true, force: true });
}
console.log(
  "Packaged Java AST reader and exact literal edit verified outside the workspace.",
);

// Run the extracted fixed C# helper through the same host wrapper used by the
// extension. Installed-extension tests separately verify the production bundle.
const csharpDirectory = await mkdtemp(
  join(tmpdir(), "pureobom-csharp-package-"),
);
try {
  const helper = join(csharpDirectory, "PureobomCSharpSource.cs");
  await writeFile(
    helper,
    await vsix
      .file("extension/runtime/PureobomCSharpSource.cs")
      .async("nodebuffer"),
  );
  const host = join(csharpDirectory, "host.mjs");
  await build({
    entryPoints: ["extension/src/csharpSource.ts"],
    outfile: host,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
  });
  const { csharpSource } = await import(pathToFileURL(host).href);
  const content =
    '// 😀 한글\r\nclass Sample { ulong limit=9007199254740993UL; string name=@"a""b"; int Check(int x)=>x<0?0:1; }';
  const file = { path: "Sample.cs", content };
  const invoke = (action) =>
    csharpSource(file, helper, join(csharpDirectory, "cache"), action, {
      dotnet: process.env.PUREOBOM_TEST_DOTNET,
    });
  const analysis = await invoke({ action: "analyze" });
  assert.ok(analysis.csharp.version);
  assert.equal(analysis.syntaxValid, true);
  const rule = analysis.rules.find((r) => r.raw === "9007199254740993UL");
  assert.ok(rule);
  assert.equal(content.slice(rule.start, rule.end), rule.raw);
  const patch = await invoke({
    action: "patch",
    ruleId: rule.id,
    value: "9007199254740995UL",
  });
  assert.equal(patch.updated, content.replace(rule.raw, "9007199254740995UL"));
  assert.equal(patch.semanticChecked, false);
  const textRule = analysis.rules.find((r) => r.value === 'a"b');
  assert.ok(textRule);
  const stringPatch = await invoke({
    action: "patch",
    ruleId: textRule.id,
    value: '한글 "quote" 😀',
  });
  assert.equal(
    stringPatch.updated,
    content.slice(0, textRule.start) +
      stringPatch.newText +
      content.slice(textRule.end),
  );
} finally {
  if (
    !resolve(csharpDirectory).startsWith(resolve(tmpdir()) + sep) ||
    !csharpDirectory.split(sep).at(-1).startsWith("pureobom-csharp-package-")
  )
    throw Error("Unexpected C# package cleanup directory");
  await rm(csharpDirectory, { recursive: true, force: true });
}
console.log(
  "Packaged C# Roslyn reader and exact literal edits verified outside the workspace.",
);
