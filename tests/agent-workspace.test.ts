import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  createJobWorkspace,
  seedJobWorkspace,
  reviewJobWorkspace,
  applyJobReview,
  undoJobReview,
  loadJobWorkspace,
} from "../extension/src/agent/gitWorkspace";
const exec = promisify(execFile);
async function git(root: string, ...args: string[]) {
  return (await exec("git", ["-C", root, ...args], { windowsHide: true }))
    .stdout;
}
async function fixture() {
  const parent = resolve("test-results/agent-workspaces");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, "run-")),
    source = resolve(directory, "source");
  await mkdir(source);
  await git(source, "init");
  await git(source, "config", "user.name", "Fixture");
  await git(source, "config", "user.email", "fixture@example.invalid");
  await git(source, "config", "core.autocrlf", "false");
  await writeFile(resolve(source, ".gitignore"), ".env\nignored/\n");
  await writeFile(
    resolve(source, "policy.ts"),
    "export const canEdit = true;\r\n",
  );
  await writeFile(
    resolve(source, "api.ts"),
    'export {canEdit} from "./policy";\n',
  );
  await writeFile(resolve(source, "asset.png"), Buffer.from([0, 1, 2, 255]));
  await git(source, "add", ".");
  await git(source, "commit", "-m", "Fixture");
  return { directory, source, storage: resolve(directory, "jobs") };
}
describe("isolated implementation and review", { timeout: 30000 }, () => {
  it("leaves new dependency caches out of source snapshots, review and apply while preserving tracked dependency files", async () => {
    const f = await fixture();
    await mkdir(resolve(f.source, "node_modules/local-policy"), {
      recursive: true,
    });
    await writeFile(
      resolve(f.source, "node_modules/local-policy/index.js"),
      "export const enabled = true;\n",
    );
    await git(f.source, "add", "node_modules/local-policy/index.js");
    await git(f.source, "commit", "-m", "An intentionally tracked dependency");
    await mkdir(resolve(f.source, ".pnpm-store/v11"), { recursive: true });
    await writeFile(
      resolve(f.source, ".pnpm-store/v11/index.db"),
      Buffer.from([0, 1, 2]),
    );
    const job = await createJobWorkspace(f.source, f.storage);
    expect(job.hashes[".pnpm-store/v11/index.db"]).toBeUndefined();
    expect(job.hashes["node_modules/local-policy/index.js"]).toBeDefined();
    await mkdir(resolve(job.path, ".pnpm-store/v11"), { recursive: true });
    await writeFile(
      resolve(job.path, ".pnpm-store/v11/index.db"),
      Buffer.from([0, 1, 3]),
    );
    await writeFile(resolve(job.path, "node_modules/generated.json"), "{}");
    await git(job.path, "add", ".pnpm-store/v11/index.db");
    await writeFile(
      resolve(job.path, "node_modules/local-policy/index.js"),
      "export const enabled = false;\n",
    );
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = false;\n",
    );
    await writeFile(
      resolve(job.path, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    const review = await reviewJobWorkspace(job);
    expect(review.files.map((file) => file.path)).toEqual([
      "node_modules/local-policy/index.js",
      "pnpm-lock.yaml",
      "policy.ts",
    ]);
    await applyJobReview(job, review);
    expect(
      await readFile(resolve(f.source, ".pnpm-store/v11/index.db")),
    ).toEqual(Buffer.from([0, 1, 2]));
    await expect(
      readFile(resolve(f.source, "node_modules/generated.json")),
    ).rejects.toThrow();
    await undoJobReview(job, review);
    expect(
      await readFile(
        resolve(f.source, "node_modules/local-policy/index.js"),
        "utf8",
      ),
    ).toContain("true");
  });
  it("carries modified, added and deleted files into an independent continuation without touching the original candidate", async () => {
    const f = await fixture();
    const before = await createJobWorkspace(f.source, f.storage);
    await writeFile(
      resolve(before.path, "policy.ts"),
      "export const canEdit = false;\n",
    );
    await unlink(resolve(before.path, "api.ts"));
    await writeFile(
      resolve(before.path, "new.ts"),
      "export const kept = true;\n",
    );
    const checkpoint = await reviewJobWorkspace(before);
    const after = await createJobWorkspace(f.source, f.storage);
    await seedJobWorkspace(after, before, checkpoint);
    expect((await reviewJobWorkspace(after)).id).toBe(checkpoint.id);
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
      "true",
    );
    expect(await git(f.source, "status", "--porcelain")).toBe("");
    await writeFile(
      resolve(after.path, "policy.ts"),
      "// later implementation\n",
    );
    expect((await reviewJobWorkspace(before)).id).toBe(checkpoint.id);
  });
  it("rejects changed source and unrelated checkpoints before copying any partial change", async () => {
    const f = await fixture();
    const before = await createJobWorkspace(f.source, f.storage);
    await writeFile(
      resolve(before.path, "policy.ts"),
      "export const canEdit = false;\n",
    );
    const checkpoint = await reviewJobWorkspace(before);
    const same = await createJobWorkspace(f.source, f.storage);
    await expect(
      seedJobWorkspace(same, before, { ...checkpoint, workspaceId: same.id }),
    ).rejects.toThrow(/원본/);
    await writeFile(resolve(f.source, "api.ts"), "// new user edit\n");
    const changed = await createJobWorkspace(f.source, f.storage);
    await expect(seedJobWorkspace(changed, before, checkpoint)).rejects.toThrow(
      /원본/,
    );
    expect(
      await readFile(resolve(changed.path, "policy.ts"), "utf8"),
    ).toContain("true");
    expect(await readFile(resolve(f.source, "api.ts"), "utf8")).toBe(
      "// new user edit\n",
    );
  });
  it("keeps native tools runnable outside a deep profile and restores the exact compact worktree", async () => {
    const f = await fixture();
    const storage = resolve(
      f.directory,
      "p".repeat(Math.max(1, 170 - f.directory.length)),
      "jobs",
    );
    const job = await createJobWorkspace(f.source, storage, undefined, true);
    try {
      expect(job.path).not.toBe(resolve(job.directory, "worktree"));
      expect(await loadJobWorkspace(storage, job.id, f.source)).toEqual(job);
      if (process.platform === "win32") {
        const dependency =
          "node_modules/.pnpm/@esbuild+win32-x64@0.25.12/node_modules/@esbuild/win32-x64/esbuild.exe";
        expect(
          resolve(job.directory, "worktree", dependency).length,
        ).toBeGreaterThan(260);
        const binary = resolve(job.path, dependency);
        expect(binary.length).toBeLessThan(260);
        const fromEsbuild = createRequire(
          createRequire(import.meta.url).resolve("esbuild"),
        );
        const original = fromEsbuild.resolve("@esbuild/win32-x64/esbuild.exe");
        await mkdir(resolve(binary, ".."), { recursive: true });
        await copyFile(original, binary);
        const expected = (
          await exec(original, ["--version"], { windowsHide: true })
        ).stdout;
        expect(
          (await exec(binary, ["--version"], { windowsHide: true })).stdout,
        ).toBe(expected);
        await unlink(binary);
      }
      await writeFile(
        resolve(job.path, "policy.ts"),
        "export const canEdit = false;\r\n",
      );
      const review = await reviewJobWorkspace(job);
      await applyJobReview(job, review);
      // A new process can still find the durable worktree and undo the change.
      const restored = await loadJobWorkspace(storage, job.id, f.source);
      await undoJobReview(restored, review);
      expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
        "true",
      );
    } finally {
      // Only remove the exact disposable worktree returned for this test's repo.
      await git(f.source, "worktree", "remove", "--force", job.path);
    }
  });
  it("preserves staged/unstaged work, raw CRLF and assets without copying excluded secrets", async () => {
    const f = await fixture();
    await writeFile(
      resolve(f.source, "policy.ts"),
      "export const canEdit = false;\r\n",
    );
    await git(f.source, "add", "policy.ts");
    await writeFile(
      resolve(f.source, "policy.ts"),
      "export const canEdit = role === 'editor';\r\n",
    );
    await writeFile(
      resolve(f.source, "new.ts"),
      "export const draft = true;\n",
    );
    await writeFile(resolve(f.source, ".env"), "FAKE_TEST_ONLY=placeholder\n");
    const before = await git(f.source, "diff", "--cached");
    const job = await createJobWorkspace(f.source, f.storage);
    expect(await git(f.source, "diff", "--cached")).toBe(before);
    expect(await readFile(resolve(job.path, "policy.ts"))).toEqual(
      await readFile(resolve(f.source, "policy.ts")),
    );
    expect(await readFile(resolve(job.path, "asset.png"))).toEqual(
      Buffer.from([0, 1, 2, 255]),
    );
    expect(await readFile(resolve(job.path, "new.ts"), "utf8")).toContain(
      "draft",
    );
    await expect(readFile(resolve(job.path, ".env"))).rejects.toThrow();
    expect((await reviewJobWorkspace(job)).files).toHaveLength(0);
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = role === 'owner';\r\n",
    );
    await writeFile(
      resolve(job.path, "created.ts"),
      "export const checked = true;\n",
    );
    await unlink(resolve(job.path, "api.ts"));
    const review = await reviewJobWorkspace(job);
    expect(review.files.map((file) => file.path)).toEqual([
      "api.ts",
      "created.ts",
      "policy.ts",
    ]);
    await applyJobReview(job, review);
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
      "owner",
    );
    expect(await git(f.source, "diff", "--cached")).toBe(before);
    await undoJobReview(job, review);
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toBe(
      "export const canEdit = role === 'editor';\r\n",
    );
    await expect(readFile(resolve(f.source, "created.ts"))).rejects.toThrow();
  });
  it("refuses changes when any original input or the reviewed proposal changes", async () => {
    const f = await fixture(),
      job = await createJobWorkspace(f.source, f.storage);
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = false;\r\n",
    );
    const review = await reviewJobWorkspace(job);
    await writeFile(resolve(f.source, "api.ts"), "// edited externally\n");
    await expect(applyJobReview(job, review)).rejects.toThrow(/원본이 바뀌었/);
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
      "true",
    );
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = 'new proposal';\n",
    );
    await expect(applyJobReview(job, review)).rejects.toThrow(
      /검토한 변경이 바뀌었/,
    );
  });
  it("rolls back a partial multi-file application and records the actual result", async () => {
    const f = await fixture(),
      job = await createJobWorkspace(f.source, f.storage);
    await writeFile(
      resolve(job.path, "api.ts"),
      "export const denied = true;\n",
    );
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = false;\n",
    );
    const review = await reviewJobWorkspace(job);
    await expect(
      applyJobReview(job, review, async (index) => {
        if (index === 1) throw Error("Injected disk failure");
      }),
    ).rejects.toThrow(/원본을 복구/);
    expect(await readFile(resolve(f.source, "api.ts"), "utf8")).toContain(
      "canEdit",
    );
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
      "true",
    );
    expect(
      JSON.parse(await readFile(resolve(job.directory, "apply.json"), "utf8"))
        .state,
    ).toBe("rolled-back");
  });
  it("does not overwrite subsequent user edits during undo", async () => {
    const f = await fixture(),
      job = await createJobWorkspace(f.source, f.storage);
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = false;\n",
    );
    const review = await reviewJobWorkspace(job);
    await applyJobReview(job, review);
    await writeFile(
      resolve(f.source, "policy.ts"),
      "// important new user work\n",
    );
    await expect(undoJobReview(job, review)).rejects.toThrow(/파일이 바뀌어/);
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
      "important new user work",
    );
  });
  it("rejects new source files added while implementation was running", async () => {
    const f = await fixture(),
      job = await createJobWorkspace(f.source, f.storage);
    await writeFile(
      resolve(job.path, "policy.ts"),
      "export const canEdit = false;\n",
    );
    const review = await reviewJobWorkspace(job);
    await writeFile(
      resolve(f.source, "new-route.ts"),
      "export const newRoute = true;\n",
    );
    await expect(applyJobReview(job, review)).rejects.toThrow(/파일이 추가됐/);
    expect(await readFile(resolve(f.source, "policy.ts"), "utf8")).toContain(
      "true",
    );
  });
});
