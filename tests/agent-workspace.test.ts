import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createJobWorkspace,
  reviewJobWorkspace,
  applyJobReview,
  undoJobReview,
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
