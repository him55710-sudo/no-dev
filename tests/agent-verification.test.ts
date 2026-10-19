import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  availableChecks,
  verifyWorkspace,
} from "../extension/src/agent/verify";

async function runningTree(root: string) {
  await writeFile(
    resolve(root, "build.cjs"),
    `
    require('node:fs').writeFileSync('parent.pid', String(process.pid));
    require('node:child_process').spawn(process.execPath, ['descendant.cjs'], { stdio: 'inherit', windowsHide: true });
    setInterval(() => {}, 1000);
  `,
  );
  await writeFile(
    resolve(root, "descendant.cjs"),
    `
    require('node:fs').writeFileSync('descendant.pid', String(process.pid));
    setInterval(() => {}, 1000);
  `,
  );
}
async function readTree(root: string) {
  const pids = await Promise.all(
    ["parent.pid", "descendant.pid"].map(async (name) =>
      Number(await readFile(resolve(root, name), "utf8")),
    ),
  );
  for (const pid of pids) expect(pid).toBeGreaterThan(0);
  return pids;
}
async function expectTreeStopped(root: string) {
  const pids = await readTree(root);
  await vi.waitFor(
    () => {
      for (const pid of pids) {
        let code: string | undefined;
        try {
          process.kill(pid, 0);
        } catch (error) {
          code = (error as NodeJS.ErrnoException).code;
        }
        expect(code, `process ${pid} must no longer exist`).toBe("ESRCH");
      }
    },
    { timeout: 5000, interval: 50 },
  );
}
// Includes separate manager startups and Windows descendant-process termination.
describe("independent implementation verification", { timeout: 120000 }, () => {
  it("records real exits, refuses missing or replaced scripts, and terminates timed-out commands", async () => {
    const parent = resolve("test-results/agent-checks");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(resolve(parent, "run-"));
    await writeFile(
      resolve(root, "package.json"),
      JSON.stringify({
        name: "verification-fixture",
        version: "0.0.0",
        private: true,
        scripts: {
          test: 'node -e "console.log(123)"',
          check: 'node -e "process.exit(7)"',
          build: "node build.cjs",
        },
      }),
    );
    await runningTree(root);
    const signal = new AbortController().signal;
    expect((await availableChecks(root)).names.sort()).toEqual([
      "build",
      "check",
      "test",
    ]);
    const passed = await verifyWorkspace(root, "test", signal, 30000);
    expect(passed.status).toBe("passed");
    expect(passed.output).toContain("123");
    expect((await verifyWorkspace(root, "check", signal, 30000)).status).toBe(
      "failed",
    );
    expect((await verifyWorkspace(root, "typecheck", signal)).status).toBe(
      "missing",
    );
    const manager = (await availableChecks(root, true)).manager;
    const wrongManager = manager === "npm" ? "pnpm" : "npm";
    const replacedLauncher = await verifyWorkspace(
      root,
      "test",
      signal,
      3000,
      'node -e "console.log(123)"',
      wrongManager,
    );
    expect(replacedLauncher.status).toBe("failed");
    expect(replacedLauncher.output).toContain("실행기가 구현 도중 바뀌었");
    expect(replacedLauncher.exitCode).toBeUndefined();
    expect(
      (
        await verifyWorkspace(
          root,
          "test",
          signal,
          3000,
          "original test command",
        )
      ).output,
    ).toContain("명령이 구현 도중 바뀌었");
    expect((await verifyWorkspace(root, "build", signal, 5000)).status).toBe(
      "timeout",
    );
    await expectTreeStopped(root);
  });
  it("cancels a running check only after its actual child and descendant stop", async () => {
    const parent = resolve("test-results/agent-checks");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(resolve(parent, "cancel-"));
    await writeFile(
      resolve(root, "package.json"),
      JSON.stringify({ private: true, scripts: { build: "node build.cjs" } }),
    );
    await runningTree(root);
    const controller = new AbortController();
    const result = verifyWorkspace(root, "build", controller.signal, 20000);
    const cancelled = expect(result).rejects.toThrow(/취소/);
    try {
      await vi.waitFor(() => readTree(root), { timeout: 15000, interval: 50 });
    } finally {
      controller.abort();
    }
    await cancelled;
    await expectTreeStopped(root);
  });
});
