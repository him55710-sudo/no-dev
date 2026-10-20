// Run a reviewed regression against the pinned upstream Google UUID project.
import { runTests, downloadAndUnzipVSCode } from "@vscode/test-electron";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve("test-results/projects/google-uuid");
const go = process.env.PUREOBOM_TEST_GO || "go";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== "0f11ee6918f41a04c201eceeadf612a377bc7fbc")
  throw Error("Unexpected Google UUID revision");
if (git("status", "--porcelain"))
  throw Error("Fixture has changes; inspect before running");
const runtime = await downloadAndUnzipVSCode("1.96.4");
const report = resolve("test-results/go-source-project.json");
const events = resolve("test-results/go-source-project.events.jsonl");
const runner = resolve("test-results/go-source-project-task.mjs");
await writeFile(
  runner,
  `import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
const [go,output,root] = process.argv.slice(2);
const stream = createWriteStream(output);
const child = spawn(go, ['test','-mod=readonly','-count=1','-json','./...'], {cwd:root, shell:false, windowsHide:true, env:{...process.env,GOTOOLCHAIN:'local',GOENV:'off',GOWORK:'off',GOFLAGS:'',GOPROXY:'off',GOSUMDB:'off',GOTELEMETRY:'off'}});
child.stdout.pipe(stream); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
child.on('error',error=>{console.error(error);stream.end();process.exitCode=1;});
child.on('close',code=>{process.exitCode=code??1;});
`,
);
await build({
  entryPoints: ["extension/test/goSourceProject.ts"],
  outfile: "test-results/go-source-project.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});
const profile = await mkdtemp(resolve("test-results/go-source-profile-"));
const folder = join(root, ".vscode"),
  config = join(folder, "tasks.json");
let madeFolder = false,
  wroteConfig = false;
try {
  try {
    await mkdir(folder);
    madeFolder = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await writeFile(
    config,
    JSON.stringify(
      {
        version: "2.0.0",
        tasks: [
          {
            label: "Google UUID Go AST regression",
            type: "process",
            command: process.execPath,
            args: [runner, go, events, root],
            options: { cwd: root },
            group: "test",
            problemMatcher: [],
          },
        ],
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  wroteConfig = true;
  await runTests({
    vscodeExecutablePath: runtime,
    extensionDevelopmentPath: resolve("extension"),
    extensionTestsPath: resolve("test-results/go-source-project.cjs"),
    extensionTestsEnv: {
      PUREOBOM_GO_SOURCE_REPORT: report,
      PUREOBOM_GO_SOURCE_EVENTS: events,
      PUREOBOM_TEST_GO: go,
    },
    launchArgs: [
      root,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-updates",
      "--user-data-dir",
      profile,
      "--extensions-dir",
      resolve("test-results/go-source-extensions"),
    ],
  });
} finally {
  if (wroteConfig) await unlink(config);
  if (madeFolder) await rmdir(folder);
}
if (git("status", "--porcelain"))
  throw Error("Fixture was not restored cleanly");
