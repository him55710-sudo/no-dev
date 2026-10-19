import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DesignDrafts } from "../extension/src/designDrafts";
import { analyzeStructure } from "../src/workspace/analyze";
import { draftSpec } from "../src/workspace/spec";
import { cleanDraft, draftMatches } from "../src/workspace/drafts";
async function fixture() {
  const parent = resolve("test-results/design-drafts");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "run-"));
  const graph = await analyzeStructure([
    {
      path: "policy.ts",
      content: "export function canEdit() { return true; }",
    },
  ]);
  const base = draftSpec(graph, ["system"]);
  const store = new DesignDrafts(root, resolve(root, "project"));
  return {
    root,
    base,
    store,
    request: {
      projectKey: store.projectKey,
      base,
      content: {
        ...base.content,
        desired: "조회는 유지하고 편집은 제한",
        title: "",
        acceptance: ["", "미완성 기준", ""],
      },
      expectedRevision: 0,
    },
  };
}
describe("durable design drafts", () => {
  it("restores unfinished text and the original context without writing a project or design", async () => {
    const f = await fixture();
    const saved = await f.store.save(f.request);
    const reopened = new DesignDrafts(f.root, resolve(f.root, "project"));
    expect(await reopened.list()).toEqual([saved]);
    expect(saved.content.title).toBe("");
    expect(saved.content.acceptance).toEqual(["", "미완성 기준", ""]);
    expect(saved.base).toEqual(f.base);
    expect(await readdir(f.root)).toEqual(["design-drafts"]);
    expect(() => cleanDraft(saved.content)).toThrow();
    expect(cleanDraft({ ...saved.content, title: "권한" }).acceptance).toEqual([
      "미완성 기준",
    ]);
  });
  it("isolates projects and refuses stale writers or silent context replacement", async () => {
    const f = await fixture();
    await f.store.save(f.request);
    const other = new DesignDrafts(f.root, resolve(f.root, "other", "project"));
    expect(await other.list()).toEqual([]);
    expect(() => other.save(f.request)).toThrow(/프로젝트/);
    await expect(f.store.save(f.request)).rejects.toThrow(/다른 창/);
    await expect(
      f.store.save({
        ...f.request,
        expectedRevision: 1,
        base: { ...f.base, updatedAt: "2026-10-17T00:00:00.000Z" },
      }),
    ).rejects.toThrow(/기준/);
    const updated = await f.store.save({
      ...f.request,
      expectedRevision: 1,
      content: { ...f.request.content, title: "입력 유지" },
    });
    expect(updated.revision).toBe(2);
    expect((await f.store.read(f.base.id))?.content.title).toBe("입력 유지");
  });
  it("keeps input on failed confirmation and consumes only the reviewed draft revision", async () => {
    const f = await fixture();
    const first = await f.store.save(f.request);
    const newer = {
      ...f.base,
      revision: 2,
      content: { ...f.base.content, title: "다른 창의 변경" },
    };
    const rebased = await f.store.rebase(f.base.id, first.revision, newer);
    expect(rebased.content).toEqual(first.content);
    expect(rebased.base).toEqual(newer);
    expect(rebased.revision).toBe(2);
    await expect(
      f.store.consume(f.base.id, 1, async () => "wrong"),
    ).rejects.toThrow(/다른 창/);
    await expect(
      f.store.consume(f.base.id, 2, async () => {
        throw Error("Design changed");
      }),
    ).rejects.toThrow("Design changed");
    expect(await f.store.read(f.base.id)).toEqual(rebased);
    expect(
      await f.store.consume(
        f.base.id,
        2,
        async (draft) => draft.content.desired,
      ),
    ).toBe(first.content.desired);
    expect(await f.store.list()).toEqual([]);
    await f.store.remove(f.base.id, 2); // An already confirmed draft can be dismissed.
  });
  it("detects same-revision manual edits and corrupt records without overwriting them", async () => {
    const f = await fixture();
    expect(
      draftMatches(
        { base: f.base },
        { ...f.base, updatedAt: "2026-10-17T00:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      draftMatches(
        { base: f.base },
        {
          ...f.base,
          baseline: { ...f.base.baseline, graphRevision: "0".repeat(64) },
        },
      ),
    ).toBe(false);
    const base = { ...f.base, revision: 1 };
    expect(
      draftMatches(
        { base },
        { ...base, content: { ...base.content, desired: "manual edit" } },
      ),
    ).toBe(false);
    await f.store.save(f.request);
    const directory = resolve(f.root, "design-drafts", f.store.projectKey);
    const path = resolve(directory, (await readdir(directory))[0]);
    await writeFile(path, "incomplete record");
    await expect(f.store.list()).rejects.toThrow();
    await expect(
      f.store.save({ ...f.request, expectedRevision: 1 }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("incomplete record");
  });
});
