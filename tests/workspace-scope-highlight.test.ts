import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  projectFeatures,
  saveFeature,
  featureNodeId,
} from "../src/workspace/features";
import { implementationScope } from "../src/workspace/spec";
import { scopeHighlights } from "../src/workspace/scopeHighlight";
import type { StructureGraph } from "../src/workspace/model";

const files = [
  {
    path: "policy.ts",
    content:
      "export function canEdit(role:string){return role === 'owner';} export function unrelated(){return 42;}",
  },
  {
    path: "api/update.ts",
    content:
      "import {canEdit} from '../policy'; export function update(role:string){return canEdit(role);}",
  },
  {
    path: "ui/Button.tsx",
    content:
      "import {canEdit} from '../policy'; export function Button(){return <button disabled={!canEdit('viewer')}>Edit</button>;}",
  },
  {
    path: "tests/permissions.test.ts",
    content:
      "import {canEdit} from '../policy'; console.assert(!canEdit('viewer'));",
  },
  { path: "unrelated.ts", content: "export function untouched(){return 0;}" },
];
const named = (graph: StructureGraph, label: string) =>
  graph.nodes.find((node) => node.kind === "symbol" && node.label === label)!;
const highlight = (graph: StructureGraph, targets: string[]) =>
  scopeHighlights(
    graph,
    targets,
    implementationScope(graph, targets).nodes.map((node) => node.id),
  );

describe("design scope across navigation levels", () => {
  it("projects real UI/API/test callers into their folders without marking unrelated siblings or import edges", async () => {
    const graph = await analyzeStructure(files),
      before = structuredClone(graph);
    const policy = named(graph, "canEdit"),
      api = named(graph, "update"),
      ui = named(graph, "Button");
    const result = highlight(graph, [policy.id]);
    expect(result.nodes.get(policy.id)).toBe("target");
    expect(result.nodes.get(policy.parentId!)).toBe("target-container");
    for (const caller of [api, ui]) {
      expect(result.nodes.get(caller.id)).toBe("related");
      expect(result.nodes.get(caller.parentId!)).toBe("related-container");
    }
    const testFile = graph.nodes.find(
      (node) =>
        node.kind === "file" &&
        node.sources[0]?.path === "tests/permissions.test.ts",
    )!;
    expect(result.nodes.get(testFile.id)).toBe("related");
    expect(result.nodes.get(testFile.parentId!)).toBe("related-container");
    expect(result.nodes.has(named(graph, "unrelated").id)).toBe(false);
    expect(result.nodes.has(named(graph, "untouched").id)).toBe(false);
    const calls = graph.edges.filter(
      (edge) => edge.kind === "calls" && edge.target === policy.id,
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((edge) => result.edges.has(edge.id))).toBe(true);
    expect(
      graph.edges
        .filter((edge) => edge.kind === "imports")
        .every((edge) => !result.edges.has(edge.id)),
    ).toBe(true);
    expect(graph).toEqual(before);
  });
  it("marks overlapping business features without selecting their unrelated members", async () => {
    const base = await analyzeStructure(files),
      policy = named(base, "canEdit"),
      unrelated = named(base, "untouched");
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ];
    let features = saveFeature(
      [],
      base,
      {
        title: "공유",
        description: "",
        memberIds: [policy.id],
        expectedRevision: 0,
        expectedGraphRevision: base.revision,
      },
      ids[0],
    );
    let graph = await projectFeatures(base, features);
    features = saveFeature(
      features,
      graph,
      {
        title: "다른 기능",
        description: "",
        memberIds: [policy.id, unrelated.id],
        expectedRevision: 0,
        expectedGraphRevision: graph.revision,
      },
      ids[1],
    );
    graph = await projectFeatures(base, features);
    const original = structuredClone(graph),
      target = featureNodeId(ids[0]);
    const result = highlight(graph, [target]);
    expect(result.nodes.get(target)).toBe("target");
    expect(result.nodes.get(policy.id)).toBe("target");
    expect(result.nodes.get(featureNodeId(ids[1]))).toBe("target-container");
    expect(result.nodes.has(unrelated.id)).toBe(false);
    expect(graph).toEqual(original);
  });
  it("uses the selected file's full contents as targets and does not fabricate missing selections", async () => {
    const graph = await analyzeStructure(files),
      policy = named(graph, "canEdit");
    const result = highlight(graph, [policy.parentId!]);
    expect(result.nodes.get(policy.parentId!)).toBe("target");
    expect(result.nodes.get(policy.id)).toBe("target");
    expect(result.nodes.get(named(graph, "unrelated").id)).toBe("target");
    expect(result.nodes.get(named(graph, "update").id)).toBe("related");
    const missing = highlight(graph, ["removed"]);
    expect(missing.nodes.size).toBe(0);
    expect(missing.edges.size).toBe(0);
  });
});
