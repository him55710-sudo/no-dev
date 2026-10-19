import { describe, expect, it } from "vitest";
import { NavigationWriter } from "../src/workspace/navigationWriter";
import {
  applyNavigationPatch,
  initialNavigation,
  navigationDifference,
  type NavigationSnapshot,
  type NavigationWrite,
} from "../src/workspace/navigation";
const key = "a".repeat(64);
const initial = (): NavigationSnapshot => ({
  generation: 1,
  revision: 0,
  view: initialNavigation(),
});
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
function deferred() {
  let resolve!: (value: NavigationSnapshot) => void,
    reject!: (error: Error) => void;
  const promise = new Promise<NavigationSnapshot>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness() {
  const writer = new NavigationWriter(key, initial());
  const requests: {
    request: NavigationWrite;
    reply: ReturnType<typeof deferred>;
  }[] = [];
  writer.connect((request) => {
    const reply = deferred();
    requests.push({ request, reply });
    return reply.promise;
  });
  let host = initial();
  const accept = (index: number) => {
    host = {
      ...host,
      revision: host.revision + 1,
      view: applyNavigationPatch(host.view, requests[index].request.patch),
    };
    requests[index].reply.resolve(host);
    return host;
  };
  return { writer, requests, accept };
}
describe("ordered navigation edits", () => {
  it("preserves a newly saved search when an older canvas finishes fitting", async () => {
    const { writer, requests } = harness();
    writer.update((view) => ({
      ...view,
      canvases: [
        {
          scopeId: "system",
          positions: [],
          viewport: { x: 10, y: 20, zoom: 0.6 },
        },
      ],
    }));
    await tick();
    expect(requests[0].request.patch).not.toHaveProperty("search");
    const saved = {
      ...initial(),
      revision: 1,
      view: { ...initialNavigation(), search: "공유 탐색" },
    };
    const merged = {
      ...saved,
      revision: 2,
      view: applyNavigationPatch(saved.view, requests[0].request.patch),
    };
    requests[0].reply.resolve(merged);
    await tick();
    expect(writer.snapshot().view.search).toBe("공유 탐색");
    expect(writer.snapshot().view.canvases).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });
  it.each(["공유 권한", ""])(
    "keeps the latest search %j while an earlier save is still pending",
    async (latest) => {
      const { writer, requests, accept } = harness();
      writer.update((view) => ({ ...view, search: "공유" }));
      await tick();
      writer.update((view) => ({ ...view, search: latest }));
      await tick();
      expect(requests).toHaveLength(1);
      accept(0);
      await tick();
      await tick();
      expect(writer.snapshot().view.search).toBe(latest);
      expect(requests[1].request.patch).toEqual({ search: latest });
      accept(1);
      await tick();
      expect(writer.snapshot().saving).toBe(false);
    },
  );
  it("ignores an older acknowledgement after a newer host snapshot", async () => {
    const { writer, requests } = harness();
    writer.update((view) => ({ ...view, focus: true }));
    await tick();
    writer.observe({
      ...initial(),
      revision: 3,
      view: { ...initialNavigation(), search: "최근 검색", focus: true },
    });
    requests[0].reply.resolve({
      ...initial(),
      revision: 1,
      view: { ...initialNavigation(), focus: true },
    });
    await tick();
    expect(writer.snapshot().view.search).toBe("최근 검색");
    expect(writer.snapshot().view.focus).toBe(true);
    writer.observe({ ...initial(), revision: 2 });
    expect(writer.snapshot().view.search).toBe("최근 검색");
    expect(requests).toHaveLength(1);
  });
  it("retains failed edits and newer input for explicit retry without a write loop", async () => {
    const { writer, requests, accept } = harness();
    writer.update((view) => ({ ...view, search: "첫 입력", focus: true }));
    await tick();
    writer.update((view) => ({ ...view, search: "최신 입력" }));
    await tick();
    requests[0].reply.reject(Error("disk unavailable"));
    await tick();
    await tick();
    expect(writer.snapshot().error).toBe("disk unavailable");
    expect(writer.snapshot().view.search).toBe("최신 입력");
    expect(requests).toHaveLength(1);
    writer.retry();
    await tick();
    expect(requests[1].request.patch).toEqual({
      search: "최신 입력",
      focus: true,
    });
    accept(1);
    await tick();
    expect(writer.snapshot().error).toBe("");
  });
  it("does not drain unsubmitted edits after the view disconnects", async () => {
    const { writer, requests, accept } = harness();
    writer.update((view) => ({ ...view, search: "전송됨" }));
    await tick();
    writer.update((view) => ({ ...view, search: "대기 중" }));
    writer.disconnect();
    accept(0);
    await tick();
    await tick();
    expect(requests).toHaveLength(1);
  });
  it("does not replay queued edits after explicit source navigation replaced the generation", async () => {
    const { writer, requests } = harness();
    writer.update((view) => ({ ...view, search: "전송됨" }));
    await tick();
    writer.update((view) => ({ ...view, search: "대기 중" }));
    requests[0].reply.resolve({
      generation: 2,
      revision: 0,
      view: initialNavigation("rule:next"),
    });
    await tick();
    await tick();
    expect(requests).toHaveLength(1);
    expect(writer.snapshot().view.selection).toBe("rule:next");
    expect(writer.snapshot().view.search).toBe("");
  });
  it("merges canvas changes by scope and sends an explicit saved-design clear", () => {
    const before = {
      ...initialNavigation(),
      savedSpecId: "design",
      canvases: [
        { scopeId: "first", positions: [] },
        { scopeId: "second", positions: [] },
      ],
    };
    const after = {
      ...before,
      savedSpecId: undefined,
      canvases: [
        ...before.canvases.slice(0, 1),
        { scopeId: "second", positions: [], viewport: { x: 3, y: 4, zoom: 1 } },
      ],
    };
    const patch = navigationDifference(before, after);
    expect(patch.savedSpecId).toBeNull();
    expect(patch.canvases?.map((c) => c.scopeId)).toEqual(["second"]);
    const remote = {
      ...before,
      search: "keep",
      canvases: [...before.canvases, { scopeId: "remote", positions: [] }],
    };
    const result = applyNavigationPatch(remote, patch);
    expect(result.search).toBe("keep");
    expect(result.savedSpecId).toBeUndefined();
    expect(result.canvases.map((c) => c.scopeId)).toEqual([
      "first",
      "remote",
      "second",
    ]);
  });
});
