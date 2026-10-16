import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  descendantIds,
  structureChildren,
  structureConnections,
  sourceNode,
} from "../src/workspace/model";
import {
  featureNodeId,
  projectFeatures,
  saveFeature,
  removeFeature,
  featureListSchema,
} from "../src/workspace/features";
import {
  draftSpec,
  saveSpec,
  observeSpec,
  acceptBaseline,
  prepareChange,
  specDocumentSchema,
} from "../src/workspace/spec";
const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002";
const files = [
  {
    path: "policy.ts",
    content: "export function canEdit(role:string){return role === 'owner';}",
  },
  {
    path: "api/update.ts",
    content:
      "import {canEdit} from '../policy'; export function update(role:string){return canEdit(role);}",
  },
  {
    path: "ui/Button.tsx",
    content:
      "import {canEdit} from '../policy'; export function Button(){return <button disabled={!canEdit('viewer')}>Edit</button>; }",
  },
  { path: "private.ts", content: "export function unrelated(){return 42;}" },
];
const named = (
  graph: Awaited<ReturnType<typeof analyzeStructure>>,
  name: string,
) => graph.nodes.find((node) => node.kind === "symbol" && node.label === name)!;
describe("user-defined business features", () => {
  it("keeps many-to-many membership and canonical compiler evidence across folders", async () => {
    const base = await analyzeStructure(files),
      original = structuredClone(base);
    const policy = named(base, "canEdit"),
      api = named(base, "update"),
      ui = named(base, "Button");
    let features = saveFeature(
      [],
      base,
      {
        title: "공유 수정",
        description: "사용자 정의 목적",
        memberIds: [policy.id, api.id],
        expectedRevision: 0,
        expectedGraphRevision: base.revision,
      },
      a,
    );
    let graph = await projectFeatures(base, features);
    features = saveFeature(
      features,
      graph,
      {
        title: "공유 화면",
        description: "권한에 맞는 버튼",
        memberIds: [policy.id, ui.id],
        expectedRevision: 0,
        expectedGraphRevision: graph.revision,
      },
      b,
    );
    graph = await projectFeatures(base, features);
    expect(base).toEqual(original);
    expect(graph.edges).toEqual(base.edges);
    expect(graph.nodes.filter((node) => node.id === policy.id)).toHaveLength(1);
    expect(
      structureChildren(graph, featureNodeId(a))
        .map((node) => node.id)
        .sort(),
    ).toEqual([policy.id, api.id].sort());
    expect(descendantIds(graph, [featureNodeId(b)]).has(policy.id)).toBe(true);
    expect(
      sourceNode(graph, "policy.ts", files[0].content.indexOf("return"))?.id,
    ).toBe(
      sourceNode(base, "policy.ts", files[0].content.indexOf("return"))?.id,
    );
    const level = structureConnections(
      graph,
      structureChildren(graph, featureNodeId(a)),
    );
    expect(level).toHaveLength(1);
    expect(level[0].source).toBe(api.id);
    expect(level[0].target).toBe(policy.id);
    expect(level[0].data.originals).toEqual(
      base.edges
        .filter((edge) => edge.source === api.id && edge.target === policy.id)
        .map((edge) => edge.id),
    );
    expect(
      structureConnections(graph, structureChildren(graph, "system")).every(
        (edge) => edge.source !== "code-tree" && edge.target !== "code-tree",
      ),
    ).toBe(true);
    const spec = draftSpec(graph, [featureNodeId(a)]);
    spec.content.desired = "viewer 수정 거절";
    spec.content.acceptance = ["owner 편집 유지"];
    expect(spec.baseline.observed).toContain("canEdit");
    const document = saveSpec(
      { schemaVersion: 1, specs: [], features },
      spec,
      0,
    );
    expect(document.features).toEqual(features);
    expect(
      specDocumentSchema.parse(JSON.parse(JSON.stringify(document))),
    ).toEqual(document);
    expect(
      prepareChange(document.specs[0], graph, "behavior")!.scopePaths,
    ).toEqual(["api/update.ts", "policy.ts", "ui/Button.tsx"]);
  });
  it("surfaces removed membership as drift and preserves target intent on explicit rebaseline", async () => {
    const base = await analyzeStructure(files);
    const feature = saveFeature(
      [],
      base,
      {
        title: "권한",
        description: "",
        memberIds: [named(base, "canEdit").id, named(base, "unrelated").id],
        expectedRevision: 0,
        expectedGraphRevision: base.revision,
      },
      a,
    );
    const old = await projectFeatures(base, feature);
    const spec = draftSpec(old, [featureNodeId(a)]);
    spec.content.desired = "편집 제한";
    spec.content.acceptance = ["viewer 거절"];
    const document = saveSpec(
      { schemaVersion: 1, specs: [], features: feature },
      spec,
      0,
    );
    const edited = saveFeature(
      feature,
      old,
      {
        id: a,
        title: "프로젝트 권한",
        description: "새 설명",
        memberIds: [named(base, "canEdit").id],
        expectedRevision: 1,
        expectedGraphRevision: old.revision,
      },
      a,
    );
    const graph = await projectFeatures(base, edited);
    expect(graph.revision).not.toBe(old.revision);
    expect(observeSpec(document.specs[0], graph).status).toBe("changed");
    expect(() => prepareChange(document.specs[0], graph, "behavior")).toThrow();
    const next = acceptBaseline({ ...document, features: edited }, graph, {
      specId: spec.id,
      expectedRevision: 1,
      expectedGraphRevision: graph.revision,
      targetIds: [featureNodeId(a)],
    });
    expect(next.features).toEqual(edited);
    expect(next.specs[0].content).toEqual(spec.content);
    expect(
      prepareChange(next.specs[0], graph, "behavior")!.scopePaths,
    ).not.toContain("private.ts");
  });
  it("reattaches unique moves, retains missing references, and refuses ambiguous implementation", async () => {
    const base = await analyzeStructure([files[0]]);
    const feature = saveFeature(
      [],
      base,
      {
        title: "권한",
        description: "",
        memberIds: [named(base, "canEdit").id],
        expectedRevision: 0,
        expectedGraphRevision: base.revision,
      },
      a,
    );
    const old = await projectFeatures(base, feature),
      spec = draftSpec(old, [featureNodeId(a)]);
    spec.content.desired = "읽기 전용";
    spec.content.acceptance = ["쓰기 거절"];
    const document = saveSpec(
      { schemaVersion: 1, specs: [], features: feature },
      spec,
      0,
    );
    const movedBase = await analyzeStructure([
      { ...files[0], path: "moved.ts" },
    ]);
    const moved = await projectFeatures(movedBase, feature);
    expect(
      moved.nodes.find((node) => node.id === featureNodeId(a))!
        .unresolvedMembers,
    ).toEqual([]);
    expect(prepareChange(spec, moved, "behavior")!.scopePaths).toEqual([
      "moved.ts",
    ]);
    const ambiguousBase = await analyzeStructure(
      ["x.ts", "y.ts"].map((path) => ({ ...files[0], path })),
    );
    const ambiguous = await projectFeatures(ambiguousBase, feature);
    expect(observeSpec(spec, ambiguous).status).toBe("reconnect");
    expect(() => prepareChange(spec, ambiguous, "behavior")).toThrow();
    expect(() =>
      acceptBaseline(document, ambiguous, {
        specId: spec.id,
        expectedRevision: 1,
        expectedGraphRevision: ambiguous.revision,
        targetIds: [featureNodeId(a)],
      }),
    ).toThrow(/연결/);
    const retained = saveFeature(
      feature,
      ambiguous,
      {
        id: a,
        title: "미연결 권한",
        description: "",
        memberIds: [feature[0].members[0].nodeId],
        expectedRevision: 1,
        expectedGraphRevision: ambiguous.revision,
      },
      a,
    );
    expect(retained[0].members).toEqual(feature[0].members);
    expect(
      ambiguous.notices.some((notice) => notice.message.includes("모호")),
    ).toBe(true);
    const repaired = saveFeature(
      retained,
      ambiguous,
      {
        id: a,
        title: "권한",
        description: "",
        memberIds: [named(ambiguous, "canEdit").id],
        expectedRevision: 2,
        expectedGraphRevision: ambiguous.revision,
      },
      a,
    );
    expect(
      (await projectFeatures(ambiguousBase, repaired)).nodes.find(
        (node) => node.id === featureNodeId(a),
      )!.unresolvedMembers,
    ).toEqual([]);
  });
  it("rejects stale updates, nested feature cycles, forged targets and duplicate identities", async () => {
    const base = await analyzeStructure(files);
    const request = {
      title: "권한",
      description: "",
      memberIds: [named(base, "canEdit").id],
      expectedRevision: 0,
      expectedGraphRevision: base.revision,
    };
    const feature = saveFeature([], base, request, a),
      graph = await projectFeatures(base, feature);
    expect(() =>
      saveFeature(feature, graph, { ...request, id: a }, a),
    ).toThrow();
    expect(() =>
      saveFeature(
        feature,
        graph,
        {
          ...request,
          expectedGraphRevision: graph.revision,
          memberIds: [featureNodeId(a)],
        },
        b,
      ),
    ).toThrow();
    expect(() =>
      saveFeature(
        feature,
        graph,
        {
          ...request,
          expectedGraphRevision: graph.revision,
          memberIds: ["missing"],
        },
        b,
      ),
    ).toThrow();
    expect(() => featureListSchema.parse([...feature, ...feature])).toThrow();
    expect(() =>
      removeFeature(feature, graph, {
        id: a,
        expectedRevision: 2,
        expectedGraphRevision: graph.revision,
      }),
    ).toThrow();
    expect(
      removeFeature(feature, graph, {
        id: a,
        expectedRevision: 1,
        expectedGraphRevision: graph.revision,
      }),
    ).toEqual([]);
    const spec = draftSpec(graph, [featureNodeId(a)]);
    expect(observeSpec(spec, base).status).toBe("reconnect");
  });
});
