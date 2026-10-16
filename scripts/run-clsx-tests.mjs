// Opt-in adapter for the pinned public clsx fixture. No model-controlled commands.
// Its historical esm loader needs Node 20; the product itself still uses Node 24.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [root, runtime, reportFile] = process.argv
  .slice(2)
  .map((p) => resolve(p));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (commit !== "925494cf31bcd97d3337aacd34e659e80cae7fe2")
  throw Error("Unexpected clsx revision");
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" };
delete env.FORCE_COLOR;
const version = execFileSync(runtime, ["--version"], {
  env,
  encoding: "utf8",
  windowsHide: true,
}).trim();
let stdout = "",
  stderr = "",
  exitCode = 0;
try {
  stdout = execFileSync(
    runtime,
    ["node_modules/uvu/bin.js", "-r", "esm", "test"],
    {
      cwd: root,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 2000000,
    },
  );
} catch (error) {
  stdout = error.stdout?.toString() || "";
  stderr = error.stderr?.toString() || String(error);
  exitCode = Number.isInteger(error.status) ? error.status : 1;
}
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
stdout = clean(stdout);
stderr = clean(stderr);
const counts = Object.fromEntries(
  ["Total", "Passed", "Skipped"].map((name) => [
    name.toLowerCase(),
    Number(stdout.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1]),
  ]),
);
await writeFile(
  reportFile,
  JSON.stringify(
    { runtime: version, exitCode, counts, stdout, stderr },
    null,
    2,
  ),
);
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = exitCode;
