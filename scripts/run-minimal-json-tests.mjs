// Reviewed adapter: all upstream library tests, original dependencies, JDK 25.
// Upstream Maven's Java 1.5 target is unsupported by this JDK. Use --release 8.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
const [rootArg, outputArg] = process.argv
  .slice(2)
  .filter((v) => v !== "--setup");
if (!rootArg || !outputArg)
  throw Error(
    "Usage: node scripts/run-minimal-json-tests.mjs PROJECT REPORT [--setup]",
  );
const root = resolve(rootArg),
  output = resolve(outputArg);
const home = process.env.PUREOBOM_TEST_JAVA_HOME || process.env.JAVA_HOME;
if (!home) throw Error("Set PUREOBOM_TEST_JAVA_HOME or JAVA_HOME to a JDK");
const executable = (name) =>
  join(home, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const env = Object.fromEntries(
  [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
const options = {
  cwd: root,
  env,
  encoding: "utf8",
  windowsHide: true,
  timeout: 120000,
  maxBuffer: 4 * 1024 * 1024,
};
if (
  (await exec("git", ["rev-parse", "HEAD"], options)).stdout.trim() !==
  "5518c876226ae07f8291d6b41209bc3c979f4a55"
)
  throw Error("Unexpected minimal-json revision");
const dependencies = JSON.parse(
  await readFile(
    new URL("fixtures/minimal-json/dependencies.json", import.meta.url),
    "utf8",
  ),
);
const deps = resolve(repository, "test-results/tools/java/minimal-json-deps");
await mkdir(deps, { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const dependency of dependencies) {
  const file = join(deps, dependency.name);
  if (process.argv.includes("--setup")) {
    const response = await fetch(dependency.url);
    if (!response.ok) throw Error(`Dependency download: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== dependency.sha256)
      throw Error(`Checksum mismatch: ${dependency.name}`);
    await writeFile(file, bytes);
  }
  if (sha256(await readFile(file)) !== dependency.sha256)
    throw Error(`Checksum mismatch: ${dependency.name}`);
}
async function javaFiles(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await javaFiles(path)));
    else if (entry.name.endsWith(".java")) files.push(path);
  }
  return files.sort();
}
await mkdir(resolve(repository, "test-results/java-project-builds"), {
  recursive: true,
});
const build = await mkdtemp(
  resolve(repository, "test-results/java-project-builds/run-"),
);
const sourceRoot = join(root, "com.eclipsesource.json/src");
const main = await javaFiles(join(sourceRoot, "main/java"));
const tests = await javaFiles(join(sourceRoot, "test/java"));
const testClasses = tests
  .filter((file) => file.endsWith("Test.java"))
  .map((file) =>
    file
      .slice(join(sourceRoot, "test/java").length + 1)
      .replace(/[\\/]/g, ".")
      .replace(/\.java$/, ""),
  );
const jars = dependencies.map((dep) => join(deps, dep.name)).join(delimiter);
const helper = resolve(
  repository,
  "scripts/fixtures/minimal-json/PureobomJUnitRunner.java",
);
const report = {
  checkedAt: new Date().toISOString(),
  project: "https://github.com/ralfstx/minimal-json",
  commit: "5518c876226ae07f8291d6b41209bc3c979f4a55",
  java: (await exec(executable("java"), ["--version"], options)).stdout.trim(),
  testClasses,
  mainFiles: main.length,
  testFiles: tests.length,
  dependencies,
  adaptations: [
    "Javac --release 8 replaces upstream Maven Java 1.5 target; production and test source unchanged",
    "JUnitCore invokes every upstream library *Test class; benchmark and Maven packaging/API compatibility plugins are outside this check",
    "--add-opens java.base/java.lang and java.base/java.io=ALL-UNNAMED for original Mockito 1.10.19 on JDK 25",
  ],
  sourceHashes: {},
};
for (const file of [...main, ...tests])
  report.sourceHashes[file.slice(root.length + 1).replaceAll("\\", "/")] =
    sha256(await readFile(file));
try {
  // javac's @argfile avoids Windows command-length limits without invoking a shell.
  const args = [
    "-proc:none",
    "-implicit:none",
    "-encoding",
    "UTF-8",
    "--release",
    "8",
    "-classpath",
    jars,
    "-d",
    build,
    ...main,
    ...tests,
    helper,
  ];
  const argumentFile = join(build, "compile.args");
  await writeFile(
    argumentFile,
    args
      .map((s) => '"' + s.replaceAll("\\", "/").replaceAll('"', '\\"') + '"')
      .join("\n"),
  );
  const compiled = await exec(
    executable("javac"),
    ["@" + argumentFile],
    options,
  );
  report.compile = {
    exitCode: 0,
    stdout: compiled.stdout,
    stderr: compiled.stderr,
  };
  let result;
  try {
    result = {
      ...(await exec(
        executable("java"),
        [
          "--add-opens",
          "java.base/java.lang=ALL-UNNAMED",
          "--add-opens",
          "java.base/java.io=ALL-UNNAMED",
          "-cp",
          build + delimiter + jars,
          "PureobomJUnitRunner",
          ...testClasses,
        ],
        options,
      )),
      code: 0,
    };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    result = error;
  }
  const summary = result.stdout.match(
    /^PUREOBOM_RESULT (\d+) (\d+) (\d+) (\d+)$/m,
  );
  if (!summary) throw Error("Missing JUnit result: " + result.stderr);
  const [, run, failed, ignored, timeMs] = summary.map(Number);
  report.exitCode = result.code;
  report.counts = { run, passed: run - failed, failed, ignored, timeMs };
  report.failures = [
    ...result.stdout.matchAll(/^PUREOBOM_FAILURE ([A-Za-z0-9+/=]+)$/gm),
  ].map((m) => Buffer.from(m[1], "base64").toString("utf8"));
  report.stderr = result.stderr;
  console.log(
    JSON.stringify({
      counts: report.counts,
      exitCode: report.exitCode,
      failures: report.failures.map((failure) => failure.split("\n")[0]),
    }),
  );
  process.exitCode = result.code;
} catch (error) {
  report.error = String(error);
  report.stderr = error.stderr;
  process.exitCode = 1;
  console.error(error);
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
