import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  captureObservations,
  compareObservations,
  observationSnapshotSchema,
} from "../src/workspace/observations";
import { draftSpec, saveSpec } from "../src/workspace/spec";

const target = {
  path: "actions.ts",
  content:
    "export function save(user: string, count = 1, ...rest: unknown[]) { return count; }",
};
async function fixture(content: string) {
  return analyzeStructure([
    target,
    {
      path: "page.tsx",
      content: `import {save} from './actions';\n${content}`,
    },
  ]);
}
function calls(graph: Awaited<ReturnType<typeof fixture>>, owner: string) {
  const from = graph.nodes.find(
    (node) => node.kind === "symbol" && node.label === owner,
  )!;
  const to = graph.nodes.find(
    (node) => node.kind === "symbol" && node.label === "save",
  )!;
  return graph.edges.find(
    (edge) =>
      edge.source === from.id && edge.target === to.id && edge.kind === "calls",
  )!;
}
describe("connection occurrence evidence", () => {
  it("keeps each call's arguments, branches and nearby catch separate with exact source locations", async () => {
    const body = `export async function run(ready: boolean, user: string) {
  if (ready) {
    try { await save(user, 2); }
    catch (error) { return 'failed'; }
  } else { save('guest', 0); }
  return save(user);
}`;
    const graph = await fixture(body),
      edge = calls(graph, "run");
    expect(edge.sites).toHaveLength(3);
    expect(edge.sources).toHaveLength(3);
    expect(edge.sites![0].inputs.map((input) => input.code)).toEqual([
      "user",
      "2",
    ]);
    expect(edge.sites![0].inputs[0].label).toBe("1번째 인수 → user");
    expect(edge.sites![0].result).toContain("await");
    expect(edge.sites![0].contexts.map((context) => context.code)).toEqual([
      "ready",
      "catch (error) { return 'failed'; }",
    ]);
    expect(edge.sites![1].contexts[0].description).toContain("else");
    expect(edge.sites![1].inputs[0].description).toContain("guest");
    expect(edge.sites![2].contexts).toEqual([]);
    expect(edge.sites![2].result).toContain("반환");
    const content = `import {save} from './actions';\n${body}`;
    edge.sources.forEach((ref, index) => {
      expect(content.slice(ref.start, ref.end)).toBe(edge.sites![index].code);
      expect(ref.path).toBe("page.tsx");
    });
    expect(edge.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not inherit an outer creation condition into a deferred function and describes short-circuit and loop syntax", async () => {
    const graph =
      await fixture(`export function run(ready: boolean, user: string) {
      if (ready) { const later = () => save(user); }
      ready && save('and'); ready || save('or'); user ?? save('nullish');
      while (ready) { save('while'); }
      do { save('do'); } while (ready);
      const optional: undefined | ((x: number) => number) = undefined;
      optional?.(save('argument'));
    }`);
    expect(calls(graph, "later").sites![0].contexts).toEqual([]);
    const descriptions = calls(graph, "run").sites!.map((site) =>
      site.contexts.map((context) => context.description).join(" "),
    );
    expect(descriptions[0]).toContain("&&");
    expect(descriptions[1]).toContain("||");
    expect(descriptions[2]).toContain("null 또는 undefined");
    expect(descriptions[3]).toContain("반복문");
    expect(descriptions[4]).toContain("첫 실행");
    expect(descriptions[5]).toContain("바깥 호출을 건너뛰면");
  });
  it("distinguishes callback registration, JSX props and spreads without inventing parameter positions", async () => {
    const graph =
      await fixture(`declare function register(fn: unknown, initial: unknown): void;
    function Card(props: unknown) { return null; }
    export function Page(values: any, props: any) {
      register(save, {}); save(...values, 'after');
      return <Card action={save} role="viewer" enabled {...props} />;
    }`);
    const page = graph.nodes.find((node) => node.label === "Page")!;
    const passing = graph.edges.find(
      (edge) => edge.source === page.id && edge.kind === "passes",
    )!;
    expect(passing.sites!.map((site) => site.summary)).toEqual([
      "register의 1번째 인수로 함수 값을 넘깁니다.",
      "action 화면 속성으로 함수 값을 넘깁니다.",
    ]);
    const rendered = graph.edges.find(
      (edge) => edge.source === page.id && edge.kind === "renders",
    )!;
    expect(rendered.sites![0].inputs.map((input) => input.label)).toEqual([
      "action",
      "role",
      "enabled",
      "펼쳐 전달하는 속성",
    ]);
    expect(rendered.sites![0].inputs[2].code).toBe("true");
    const spread = calls(graph, "Page").sites![0].inputs;
    expect(spread[0].description).toContain("실제 개수");
    expect(spread[1].label).toBe("코드상 2번째 전달 항목");
  });
  it("detects changed arguments at the second occurrence and guards, but ignores comments and line shifts", async () => {
    const body =
      "export function run(ready: boolean) { save('first'); if (ready) save('second'); }";
    const graph = await fixture(body);
    const spec = draftSpec(graph, [
      graph.nodes.find((node) => node.label === "run")!.id,
    ]);
    spec.content.desired = "소유자만 저장";
    const saved = saveSpec({ schemaVersion: 1, specs: [] }, spec, 0);
    const before = saved.specs[0].baseline.observations!;
    for (const content of [
      body.replace("'second'", "'changed'"),
      body.replace("if (ready)", "if (!ready)"),
    ]) {
      const changed = await fixture(content);
      const result = compareObservations(
        before,
        captureObservations(changed, spec.targetIds),
      );
      expect(
        result.relations.find((item) => item.current?.kind === "calls")?.status,
      ).toBe("changed");
    }
    const shifted = await fixture(
      "// new comment\n\n" +
        body.replace("save('first')", "save(/* comment */ 'first')"),
    );
    expect(calls(shifted, "run").evidenceHash).toBe(
      calls(graph, "run").evidenceHash,
    );
    expect(saved.specs[0].content.desired).toBe("소유자만 저장");
    const calleeChanged = await analyzeStructure([
      {
        ...target,
        content: target.content.replace("return count", "return count + 1"),
      },
      { path: "page.tsx", content: `import {save} from './actions';\n${body}` },
    ]);
    expect(calls(calleeChanged, "run").evidenceHash).toBe(
      calls(graph, "run").evidenceHash,
    );
    const legacy = observationSnapshotSchema.parse({
      ...before,
      relations: before.relations.map(
        ({ evidenceHash, ...relation }) => relation,
      ),
    });
    expect(
      compareObservations(legacy, before).relations.every(
        (item) => item.status === "unverified",
      ),
    ).toBe(true);
    const duplicate = captureObservations(
      { ...graph, edges: [...graph.edges, calls(graph, "run")] },
      spec.targetIds,
    );
    expect(
      duplicate.relations.find((relation) => relation.kind === "calls")
        ?.evidenceHash,
    ).toBeUndefined();
  });
  it("describes switch fallthrough, catch without a binding, result storage and callbacks after spreads accurately", async () => {
    const graph =
      await fixture(`declare function register(...args: unknown[]): void;
    export function run(mode: number, values: any) {
      const outcome = save('stored');
      switch (mode) {
        case save('test'): save('case');
        default: save('default');
      }
      try { save('try'); } catch { save('catch'); } finally { save('finally'); }
      register(...values, save);
    }`);
    expect(calls(graph, "outcome").sites![0].result).toContain(
      "outcome에 담습니다",
    );
    const sites = calls(graph, "run").sites!;
    expect(sites[0].contexts.map((context) => context.code)).toEqual([
      "mode",
      "save('test')",
    ]);
    expect(sites[0].contexts[1].description).toContain("비교 값을 계산");
    expect(sites[1].contexts[1].description).toContain("앞 case에서 내려오는");
    expect(sites[2].contexts[1].description).toContain("default");
    expect(
      sites[3].contexts.map((context) => context.description).join(" "),
    ).toContain("finally");
    expect(sites[4].contexts[0].description).toContain("catch 처리 안");
    expect(sites[5].contexts[0].description).toContain("finally 처리 블록");
    const passing = graph.edges.find((edge) => edge.kind === "passes")!;
    expect(passing.sites![0].summary).toContain("실제 인수 위치는 별도 확인");
  });
  it("hashes full evidence while bounding displayed input and context excerpts", async () => {
    const long = "x".repeat(600);
    const body = `export function run() { if ('${long}a') save('first'); save(${Array.from({ length: 15 }, (_, i) => `'${i}'`).join(",")}); }`;
    const graph = await fixture(body),
      edge = calls(graph, "run");
    expect(edge.sites![0].contexts[0].code.length).toBe(241);
    expect(edge.sites![1].inputs).toHaveLength(12);
    expect(edge.sites![1].omittedInputs).toBe(3);
    const changed = await fixture(body.replace(long + "a", long + "b"));
    expect(edge.sites![0].contexts[0].code).toBe(
      calls(changed, "run").sites![0].contexts[0].code,
    );
    expect(edge.evidenceHash).not.toBe(calls(changed, "run").evidenceHash);
  });
});
