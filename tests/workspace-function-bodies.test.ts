import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  captureObservations,
  compareObservations,
} from "../src/workspace/observations";
import { draftSpec, saveSpec } from "../src/workspace/spec";

const factory = {
  path: "wrapper.ts",
  content: `export function authenticated(action: (user: string) => string) {
    return (user: string) => {
      if (!user) throw new Error('Authentication required');
      return action(user);
    };
  }`,
};
async function graph(content: string) {
  return analyzeStructure([factory, { path: "actions.ts", content }]);
}
const named = (value: Awaited<ReturnType<typeof graph>>, name: string) =>
  value.nodes.find((node) => node.kind === "symbol" && node.label === name)!;

describe("function bodies in structure descriptions", () => {
  it("reads direct, parenthesized and asserted arrow/function expressions with stable identities and nested branches", async () => {
    const value =
      await graph(`export const direct = (role: string) => { if (role === 'owner') return 'saved'; else return 'denied'; };
      export const wrapped = ((role: string) => role === 'editor');
      export const expression = (function named(role: string) { return role; }) as (x: string) => string;
      export const opaque = (() => 'opaque-body') as unknown;
      export const alias = direct; export const count = 3;`);
    const direct = named(value, "direct");
    expect(direct.role).toBe("function");
    expect(direct.summary).toContain("받는 값: role");
    expect(direct.summary).toContain("saved");
    expect(direct.summary).toContain("그렇지 않으면");
    expect(direct.summary).toContain("denied");
    expect(named(value, "wrapped").summary).toContain("editor");
    expect(named(value, "expression").summary).toContain("결과로");
    expect(named(value, "opaque").role).toBe("function");
    expect(named(value, "opaque").summary).toContain("opaque-body");
    expect(named(value, "alias").role).toBe("function");
    expect(named(value, "alias").summary).toContain("원래 선언");
    expect(named(value, "count").role).toBe("data");
    const ref = direct.sources[0];
    expect(ref.symbol).toBe("direct");
    expect(direct.id).toBe("symbol:actions.ts:direct");
  });
  it("separates factory creation, passed callback and returned function bodies instead of assuming wrapper behavior", async () => {
    const value = await graph(`import {authenticated} from './wrapper';
      export const remove = authenticated((user) => {
        if (user === 'owner') return 'removed';
        return 'forbidden';
      });`);
    const action = named(value, "remove");
    expect(action.role).toBe("function");
    expect(action.summary).toContain("「authenticated」을(를) 호출한 결과");
    expect(action.summary).toContain("생성 호출과 이후 함수 실행은 별개");
    expect(action.summary).toContain("코드상 1번째 전달 항목");
    expect(action.summary).toContain("실행 시점·호출 횟수는 받는 쪽 구현");
    expect(action.summary).toContain("removed");
    expect(action.summary).toContain("forbidden");
    expect(action.summary).not.toContain("Authentication required");
    const wrapper = named(value, "authenticated");
    expect(wrapper.summary).toContain("반환하는 함수의 본문");
    expect(wrapper.summary).toContain("Authentication required");
    expect(wrapper.summary).toContain("action");
    expect(wrapper.summary).not.toContain("removed");
    expect(
      value.edges.some(
        (edge) =>
          edge.source === action.id &&
          edge.target === wrapper.id &&
          edge.kind === "calls",
      ),
    ).toBe(true);
  });
  it("retains unknown factory return types and does not flatten another function's deferred implementation", async () => {
    const value = await graph(`import {external} from 'missing-library';
      export const unknown = external((input: string) => {
        const later = () => { throw new Error('deferred-only'); };
        return 'callback-result';
      });
      export const nested = external(external((x: string) => 'inner-result'));
      export const curried = () => (x: string) => 'returned-result';`);
    expect(named(value, "unknown").role).toBe("data");
    const summary = named(value, "unknown").summary;
    expect(summary).toContain("반환값이 함수라고 단정하지 않습니다");
    expect(summary).toContain("callback-result");
    expect(summary).not.toContain("deferred-only");
    expect(named(value, "later").summary).toContain("deferred-only");
    expect(named(value, "nested").summary).toContain("inner-result");
    expect(named(value, "curried").summary).toContain("반환하는 함수의 본문");
    expect(named(value, "curried").summary).toContain("returned-result");
  });
  it("preserves try/catch/finally order and limits large summaries explicitly", async () => {
    const value = await graph(`export const guarded = () => {
      try { persist(); } catch { recover(); } finally { cleanup(); }
    };
    export const large = () => { ${Array.from({ length: 100 }, (_, i) => `step${i}();`).join("\n")} };`);
    const summary = named(value, "guarded").summary;
    const positions = [
      "persist",
      "오류가 나면",
      "recover",
      "finally",
      "cleanup",
    ].map((text) => summary.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const large = named(value, "large");
    expect(large.summary).toContain("남은 처리 설명은 원문");
    expect(large.summary.length).toBeLessThan(5600);
    expect(large.sources[0].end - large.sources[0].start).toBeGreaterThan(900);
  });
  it("keeps stored goals and old descriptions while detecting callback edits; comments and line shifts do not rewrite descriptions", async () => {
    const source = `import {authenticated} from './wrapper'; export const remove = authenticated((user) => { if (user === 'owner') return 'removed'; return 'forbidden'; });`;
    const before = await graph(source),
      action = named(before, "remove");
    const spec = draftSpec(before, [action.id]);
    spec.content.desired = "소유자만 구성원을 제거한다";
    const saved = saveSpec({ schemaVersion: 1, specs: [] }, spec, 0).specs[0];
    const shifted = await graph("// comment\n\n" + source);
    expect(named(shifted, "remove").summary).toBe(action.summary);
    expect(named(shifted, "remove").id).toBe(action.id);
    const after = await graph(source.replace("'owner'", "'member'"));
    const comparison = compareObservations(
      saved.baseline.observations!,
      captureObservations(after, [action.id]),
    );
    expect(
      comparison.facts.find((fact) => fact.current?.id === action.id)?.status,
    ).toBe("changed");
    expect(saved.content.desired).toBe("소유자만 구성원을 제거한다");
    expect(saved.baseline.observed).toContain("owner");
    expect(named(after, "remove").summary).toContain("member");
  });
});
