import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  availableChecks,
  verifyWorkspace,
} from "../extension/src/agent/verify";
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
          build: 'node -e "setTimeout(()=>{},30000)"',
        },
      }),
    );
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
    expect((await verifyWorkspace(root, "build", signal, 1000)).status).toBe(
      "timeout",
    );
  });
});
