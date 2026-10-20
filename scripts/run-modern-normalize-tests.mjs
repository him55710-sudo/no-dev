// Opt-in adapter for the unmodified Chrome tests of modern-normalize v3.0.1.
// Serves three fixed upstream files on loopback. No model supplies commands.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, unlink, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import ts from "typescript";

if (process.argv.length !== 4)
  throw Error("Usage: node scripts/run-modern-normalize-tests.mjs ROOT REPORT");
const [root, reportFile] = process.argv.slice(2).map((p) => resolve(p));
// A browser launched from VS Code must not inherit Electron's crashpad pipe.
const inheritedCrashpadPipe = "CHROME_CRASHPAD_PIPE_NAME" in process.env;
delete process.env.CHROME_CRASHPAD_PIPE_NAME;
const expected = "3faa07fc91b8ffbe6243bc4f91e880a00185d0a2";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== expected)
  throw Error("Unexpected modern-normalize revision");
if (git("diff", "HEAD", "--", ":!modern-normalize.css"))
  throw Error("Upstream files other than the CSS must remain unchanged");
// TestCafe reuses free profiles in its global temp directory, even if an old
// Chrome process survived its cleanup. Isolate every run before loading it.
const taskTemp = await mkdtemp(join(tmpdir(), "pureobom-normalize-"));
process.env.TEMP = taskTemp;
process.env.TMP = taskTemp;
process.env.TMPDIR = taskTemp;
const requireFixture = createRequire(join(root, "package.json"));
const createTestCafe = requireFixture("testcafe");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const files = [
  ["/modern-normalize.css", "text/css; charset=utf-8"],
  ["/test/page/with-css.html", "text/html; charset=utf-8"],
  ["/test/page/without-css.html", "text/html; charset=utf-8"],
];
const pages = new Map(
  await Promise.all(
    files.map(async ([path, type]) => [
      path,
      { type, bytes: await readFile(join(root, path.slice(1))) },
    ]),
  ),
);
const sources = ["rules", "validation"].map(
  (name) => `test/acceptance/chrome/${name}.ts`,
);
const inventory = [];
const sourceHashes = {};
for (const relative of sources) {
  const source = await readFile(join(root, relative), "utf8");
  sourceHashes[relative] = hash(source);
  const ast = ts.createSourceFile(
    relative,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const call = statement.expression;
    if (
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== "test" ||
      !ts.isStringLiteral(call.arguments[0])
    )
      continue;
    let expectations = 0;
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "expect"
      )
        expectations++;
      ts.forEachChild(node, visit);
    }
    visit(call);
    inventory.push({
      file: relative,
      name: call.arguments[0].text,
      line: ast.getLineAndCharacterOfPosition(call.getStart(ast)).line + 1,
      expectations,
    });
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  project: "https://github.com/sindresorhus/modern-normalize",
  commit: expected,
  node: process.version,
  platform: process.platform,
  testcafe: requireFixture("testcafe/package.json").version,
  inheritedCrashpadPipeRemoved: inheritedCrashpadPipe,
  temporaryDirectory: taskTemp,
  sourceHashes: {
    ...sourceHashes,
    ...Object.fromEntries(
      [...pages].map(([path, { bytes }]) => [path.slice(1), hash(bytes)]),
    ),
  },
  dependencyLockSha256: hash(await readFile(join(root, "pnpm-lock.yaml"))),
  scope:
    "Both unmodified upstream Chrome test files; no test filter. Firefox and Safari not run.",
  serving:
    "Three fixed upstream files on 127.0.0.1:8080 instead of http-server; no directory listing or arbitrary path serving.",
  inventory,
  exitCode: 1,
};
// Remove stale evidence before doing anything that can fail during execution.
await unlink(reportFile).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
const server = createServer((req, res) => {
  const path = new URL(req.url || "/", "http://127.0.0.1:8080").pathname;
  const page = pages.get(path);
  if (!["GET", "HEAD"].includes(req.method) || !page) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": page.type,
    "Content-Length": page.bytes.length,
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : page.bytes);
});
let testcafe;
let timer;
let runner;
let json = "";
const output = new Writable({
  write(chunk, _encoding, done) {
    json += chunk.toString();
    done();
  },
});
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(8080, "127.0.0.1", resolve);
  });
  // Run from the fixture, so it cannot discover Pureobom's tsconfig.
  process.chdir(root);
  testcafe = await createTestCafe({ hostname: "127.0.0.1", configFile: false });
  runner = testcafe
    .createRunner()
    .src(sources.map((p) => join(root, p)))
    .browsers("chrome:headless")
    .reporter(["spec", { name: "json", output }]);
  const failed = await Promise.race([
    runner.run(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        runner.stop();
        reject(Error("Upstream Chrome tests exceeded 300 seconds"));
      }, 300000);
    }),
  ]);
  const result = JSON.parse(json);
  const tests = result.fixtures.flatMap((f) =>
    f.tests.map((t, index) => ({ fixture: f.name, index, ...t })),
  );
  if (tests.length !== inventory.length)
    throw Error(
      `Test count ${tests.length} differs from inventory ${inventory.length}`,
    );
  report.counts = {
    total: tests.length,
    passed: tests.filter((t) => !t.errs.length && !t.skipped).length,
    failed: tests.filter((t) => t.errs.length).length,
    skipped: tests.filter((t) => t.skipped).length,
    // A structural inventory, not a runtime assertion count or coverage score.
    testsWithoutExpectCalls: inventory.filter((t) => t.expectations === 0)
      .length,
  };
  if (failed !== report.counts.failed)
    throw Error("Runner failure count differs from JSON reporter");
  report.failedTests = tests
    .filter((t) => t.errs.length)
    .map(({ fixture, index, name, errs }) => ({
      fixture,
      index,
      name,
      errors: errs,
    }));
  report.browser = result.userAgents;
  report.raw = result;
  report.exitCode = failed ? 1 : 0;
} catch (error) {
  report.error = String(error);
  console.error(error);
} finally {
  clearTimeout(timer);
  try {
    if (testcafe) await testcafe.close();
  } catch (error) {
    report.cleanupError = String(error);
    report.exitCode = 1;
  }
  if (process.platform === "win32") {
    try {
      // Query metadata without emitting it. Only this run's unique profile
      // directory qualifies; never close the user's ordinary Chrome windows.
      const metadata = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 2000000,
        },
      ).trim();
      const processes = metadata ? [JSON.parse(metadata)].flat() : [];
      const owned = processes.filter((p) =>
        p.CommandLine?.toLowerCase().includes((taskTemp + sep).toLowerCase()),
      );
      report.remainingOwnedBrowserProcessesClosed = owned.length;
      for (const p of owned) {
        try {
          process.kill(p.ProcessId);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    } catch (error) {
      report.cleanupError = String(error);
      report.exitCode = 1;
    }
  }
  server.closeAllConnections();
  if (server.listening) await new Promise((done) => server.close(done));
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
}
// TestCafe's async-exit-hook 1.1.2 registers beforeExit with a fixed code 0,
// overriding process.exitCode. Cleanup and evidence writes are already awaited.
await Promise.all([
  new Promise((done) => process.stdout.write("", done)),
  new Promise((done) => process.stderr.write("", done)),
]);
process.exit(report.exitCode);
