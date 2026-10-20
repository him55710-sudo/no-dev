import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import { structureConnections } from "../src/workspace/model";
import {
  draftSpec,
  prepareChange,
  saveSpec,
  specDocumentSchema,
  observeSpec,
  currentObservations,
} from "../src/workspace/spec";
import {
  captureObservations,
  compareObservations,
} from "../src/workspace/observations";

const files = [
  {
    path: "tsconfig.json",
    content:
      '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]},"jsx":"preserve"}}',
  },
  {
    path: "src/policy.ts",
    content:
      'export function allowed(role: string) { return role === "owner"; }',
  },
  {
    path: "src/actions.ts",
    content: `import { allowed } from './policy';
function validated(action: (role: string) => boolean) { return async (role: string) => action(role); }
export const removeMember = validated(role => allowed(role));
export async function inviteMember(role: string) { return allowed(role); }
export const count = 3;`,
  },
  {
    path: "src/index.ts",
    content:
      "export { removeMember as remove, inviteMember, count } from './actions';",
  },
  {
    path: "src/Page.tsx",
    content: `import { useActionState } from 'react';
import { remove as deleteMember, inviteMember, count } from '@/index';
export function Page() {
  useActionState((deleteMember), {});
  useActionState(deleteMember!, {});
  useActionState(count, {});
  return <form action={inviteMember}><button onClick={inviteMember}>Save</button></form>;
}`,
  },
  {
    path: "unrelated.ts",
    content: "export function inviteMember() { return false; }",
  },
];

describe("compiler-backed function passing", () => {
  it("connects aliased hook callbacks and JSX actions to their implementation without claiming a direct call", async () => {
    const graph = await analyzeStructure(files);
    const page = graph.nodes.find(
      (n) => n.kind === "symbol" && n.label === "Page",
    )!;
    const passes = graph.edges.filter(
      (e) => e.source === page.id && e.kind === "passes",
    );
    expect(passes).toHaveLength(2);
    expect(
      passes
        .map((e) => graph.nodes.find((n) => n.id === e.target)!.label)
        .sort(),
    ).toEqual(["inviteMember", "removeMember"]);
    for (const edge of passes) {
      const target = graph.nodes.find((n) => n.id === edge.target)!;
      expect(target.sources[0].path).toBe("src/actions.ts");
      expect(edge.sources).toHaveLength(2);
      expect(edge.evidence).toBe("compiler");
      expect(
        graph.edges.some(
          (e) =>
            e.source === page.id &&
            e.target === edge.target &&
            e.kind === "calls",
        ),
      ).toBe(false);
      for (const ref of edge.sources) {
        expect(ref.path).toBe("src/Page.tsx");
        const text = files
          .find((f) => f.path === ref.path)!
          .content.slice(ref.start, ref.end);
        expect(text).toMatch(
          /^(?:\(deleteMember\)|deleteMember!|inviteMember)$/,
        );
        expect(ref.fileHash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
    const spec = draftSpec(graph, [page.id]);
    spec.content.desired = "member의 변경을 화면과 서버에서 함께 거절";
    spec.content.acceptance = ["서버 직접 호출도 거절"];
    const request = prepareChange(spec, graph, "behavior")!;
    expect(request.scopePaths).toEqual([
      "src/Page.tsx",
      "src/actions.ts",
      "src/policy.ts",
    ]);
    expect(request.sources.some((ref) => ref.path === "src/actions.ts")).toBe(
      true,
    );
    const displayed = structureConnections(graph, [
      page,
      ...passes.map((e) => graph.nodes.find((n) => n.id === e.target)!),
    ]);
    expect(displayed.every((e) => e.label === "함수 전달")).toBe(true);
    expect(displayed.flatMap((e) => e.data.originals).sort()).toEqual(
      passes.map((e) => e.id).sort(),
    );
  });

  it("retains callback evidence through save, old-snapshot comparison and changed callback targets", async () => {
    const graph = await analyzeStructure(files);
    const page = graph.nodes.find(
      (n) => n.kind === "symbol" && n.label === "Page",
    )!;
    const spec = draftSpec(graph, [page.id]);
    spec.content.desired = "owner만 구성원 변경";
    spec.content.acceptance = ["member 거절"];
    const saved = saveSpec({ schemaVersion: 1, specs: [] }, spec, 0);
    const stored = specDocumentSchema.parse(JSON.parse(JSON.stringify(saved)));
    expect(
      stored.specs[0].baseline.observations!.relations.filter(
        (r) => r.kind === "passes",
      ),
    ).toHaveLength(2);
    const current = captureObservations(graph, [page.id]);
    const legacy = {
      ...current,
      relations: current.relations.filter((r) => r.kind !== "passes"),
    };
    const added = compareObservations(legacy, current).relations.filter(
      (r) => r.status === "added",
    );
    expect(added.every((r) => r.current!.kind === "passes")).toBe(true);
    expect(added).toHaveLength(2);
    const changed = await analyzeStructure(
      files.map((f) =>
        f.path === "src/Page.tsx"
          ? {
              ...f,
              content: f.content.replace(
                /useActionState\(\(?deleteMember\)?!?/g,
                "useActionState(inviteMember",
              ),
            }
          : f,
      ),
    );
    expect(observeSpec(stored.specs[0], changed).status).toBe("changed");
    expect(
      compareObservations(
        current,
        currentObservations(stored.specs[0], changed),
      ).relations.some((r) => r.status !== "unchanged"),
    ).toBe(true);
    expect(stored.specs[0].content.desired).toBe("owner만 구성원 변경");
    expect(() => prepareChange(stored.specs[0], changed, "behavior")).toThrow(
      /기준/,
    );
  });

  it("keeps ordinary call results separate and reports unresolved function values instead of guessing by name", async () => {
    const graph = await analyzeStructure([
      { path: "other.ts", content: "export function handler() { return 1; }" },
      {
        path: "page.tsx",
        content: `declare function send(value: unknown): void;
function data() { return 1; }
function first() { return 1; }
function second() { return 2; }
export function Page(handler: () => void, ready: boolean) {
  send(handler);
  send(ready ? first : second);
  send(data());
  send('handler');
  send(42 as unknown as (() => void));
  return <button onClick={handler} />;
}`,
      },
    ]);
    expect(graph.edges.filter((e) => e.kind === "passes")).toEqual([]);
    const data = graph.nodes.find((n) => n.label === "data")!;
    expect(
      graph.edges.some((e) => e.target === data.id && e.kind === "calls"),
    ).toBe(true);
    expect(
      graph.notices.filter((n) => n.message.includes("전달된 함수 값")),
    ).toHaveLength(3);
    expect(
      graph.edges.every(
        (e) =>
          graph.nodes.find((n) => n.id === e.target)!.sources[0].path !==
          "other.ts",
      ),
    ).toBe(true);
  });
});
