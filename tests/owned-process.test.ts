import { beforeAll, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { spawnOwnedProcess } from "../extension/src/agent/ownedProcess";

const parent = resolve("test-results/process-scope");
let bundle: string;
beforeAll(async () => {
  await mkdir(parent, { recursive: true });
  bundle = resolve(await mkdtemp(resolve(parent, "bundle-")), "scope.cjs");
  await build({
    entryPoints: ["extension/src/agent/ownedProcess.ts"],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
});
function completion(child: ReturnType<typeof spawnOwnedProcess>) {
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done({ code, stdout, stderr }));
    },
  );
}
async function stopped(pids: number[]) {
  await vi.waitFor(
    () => {
      for (const pid of pids) {
        expect(pid).toBeGreaterThan(0);
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
      }
    },
    { timeout: 5000, interval: 40 },
  );
}
describe("owned process invocation", { timeout: 30000 }, () => {
  it("preserves binary stdio, exact arguments, working directory, environment and exit status", async () => {
    const root = await mkdtemp(resolve(parent, "한글 with spaces-"));
    const file = resolve(root, "echo.cjs");
    await writeFile(
      file,
      `let chunks=[]; process.stdin.on('data', b=>chunks.push(b)); process.stdin.on('end',()=>{
      console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),input:Buffer.concat(chunks).toString('base64'),
        scope:process.env.PUREOBOM_PROCESS_SCOPE,custom:process.env.SCOPE_FIXTURE_VALUE})); process.exitCode=7; });`,
    );
    const args = [
      "",
      "space 한글",
      'quote"here',
      "trailing\\",
      "space trailing\\",
      "$(noop);&`",
      "line\nnext",
    ];
    const input = Buffer.from([0, 1, 2, 13, 10, 255, 128]);
    const child = spawnOwnedProcess(process.execPath, [file, ...args], {
      cwd: root,
      env: { ...process.env, SCOPE_FIXTURE_VALUE: "한글 value" },
    });
    const finished = completion(child);
    try {
      child.stdin.end(input);
      const result = await finished;
      expect(result.stderr).toBe("");
      expect(result.code).toBe(7);
      expect(JSON.parse(result.stdout)).toEqual({
        args,
        cwd: root,
        input: input.toString("base64"),
        custom: "한글 value",
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });

  it.runIf(process.platform === "win32")(
    "fails explicitly when the child cannot be created",
    async () => {
      const root = await mkdtemp(resolve(parent, "missing-"));
      const child = spawnOwnedProcess(resolve(root, "missing.exe"), [], {
        cwd: root,
      });
      const finished = completion(child);
      child.stdin.end();
      const result = await finished;
      expect(result.code).toBe(125);
      expect(result.stderr).toContain("Pureobom process scope:");
    },
  );

  it
    .runIf(process.platform === "win32")
    .each(["launcher-exit", "scope-kill", "owner-death"] as const)(
    "stops detached descendants and their writes after %s",
    async (mode) => {
      const root = await mkdtemp(resolve(parent, mode + "-"));
      const fixture = resolve(root, "fixture.cjs");
      await writeFile(
        fixture,
        `const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process');
        const root=process.argv[3], file=n=>path.join(root,n), role=process.argv[2];
        process.on('SIGTERM',()=>{}); process.stdin.on('end',()=>{});
        const end=Date.now()+25000; // Test-only cleanup fallback, far beyond the 5s stop assertion.
        if(role==='descendant') {
          fs.writeFileSync(file('descendant.pid'),String(process.pid));
          setInterval(()=>{if(fs.existsSync(file('stop'))||Date.now()>end)process.exit();fs.appendFileSync(file('writes'),'x');},20);
        } else {
          fs.writeFileSync(file('parent.pid'),String(process.pid));
          cp.spawn(process.execPath,[__filename,'descendant',root],{detached:true,stdio:'ignore',windowsHide:true}).unref();
          const timer=setInterval(()=>{
            if(fs.existsSync(file('stop'))||Date.now()>end)process.exit();
            if(fs.existsSync(file('writes'))&&role==='launcher-exit') { clearInterval(timer);process.exit(0); }
          },20);
        }`,
      );
      const owner = resolve(root, "owner.cjs");
      await writeFile(
        owner,
        `const {spawnOwnedProcess}=require(${JSON.stringify(bundle)});
        const child=spawnOwnedProcess(process.execPath,[${JSON.stringify(fixture)},'owner-death',${JSON.stringify(root)}],{cwd:${JSON.stringify(root)}});
        child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.stdin.end();setInterval(()=>{},1000);`,
      );
      const child =
        mode === "owner-death"
          ? spawn(process.execPath, [owner], {
              cwd: root,
              windowsHide: true,
              stdio: "pipe",
            })
          : spawnOwnedProcess(process.execPath, [fixture, mode, root], {
              cwd: root,
            });
      const sibling = spawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { windowsHide: true, stdio: "ignore" },
      );
      const finished = completion(child);
      child.stdin.end();
      try {
        await vi.waitFor(
          async () =>
            expect(
              (await readFile(resolve(root, "writes"))).length,
            ).toBeGreaterThan(0),
          { timeout: 10000, interval: 40 },
        );
        const pids = await Promise.all(
          ["parent.pid", "descendant.pid"].map(async (name) =>
            Number(await readFile(resolve(root, name), "utf8")),
          ),
        );
        if (mode !== "launcher-exit") child.kill(); // Only the handle this test owns.
        const result = await finished;
        expect(result.stderr).toBe("");
        if (mode === "launcher-exit") expect(result.code).toBe(0);
        await stopped(pids);
        const bytes = await readFile(resolve(root, "writes"));
        await delay(200);
        expect(await readFile(resolve(root, "writes"))).toEqual(bytes);
        expect(sibling.exitCode).toBeNull();
        expect(sibling.signalCode).toBeNull();
        expect(() => process.kill(sibling.pid!, 0)).not.toThrow();
      } finally {
        await writeFile(resolve(root, "stop"), "test finished");
        if (child.exitCode === null && child.signalCode === null) child.kill();
        sibling.kill();
        await finished;
      }
    },
  );
});
