import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  acceptBaseline,
  currentObservations,
  draftSpec,
  saveSpec,
  specDocumentSchema,
} from "../src/workspace/spec";
import {
  captureObservations,
  compareObservations,
  observationSnapshotSchema,
  observationSource,
} from "../src/workspace/observations";

const files = [
  {
    path: "policy.ts",
    content:
      'export function canEdit(role: string) { return role === "owner" || role === "viewer"; }',
  },
  {
    path: "api.ts",
    content:
      'import {canEdit} from "./policy"; export function update(role: string) { if(!canEdit(role)) throw Error("Forbidden"); return true; }',
  },
  {
    path: "ui.ts",
    content:
      'import {canEdit} from "./policy"; export function controls(role: string) { return canEdit(role); }',
  },
];
describe("stored observations and current evidence", () => {
  it("captures real shared policy behavior and compiler-backed UI/API relations, preserving goal text across external edits", async () => {
    const graph = await analyzeStructure(files);
    const spec = draftSpec(graph, ["system"]);
    spec.content.desired = "viewer는 조회만 허용";
    spec.content.acceptance = ["수정 거절", "데이터 보존"];
    const saved = saveSpec({ schemaVersion: 1, specs: [] }, spec, 0);
    const original = structuredClone(saved);
    const changed = await analyzeStructure(
      files.map((file) =>
        file.path === "policy.ts"
          ? {
              ...file,
              content: file.content.replace(' || role === "viewer"', ""),
            }
          : file,
      ),
    );
    const comparison = compareObservations(
      saved.specs[0].baseline.observations,
      currentObservations(saved.specs[0], changed),
    );
    const policy = comparison.facts.find(
      (item) => item.current?.label === "canEdit",
    )!;
    expect(policy.status).toBe("changed");
    expect(policy.before!.summary).toContain("viewer");
    expect(policy.current!.summary).not.toContain("viewer");
    expect(
      comparison.relations.filter(
        (item) => item.current?.to.label === "canEdit",
      ),
    ).toHaveLength(2);
    expect(
      comparison.relations.every((item) => item.status === "unchanged"),
    ).toBe(true);
    expect(observationSource(changed, policy.current!.source)?.id).toBe(
      policy.current!.id,
    );
    expect(saved).toEqual(original);
    expect(comparison).not.toHaveProperty("satisfied");
  });
  it("tracks added declarations and changed call targets/counts without calling a missing static edge a removed runtime path", async () => {
    const graph = await analyzeStructure(files),
      spec = draftSpec(graph, ["system"]);
    const changed = await analyzeStructure(
      files.map((file) =>
        file.path === "api.ts"
          ? {
              ...file,
              content:
                file.content.replace(
                  "if(!canEdit(role))",
                  "audit(); if(!canEdit(role))",
                ) + " export function audit(){return 1;}",
            }
          : file,
      ),
    );
    const result = compareObservations(
      spec.baseline.observations,
      currentObservations(spec, changed),
    );
    expect(
      result.facts.find((item) => item.current?.label === "audit")?.status,
    ).toBe("added");
    const added = result.relations.find(
      (item) => item.current?.to.label === "audit",
    )!;
    expect(added.status).toBe("added");
    expect(observationSource(changed, added.current!.source)).toBeDefined();
    const doubled = await analyzeStructure(
      files.map((file) =>
        file.path === "ui.ts"
          ? {
              ...file,
              content: file.content.replace(
                "return canEdit(role);",
                "canEdit(role); return canEdit(role);",
              ),
            }
          : file,
      ),
    );
    expect(
      compareObservations(
        spec.baseline.observations,
        currentObservations(spec, doubled),
      ).relations.find((item) => item.current?.from.label === "controls")
        ?.status,
    ).toBe("changed");
    const removed = await analyzeStructure(
      files.filter((file) => file.path !== "ui.ts"),
    );
    expect(
      compareObservations(
        spec.baseline.observations,
        currentObservations(spec, removed),
      ).relations.some((item) => item.status === "unresolved"),
    ).toBe(true);
  });
  it("restores uniquely moved facts, ignores comment/line shifts and refuses ambiguous same-content candidates", async () => {
    const graph = await analyzeStructure([files[0]]),
      id = graph.nodes.find((node) => node.label === "canEdit")!.id;
    const spec = draftSpec(graph, [id]);
    const shifted = await analyzeStructure([
      { ...files[0], content: "// line shift\n" + files[0].content },
    ]);
    expect(
      compareObservations(
        spec.baseline.observations,
        currentObservations(spec, shifted),
      ).facts[0].status,
    ).toBe("unchanged");
    const moved = await analyzeStructure([{ ...files[0], path: "moved.ts" }]);
    const comparison = compareObservations(
      spec.baseline.observations,
      currentObservations(spec, moved),
    );
    expect(comparison.facts[0].status).toBe("moved");
    expect(comparison.facts[0].current?.source.path).toBe("moved.ts");
    const incomplete = currentObservations(spec, moved);
    incomplete.totals.facts++;
    expect(
      compareObservations(spec.baseline.observations, incomplete).facts[0]
        .status,
    ).toBe("unresolved");
    const ambiguous = await analyzeStructure(
      ["one.ts", "two.ts"].map((path) => ({ ...files[0], path })),
    );
    expect(
      compareObservations(
        spec.baseline.observations,
        currentObservations(spec, ambiguous),
      ).facts[0].status,
    ).toBe("unresolved");
  });
  it("aligns unchanged conditions before matching numbered positions after an inserted rule", async () => {
    const original =
      "export function f(a:boolean,b:boolean){if(a)return 1;if(b)return 2;return 0;}";
    const graph = await analyzeStructure([
      { path: "rules.ts", content: original },
    ]);
    const spec = draftSpec(graph, ["system"]);
    const changed = await analyzeStructure([
      {
        path: "rules.ts",
        content: original.replace("{if(a)", "{if(!a&&!b)return 3;if(a)"),
      },
    ]);
    const result = compareObservations(
      spec.baseline.observations,
      currentObservations(spec, changed),
    );
    expect(
      result.facts
        .filter((item) => item.before?.kind === "rule")
        .map((item) => item.status),
    ).toEqual(["moved", "moved"]);
    expect(
      result.facts.some(
        (item) => item.status === "added" && item.current?.kind === "rule",
      ),
    ).toBe(true);
    const selectedRule = draftSpec(graph, [
      graph.nodes.find((node) => node.kind === "rule")!.id,
    ]);
    const focused = compareObservations(
      selectedRule.baseline.observations,
      currentObservations(selectedRule, changed),
    );
    expect(focused.facts).toHaveLength(1);
    expect(focused.facts[0].status).toBe("moved");
    expect(focused.facts[0].current?.source.contentHash).toBe(
      focused.facts[0].before?.source.contentHash,
    );
  });
  it("retains observations for a moved file when other selected files still exist", async () => {
    const graph = await analyzeStructure(files);
    const spec = draftSpec(
      graph,
      graph.nodes.filter((node) => node.kind === "file").map((node) => node.id),
    );
    const moved = await analyzeStructure(
      files.map((file) =>
        file.path === "policy.ts" ? { ...file, path: "moved.ts" } : file,
      ),
    );
    const result = compareObservations(
      spec.baseline.observations,
      currentObservations(spec, moved),
    );
    expect(
      result.facts.find((item) => item.before?.label === "canEdit")?.status,
    ).toBe("moved");
    expect(
      result.facts.find((item) => item.before?.label === "controls")?.status,
    ).toBe("unchanged");
    expect(spec.targetIds).toContain(
      graph.nodes.find(
        (node) => node.kind === "file" && node.label === "policy.ts",
      )!.id,
    );
  });
  it("round-trips old designs without fabricating historic facts and keeps snapshots through explicit baseline acceptance", async () => {
    const graph = await analyzeStructure(files),
      spec = draftSpec(graph, ["system"]);
    spec.content.desired = "viewer 수정 거절";
    const legacy = structuredClone(spec);
    delete legacy.baseline.observations;
    const saved = saveSpec({ schemaVersion: 1, specs: [] }, legacy, 0);
    expect(
      specDocumentSchema.parse(JSON.parse(JSON.stringify(saved))).specs[0]
        .baseline.observations,
    ).toBeUndefined();
    expect(
      compareObservations(undefined, currentObservations(saved.specs[0], graph))
        .legacy,
    ).toBe(true);
    const next = acceptBaseline(saved, graph, {
      specId: legacy.id,
      expectedRevision: 1,
      expectedGraphRevision: graph.revision,
      targetIds: ["system"],
    });
    expect(next.specs[0].baseline.observations).toBeDefined();
    expect(
      next.specs[0].baselineHistory![0].baseline.observations,
    ).toBeUndefined();
    const again = acceptBaseline(next, graph, {
      specId: legacy.id,
      expectedRevision: 2,
      expectedGraphRevision: graph.revision,
      targetIds: ["system"],
    });
    expect(again.specs[0].baselineHistory![1].baseline.observations).toEqual(
      next.specs[0].baseline.observations,
    );
    expect(again.specs[0].content).toEqual(saved.specs[0].content);
    expect(() =>
      saveSpec(
        again,
        {
          ...again.specs[0],
          baseline: { ...again.specs[0].baseline, observations: undefined },
        },
        3,
      ),
    ).toThrow(/기준선/);
  });
  it("bounds snapshots and reports omitted facts, unsupported files and syntax errors honestly", async () => {
    const graph = await analyzeStructure([
      {
        path: "large.ts",
        content: Array.from(
          { length: 180 },
          (_, i) => `export function f${i}(){return ${i};}`,
        ).join("\n"),
      },
      { path: "bad.ts", content: "export function broken( {" },
      { path: "guide.md", content: "# Guide" },
    ]);
    graph.nodes.forEach((node) => {
      node.summary += "x".repeat(2000);
    });
    graph.notices.push(
      ...Array.from({ length: 30 }, () => ({ message: "긴 안내".repeat(500) })),
    );
    const snapshot = captureObservations(graph, ["system"]);
    expect(
      new TextEncoder().encode(JSON.stringify(snapshot, null, 2)).length,
    ).toBeLessThanOrEqual(64 * 1024);
    expect(snapshot.facts.length).toBeLessThan(snapshot.totals.facts);
    expect(snapshot.notices.length).toBeLessThan(snapshot.totals.notices);
    expect(snapshot.facts.some((fact) => fact.summaryTruncated)).toBe(true);
    const bad = captureObservations(graph, [
      graph.nodes.find(
        (node) => node.kind === "file" && node.label === "bad.ts",
      )!.id,
    ]);
    expect(bad.facts.some((fact) => !fact.syntaxValid)).toBe(true);
    const guide = captureObservations(graph, [
      graph.nodes.find(
        (node) => node.kind === "file" && node.label === "guide.md",
      )!.id,
    ]);
    expect(guide.facts[0].supported).toBe(false);
    expect(() =>
      observationSnapshotSchema.parse({ ...snapshot, command: "execute" }),
    ).toThrow();
  });
});
