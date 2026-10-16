import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExecutionProfiles } from "../extension/src/executionProfiles";
import {
  approvalMatches,
  assertExecutionContext,
  type ExecutionContext,
  type SaveExecution,
} from "../src/workspace/execution";

async function fixture() {
  const parent = resolve("test-results/execution-profiles");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "run-"));
  const context: ExecutionContext = {
    projectKey: "a".repeat(64),
    executable: "codex",
    model: "",
    manager: "npm",
    scripts: { test: "node test.js", build: "vite build" },
  };
  const request: SaveExecution = {
    context,
    checks: ["test"],
    allowExternal: true,
    expectedRevision: 0,
  };
  return {
    root,
    context,
    request,
    store: new ExecutionProfiles(root, context.projectKey),
  };
}
describe("project execution settings", () => {
  it("restores the exact reviewed choices locally and isolates another project", async () => {
    const f = await fixture();
    expect((await f.store.read()).approval).toBeNull();
    const saved = await f.store.save(f.request);
    const reopened = new ExecutionProfiles(f.root, f.context.projectKey);
    expect(await reopened.read()).toEqual(saved);
    expect(
      approvalMatches(saved, {
        ...f.context,
        scripts: { build: "vite build", test: "node test.js" },
      }),
    ).toBe(true);
    expect(
      (await new ExecutionProfiles(f.root, "b".repeat(64)).read()).approval,
    ).toBeNull();
    const start = vi.fn(async () => "started");
    expect(
      await reopened.use(
        { ...f.request, useSaved: true, profileRevision: saved.revision },
        start,
      ),
    ).toBe("started");
    expect(start).toHaveBeenCalledOnce();
  });
  it("revocation survives reopen and cannot be undone by a stale open window", async () => {
    const f = await fixture();
    await f.store.save(f.request);
    const other = new ExecutionProfiles(f.root, f.context.projectKey);
    await other.revoke(1);
    expect(await f.store.read()).toMatchObject({ revision: 2, approval: null });
    await expect(
      f.store.save({ ...f.request, expectedRevision: 1 }),
    ).rejects.toThrow(/다른 창/);
    const start = vi.fn();
    await expect(
      f.store.use({ ...f.request, useSaved: true, profileRevision: 1 }, start),
    ).rejects.toThrow(/다른 창/);
    expect(start).not.toHaveBeenCalled();
    // Changing checks into a one-time choice must not bypass a newer revocation.
    await expect(
      f.store.use(
        { ...f.request, checks: ["build"], profileRevision: 1 },
        start,
      ),
    ).rejects.toThrow(/다른 창/);
    expect(start).not.toHaveBeenCalled();
    await f.store.use(
      { ...f.request, checks: ["build"], profileRevision: 2 },
      start,
    );
    expect(start).toHaveBeenCalledOnce();
    expect((await f.store.read()).approval).toBeNull();
    const approved = await f.store.save({ ...f.request, expectedRevision: 2 });
    expect(approved.revision).toBe(3);
  });
  it("rejects changed launcher, model, manager, scripts, project, and check selections before starting", async () => {
    const f = await fixture();
    const saved = await f.store.save(f.request);
    for (const change of [
      { executable: "other" },
      { model: "other" },
      { manager: "pnpm" as const },
      { scripts: { test: "node changed.js" } },
      { projectKey: "b".repeat(64) },
    ]) {
      const context = { ...f.context, ...change };
      expect(approvalMatches(saved, context)).toBe(false);
      expect(() => assertExecutionContext(f.request, context)).toThrow(
        /바뀌었/,
      );
      await expect(
        f.store.use(
          { ...f.request, context, useSaved: true, profileRevision: 1 },
          async () => {
            throw Error("must not start");
          },
        ),
      ).rejects.toThrow(/보관된/);
    }
    await expect(
      f.store.use(
        { ...f.request, checks: ["build"], useSaved: true, profileRevision: 1 },
        async () => {},
      ),
    ).rejects.toThrow(/보관된/);
    expect(() =>
      assertExecutionContext(
        { ...f.request, checks: ["typecheck"] },
        f.context,
      ),
    ).toThrow(/없습니다/);
    expect(() =>
      f.store.save({
        ...f.request,
        allowExternal: false,
      } as unknown as SaveExecution),
    ).toThrow();
  });
  it("serializes approval use against another process store without silently restoring a revoked record", async () => {
    const f = await fixture();
    await f.store.save(f.request);
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const use = f.store.use(
      { ...f.request, useSaved: true, profileRevision: 1 },
      async () => {
        entered();
        await gate;
      },
    );
    await inside;
    const other = new ExecutionProfiles(f.root, f.context.projectKey);
    try {
      await expect(other.revoke(1)).rejects.toThrow(/잠금|다른 작업/);
    } finally {
      release();
      await use;
    }
    await other.revoke(1);
    expect((await f.store.read()).approval).toBeNull();
  });
  it("preserves malformed records instead of replacing them with a new approval", async () => {
    const f = await fixture();
    await f.store.save(f.request);
    const path = resolve(
      f.root,
      "execution-profiles",
      f.context.projectKey + ".json",
    );
    await writeFile(path, "corrupt record");
    await expect(f.store.read()).rejects.toThrow();
    await expect(
      f.store.save({ ...f.request, expectedRevision: 1 }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("corrupt record");
  });
});
