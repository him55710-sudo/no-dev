import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import { sourceNode } from "../src/workspace/model";
import {
  draftSpec,
  observeSpec,
  prepareChange,
  saveSpec,
  specDocumentSchema,
} from "../src/workspace/spec";

const fixture = [
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
        jsx: "preserve",
      },
    }),
  },
  {
    path: "src/sharing/policy.ts",
    content:
      'export function canEdit(role: string) { if (role === "owner") return true; return role === "editor"; }',
  },
  {
    path: "src/sharing/index.ts",
    content: 'export { canEdit } from "./policy";',
  },
  {
    path: "src/api/update.ts",
    content:
      'import { canEdit as allowed } from "@/sharing"; export function update(role: string) { if (!allowed(role)) throw new Error("Forbidden"); return "saved"; }',
  },
  {
    path: "src/ui/EditButton.tsx",
    content:
      'import { canEdit } from "@/sharing"; export function EditButton({role}: {role:string}) { return <button disabled={!canEdit(role)}>Edit</button>; }',
  },
  {
    path: "src/ui/Page.tsx",
    content:
      'import { EditButton } from "./EditButton"; export function Page() { return <EditButton role="viewer" />; }',
  },
  { path: "notes.md", content: "Project sharing" },
];
describe("source-backed system structure", () => {
  it("resolves aliases and re-exports to the real policy shared by API and UI", async () => {
    const graph = await analyzeStructure(fixture);
    const policy = graph.nodes.find(
      (n) => n.kind === "symbol" && n.label === "canEdit",
    )!;
    const incoming = graph.edges.filter(
      (edge) => edge.kind === "calls" && edge.target === policy.id,
    );
    expect(incoming).toHaveLength(2);
    expect(
      incoming
        .map((e) => graph.nodes.find((n) => n.id === e.source)!.label)
        .sort(),
    ).toEqual(["EditButton", "update"]);
    expect(graph.edges.some((edge) => edge.kind === "renders")).toBe(true);
    expect(graph.nodes.find((n) => n.label === "notes.md")!.summary).toContain(
      "미지원",
    );
    const api = fixture.find((f) => f.path === "src/api/update.ts")!;
    for (const edge of incoming) {
      const ref = edge.sources[0],
        file = fixture.find((f) => f.path === ref.path)!;
      expect(file.content.slice(ref.start, ref.end)).toMatch(
        /(?:allowed|canEdit)\(role\)/,
      );
      expect(ref.fileHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const location = sourceNode(graph, api.path, api.content.indexOf("throw"))!;
    expect(location.kind).toBe("rule");
    expect(location.sources[0].path).toBe(api.path);
  });
  it("keeps same-named but unrelated functions separate, and reports dynamic gaps", async () => {
    const graph = await analyzeStructure([
      {
        path: "a.ts",
        content:
          "export function save() { return 1; } export function run(){ return save(); }",
      },
      {
        path: "b.ts",
        content:
          "export function save() { return 2; } export function run(name:string){ import(name); return save(); }",
      },
    ]);
    const calls = graph.edges.filter((edge) => edge.kind === "calls");
    expect(calls).toHaveLength(2);
    for (const edge of calls) {
      expect(
        graph.nodes.find((n) => n.id === edge.source)!.sources[0].path,
      ).toBe(graph.nodes.find((n) => n.id === edge.target)!.sources[0].path);
    }
    expect(graph.notices.some((n) => n.message.includes("동적 import"))).toBe(
      true,
    );
  });
  it("keeps symbol identities after line shifts and records syntax errors", async () => {
    const before = await analyzeStructure(fixture);
    const after = await analyzeStructure(
      fixture.map((f) => ({
        ...f,
        content: f.path.endsWith("policy.ts")
          ? "// comment\n\n" + f.content
          : f.content,
      })),
    );
    const a = before.nodes.find((n) => n.label === "canEdit")!;
    const b = after.nodes.find((n) => n.label === "canEdit")!;
    expect(b.id).toBe(a.id);
    expect(b.sources[0].contentHash).toBe(a.sources[0].contentHash);
    expect(b.sources[0].line).toBe(a.sources[0].line + 2);
    const broken = await analyzeStructure([
      { path: "broken.ts", content: "export function broken( {" },
    ]);
    expect(broken.notices.length).toBeGreaterThan(0);
    expect(broken.nodes.find((n) => n.label === "broken.ts")!.syntaxValid).toBe(
      false,
    );
  });
  it("rejects paths outside the snapshot and duplicate files", async () => {
    for (const path of [
      "../secret.ts",
      "/etc/secret.ts",
      "C:/secret.ts",
      "a\\b.ts",
      "a/../b.ts",
    ]) {
      await expect(analyzeStructure([{ path, content: "" }])).rejects.toThrow();
    }
    await expect(analyzeStructure([fixture[0], fixture[0]])).rejects.toThrow(
      /중복/,
    );
  });
});

describe("living design and observed implementation", () => {
  it("preserves confirmed intent while code drifts and rejects a stale implementation request", async () => {
    const graph = await analyzeStructure(fixture);
    const node = graph.nodes.find((n) => n.label === "canEdit")!;
    const spec = draftSpec(graph, [node.id]);
    spec.content.desired = "읽기 전용 멤버의 수정은 거절한다.";
    spec.content.acceptance = [
      "viewer의 수정 요청은 거절하고 데이터를 유지한다.",
    ];
    const document = saveSpec({ schemaVersion: 1, specs: [] }, spec, 0);
    const confirmed = document.specs[0];
    const original = structuredClone(confirmed);
    const changed = await analyzeStructure(
      fixture.map((f) =>
        f.path.endsWith("policy.ts")
          ? {
              ...f,
              content: f.content.replace(
                'role === "editor"',
                'role !== "guest"',
              ),
            }
          : f,
      ),
    );
    expect(observeSpec(confirmed, changed).status).toBe("changed");
    expect(confirmed).toEqual(original);
    expect(() => prepareChange(confirmed, changed, "behavior")).toThrow(
      /다시 검토/,
    );
    expect(prepareChange(confirmed, changed, "documentation")).toBeUndefined();
  });
  it("reconnects unchanged moved code, without guessing ambiguous duplicates", async () => {
    const graph = await analyzeStructure([
      { path: "a.ts", content: "export function same() { return 1; }" },
    ]);
    const spec = draftSpec(graph, [
      graph.nodes.find((n) => n.label === "same")!.id,
    ]);
    const moved = await analyzeStructure([
      { path: "b.ts", content: "export function same() { return 1; }" },
    ]);
    expect(observeSpec(spec, moved).status).toBe("unchanged");
    expect(observeSpec(spec, moved).sources[0].path).toBe("b.ts");
    spec.content.desired = "같은 기능을 유지한다.";
    spec.content.acceptance = ["반환값은 1이다."];
    const request = prepareChange(spec, moved, "behavior")!;
    expect(request.scopePaths).toEqual(["b.ts"]);
    expect(request.sources.length).toBeGreaterThan(0);
    expect(request.sources.every((ref) => ref.path === "b.ts")).toBe(true);
    const ambiguous = await analyzeStructure(
      ["b.ts", "c.ts"].map((path) => ({
        path,
        content: "export function same() { return 1; }",
      })),
    );
    expect(observeSpec(spec, ambiguous).status).toBe("reconnect");
  });
  it("retains the baseline and enforces revisions on concurrent design edits", async () => {
    const graph = await analyzeStructure(fixture);
    const spec = draftSpec(graph, [
      graph.nodes.find((n) => n.label === "canEdit")!.id,
    ]);
    const document = saveSpec({ schemaVersion: 1, specs: [] }, spec, 0);
    expect(() => saveSpec(document, spec, 0)).toThrow(/他|다른 편집/);
    expect(() =>
      saveSpec(
        document,
        {
          ...document.specs[0],
          baseline: { ...spec.baseline, observed: "rewritten" },
        },
        1,
      ),
    ).toThrow(/기준선/);
    expect(() =>
      specDocumentSchema.parse({ ...document, command: "run this" }),
    ).toThrow();
  });
  it("creates a multi-file change contract only from an explicit behavioral action", async () => {
    const graph = await analyzeStructure(fixture);
    const targets = graph.nodes
      .filter(
        (n) =>
          ["canEdit", "update", "EditButton"].includes(n.label) &&
          n.kind === "symbol",
      )
      .map((n) => n.id);
    const spec = draftSpec(graph, targets);
    spec.content.desired = "멤버 역할에 따라 UI와 API 편집을 함께 제한한다.";
    spec.content.invariants = ["owner와 editor의 기존 편집 유지"];
    spec.content.acceptance = [
      "viewer API 직접 호출 거절",
      "viewer 화면의 편집 불가 표시",
    ];
    const change = prepareChange(spec, graph, "behavior")!;
    expect(change.scopePaths.sort()).toEqual([
      "src/api/update.ts",
      "src/sharing/policy.ts",
      "src/ui/EditButton.tsx",
      "src/ui/Page.tsx",
    ]);
    expect(change.invariants).toEqual(spec.content.invariants);
    expect(prepareChange(spec, graph, "documentation")).toBeUndefined();
  });
  it("expands a single policy to its API and UI callers without unrelated modules", async () => {
    const graph = await analyzeStructure([
      ...fixture,
      {
        path: "unrelated.ts",
        content: "export function canEdit() { return false; }",
      },
    ]);
    const target = graph.nodes.find(
      (n) =>
        n.kind === "symbol" &&
        n.label === "canEdit" &&
        n.sources[0].path.startsWith("src/"),
    )!;
    const spec = draftSpec(graph, [target.id]);
    spec.content.desired = "viewer 편집 거절";
    spec.content.acceptance = ["UI와 API에서 거절"];
    spec.content.policies = "권한은 프로젝트별로 판단";
    const request = prepareChange(spec, graph, "behavior")!;
    expect(request.scopePaths).toEqual([
      "src/api/update.ts",
      "src/sharing/policy.ts",
      "src/ui/EditButton.tsx",
      "src/ui/Page.tsx",
    ]);
    expect(request.content.policies).toBe(spec.content.policies);
  });
});
