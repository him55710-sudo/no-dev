import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  initialNavigation,
  navigationWriteSchema,
  reconcileNavigation,
  enterScope,
} from "../src/workspace/navigation";
import { NavigationStore } from "../extension/src/navigationStore";

async function graphFixture() {
  const graph = await analyzeStructure([
    {
      path: "sharing/policy.ts",
      content:
        "export function canEdit(role: string) { return role === 'owner'; }",
    },
    {
      path: "sharing/api.ts",
      content:
        "import { canEdit } from './policy'; export function update(role: string) { return canEdit(role); }",
    },
  ]);
  const file = graph.nodes.find(
    (node) =>
      node.kind === "file" && node.sources[0]?.path === "sharing/policy.ts",
  )!;
  const symbol = graph.nodes.find(
    (node) => node.kind === "symbol" && node.label === "canEdit",
  )!;
  const feature = {
    id: "feature:sharing",
    kind: "feature" as const,
    origin: "user" as const,
    parentId: "system",
    label: "공유",
    summary: "",
    sources: [],
    syntaxValid: true,
    members: [file.id],
  };
  graph.nodes.push(feature);
  return { graph, file, symbol, feature };
}

describe("workspace navigation", () => {
  it("restores a feature's alias path, selected rule, saved design and per-scope layout without canonicalizing away the user's context", async () => {
    const { graph, file, symbol, feature } = await graphFixture();
    let view = initialNavigation(symbol.id);
    view = enterScope(view, graph, feature.id);
    view = enterScope(view, graph, file.id);
    view.savedSpecId = "saved-permission-design";
    view.included = [file.id, symbol.id];
    view.expanded = ["system", feature.id, file.id];
    view.search = "canEdit";
    view.focus = true;
    view.canvases = [
      {
        scopeId: file.id,
        viewport: { x: -50, y: 80, zoom: 1.25 },
        positions: [{ id: symbol.id, x: 70, y: 90 }],
      },
    ];
    expect(view.scopeTrail).toEqual(["system", feature.id, file.id]);
    expect(reconcileNavigation(view, graph, [view.savedSpecId])).toEqual(view);
    expect(enterScope(view, graph, feature.id).scopeTrail).toEqual([
      "system",
      feature.id,
    ]);
  });
  it("keeps only valid path prefixes after deletion and never rebinds a missing symbol by matching its label", async () => {
    const { graph, file, symbol, feature } = await graphFixture();
    const view = {
      ...initialNavigation(symbol.id),
      scopeTrail: ["system", feature.id, file.id, symbol.id],
      included: [symbol.id],
      connections: [graph.edges[0].id],
      savedSpecId: "removed",
      expanded: ["system", symbol.id],
      canvases: [
        { scopeId: file.id, positions: [{ id: symbol.id, x: 1, y: 2 }] },
      ],
    };
    graph.nodes = graph.nodes.filter((node) => node.id !== symbol.id);
    graph.nodes.push({
      ...symbol,
      id: "a-different-symbol-with-the-same-label",
    });
    graph.edges = [];
    const restored = reconcileNavigation(view, graph, []);
    expect(restored.selection).toBe(file.id);
    expect(restored.scopeTrail).toEqual(["system", feature.id, file.id]);
    expect(restored.included).toEqual([]);
    expect(restored.connections).toEqual([]);
    expect(restored.savedSpecId).toBeUndefined();
    expect(restored.expanded).toEqual(["system"]);
    expect(restored.canvases[0].positions).toEqual([]);
  });
  it("preserves a saved draft's identity and an edge inspector, but truncates forged or cyclic breadcrumb chains", async () => {
    const { graph, file, feature } = await graphFixture();
    const edge = graph.edges[0];
    const view = {
      ...initialNavigation(edge.id),
      savedSpecId: "draft-only",
      connections: [edge.id, "gone", edge.id],
      scopeTrail: ["system", feature.id, file.id, feature.id],
    };
    const restored = reconcileNavigation(view, graph, ["draft-only"]);
    expect(restored.selection).toBe(edge.id);
    expect(restored.savedSpecId).toBe("draft-only");
    expect(restored.connections).toEqual([edge.id]);
    expect(restored.scopeTrail).toEqual(["system", feature.id, file.id]);
  });
  it("rejects executable fields and invalid viewport values in browser input", () => {
    const request = {
      projectKey: "a".repeat(64),
      generation: 0,
      patch: { search: "공유" },
    };
    expect(navigationWriteSchema.parse(request)).toEqual(request);
    expect(() =>
      navigationWriteSchema.parse({ ...request, command: "run" }),
    ).toThrow();
    expect(() =>
      navigationWriteSchema.parse({ ...request, generation: -1 }),
    ).toThrow();
    for (const zoom of [NaN, Infinity, 0, 2])
      expect(() =>
        navigationWriteSchema.parse({
          ...request,
          patch: {
            ...request.patch,
            canvases: [
              {
                scopeId: "system",
                positions: [],
                viewport: { x: 0, y: 0, zoom },
              },
            ],
          },
        }),
      ).toThrow();
  });
});

describe("local navigation storage", () => {
  async function fixture() {
    const parent = resolve("test-results/navigation");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(resolve(parent, "run-"));
    return { root, store: new NavigationStore(root, "a".repeat(64)) };
  }
  it("survives a new store instance, isolates projects and persists the latest queued interaction", async () => {
    const { root, store } = await fixture();
    const first = { ...initialNavigation(), search: "first", focus: true };
    const latest = { ...first, search: "latest", selection: "file:policy.ts" };
    await Promise.all([store.save(first), store.save(latest)]);
    expect(await new NavigationStore(root, store.projectKey).read()).toEqual(
      latest,
    );
    expect(await new NavigationStore(root, "b".repeat(64)).read()).toEqual(
      initialNavigation(),
    );
    expect(await readdir(root)).toEqual(["navigation"]);
    expect(await readdir(resolve(root, "navigation"))).toEqual([
      store.projectKey + ".json",
    ]);
  });
  it("rejects corrupt, oversized and cross-project records and preserves valid data on invalid writes", async () => {
    const { root, store } = await fixture();
    const path = resolve(root, "navigation", store.projectKey + ".json");
    await store.save(initialNavigation());
    const original = await readFile(path, "utf8");
    expect(() =>
      store.save({ ...initialNavigation(), search: "x".repeat(501) }),
    ).toThrow();
    expect(await readFile(path, "utf8")).toBe(original);
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        projectKey: "b".repeat(64),
        view: initialNavigation(),
      }),
    );
    await expect(store.read()).rejects.toThrow(/다른 프로젝트/);
    await writeFile(path, "{");
    await expect(store.read()).rejects.toThrow();
    await writeFile(path, "x".repeat(2 * 1024 * 1024 + 1));
    await expect(store.read()).rejects.toThrow(/크기 제한/);
    await store.save(initialNavigation());
    expect(await store.read()).toEqual(initialNavigation());
  });
});
