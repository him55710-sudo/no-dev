import { describe, it, expect } from "vitest";
import { simulate } from "../src/core/simulate";
import { analyzeFile } from "../src/core/analyze";
import { parseRequest } from "../src/core/edit";
import { particle } from "../src/core/labels";
const run = (content: string, args: unknown[] = []) =>
  simulate([{ path: "a.ts", content }], "a.ts", "f", args);
describe("no invented preview results", () => {
  it("uses module scope for constant initializers", () =>
    expect(
      run("const x=1;const y=x;function f(x){return y}", [99]).result,
    ).toBe(1));
  it("rejects temporal dead zone reads instead of using outer values", () => {
    expect(run("const x=1;function f(){const x=x;return x}").ok).toBe(false);
    expect(run("const b=1;function f(a=b,b=2){return a}").ok).toBe(false);
  });
  it("rejects mutable module state and top-level effects", () => {
    expect(run("let x=1;function f(){return x}").ok).toBe(false);
    expect(run("const x=[1];x.push(2);function f(){return x.length}").ok).toBe(
      false,
    );
    expect(run('const x=fetch("url");function f(){return 1}').ok).toBe(false);
  });
  it("rejects var scope it cannot faithfully simulate", () =>
    expect(run("function f(){var x=1;if(true){var x=2;}return x}").ok).toBe(
      false,
    ));
  it("does not use a global function when a parameter shadows it", () =>
    expect(
      run("function g(){return 1}function f(g){return g()}", [null]).ok,
    ).toBe(false));
  it("does not use native Math when shadowed", () => {
    expect(run("const Math={};function f(){return Math.round(2)}").ok).toBe(
      false,
    );
    expect(run("function f(Math){return Math.round(2)}", [{}]).ok).toBe(false);
  });
  it("does not reach inherited Math properties", () =>
    expect(run("function f(){return Math.constructor(2)}").ok).toBe(false));
  it("rejects imports of non-exported values", () =>
    expect(
      simulate(
        [
          {
            path: "a.ts",
            content: 'import {x} from "./b";function f(){return x}',
          },
          { path: "b.ts", content: "const x=1;" },
        ],
        "a.ts",
        "f",
        [],
      ).ok,
    ).toBe(false));
  it("refuses unsupported initialization in imported modules", () =>
    expect(
      simulate(
        [
          {
            path: "a.ts",
            content: 'import {g} from "./b";function f(){return g()}',
          },
          {
            path: "b.ts",
            content: 'console.log("side effect");export function g(){return 1}',
          },
        ],
        "a.ts",
        "f",
        [],
      ).ok,
    ).toBe(false));
  it("retains Infinity as a number, not null", () =>
    expect(run("function f(){return 1/0}").result).toBe(Infinity));
});
describe("Korean editing and readability", () => {
  it("handles disabling without confusing the affirmative word", () => {
    const rules = analyzeFile({
      path: "a.ts",
      content: "const enabled=true;",
    }).rules;
    expect(parseRequest("사용 여부 비활성화", rules).value).toBe("false");
  });
  it("matches >= as one operator", () => {
    const rules = analyzeFile({
      path: "a.ts",
      content: "function f(price){return price>5;}",
    }).rules;
    expect(parseRequest("가격 비교 방식을 >= 로 변경", rules).value).toBe(">=");
  });
  it("uses correct Korean particles for common labels and numbers", () => {
    expect(particle("상품 합계")).toBe("상품 합계가");
    expect(particle("기본 배송비", "object")).toBe("기본 배송비를");
    expect(particle("0", "object")).toBe("0을");
    expect(particle("2", "object")).toBe("2를");
  });
});
