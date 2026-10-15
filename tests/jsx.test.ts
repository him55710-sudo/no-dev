import { describe, expect, it } from "vitest";
import { analyzeFile } from "../src/core/analyze";
import { applyPatch, makePatch } from "../src/core/edit";
import type { InterfaceNode } from "../src/core/types";
import { interfaceDemo } from "../src/interfaceDemo";

const file = (content: string) => ({ path: "src/Screen.tsx", content });
const flat = (nodes: InterfaceNode[]): InterfaceNode[] =>
  nodes.flatMap((n) => [n, ...flat(n.children)]);
const read = (content: string) => analyzeFile(file(content));
const nodes = (content: string) => flat(read(content).interface?.roots || []);

describe("source-grounded JSX reading", () => {
  it("explains a real example, conditional branches and map callback without executing it", () => {
    const analysis = analyzeFile(interfaceDemo[0]);
    const tree = flat(analysis.interface!.roots);
    expect(analysis.interface!.roots).toHaveLength(1);
    expect(tree.some((n) => n.kind === "condition")).toBe(true);
    expect(tree.some((n) => n.kind === "iteration")).toBe(true);
    expect(tree.some((n) => n.code === "<button>")).toBe(true);
    expect(analysis.rules.some((r) => r.value === "무료로 시작하기")).toBe(
      true,
    );
    expect(
      analysis.functions.find((f) => f.name === "SignupCard")?.simulatable,
    ).toBe(false);
  });
  it("preserves outer conditional structure instead of showing two unconditional roots", () => {
    const a = read(
      "const Screen = () => ready ? <main>Yes</main> : <aside>No</aside>;",
    );
    expect(a.interface!.roots).toHaveLength(1);
    expect(a.interface!.roots[0].kind).toBe("condition");
    expect(a.interface!.roots[0].children.map((n) => n.title.en)).toEqual([
      "When truthy",
      "When falsy",
    ]);
  });
  it("explains falsy values, including a visible 0, and nullish fallback", () => {
    const tree = nodes(
      "const Screen = () => <>{count && <b>Count</b>}{title ?? <i>Untitled</i>}{title || <i>Fallback</i>}</>;",
    );
    const conditions = tree.filter((n) => n.kind === "condition");
    expect(conditions).toHaveLength(3);
    expect(conditions[0].detail?.en).toContain("numeric 0");
    expect(conditions[1].detail?.en).toContain("null or undefined");
    expect(conditions[2].detail?.en).toContain("falsy");
  });
  it("distinguishes a render-time call, function value, and callback", () => {
    const tree = nodes(
      "const Screen=()=> <><button onClick={submit()}/><button onClick={submit}/><button onClick={()=>submit()}/></>;",
    );
    const props = tree.filter((n) => n.title.en === "Event prop onClick");
    expect(props[0].detail?.en).toContain("while constructing JSX");
    expect(props[1].detail?.en).toContain("Passes this value");
    expect(props[2].detail?.en).toContain("body runs when called");
  });
  it("does not claim custom props are native events or infer spread values", () => {
    const tree = nodes(
      "const Screen = () => <Checkout onClick={submit} {...config}>Child</Checkout>;",
    );
    expect(tree[0].kind).toBe("component");
    expect(tree[0].detail?.en).toContain("component definition");
    expect(tree.some((n) => n.title.en === "Component prop onClick")).toBe(
      true,
    );
    expect(
      tree.find((n) => n.title.en === "Spread props")?.detail?.en,
    ).toContain("override");
  });
  it("marks a truncated structure and bounds output for a large file", () => {
    const a = read(
      `const Screen=()=> <div>${"<p>Text</p>".repeat(1000)}</div>;`,
    );
    expect(a.interface?.truncated).toBe(true);
    expect(flat(a.interface!.roots).length).toBeLessThanOrEqual(303);
    expect(a.rules.length).toBeLessThan(151);
  });
  it("does not add an interface to ordinary TypeScript", () => {
    expect(
      analyzeFile({ path: "plain.ts", content: "export const size = 4;" })
        .interface,
    ).toBeUndefined();
  });
  it("keeps complex map bodies explicit and recognizes wrapped render-time calls", () => {
    const tree = nodes(
      "const Screen=()=> <>{items.map(item => { if(item) return <p>Hi</p>; return null; })}<button onClick={(submit())}/></>;",
    );
    expect(
      tree.some((n) => n.kind === "unknown" && n.title.en.includes("source")),
    ).toBe(true);
    expect(
      tree.find((n) => n.title.en === "Event prop onClick")?.detail?.en,
    ).toContain("while constructing JSX");
  });
});

describe("JSX literal editing", () => {
  it("decodes entities and multiline JSX whitespace using compiler semantics", () => {
    const a = read(
      'const Screen=()=> <p>  A &amp; B\n  hello <b title="A &quot; B &#x1F30D;">&lt;Hi&gt;&nbsp;</b></p>;',
    );
    expect(a.rules.map((r) => r.value)).toEqual([
      "  A & B hello ",
      'A " B 🌍',
      "<Hi>\u00a0",
    ]);
  });
  it("replaces the entire JSX text including significant leading spaces", () => {
    const source = file("const Screen = () => <p>  Hello <b>world</b> !</p>;");
    const rule = analyzeFile(source).rules.find((r) => r.value === "  Hello ")!;
    expect(source.content.slice(rule.start, rule.end)).toBe("  Hello ");
    const patch = makePatch(source, rule.id, "Goodbye ");
    expect(patch.updated).toBe(
      'const Screen = () => <p>{"Goodbye "}<b>world</b> !</p>;',
    );
    const next = analyzeFile(applyPatch(source, patch));
    expect(next.rules.map((r) => r.value)).toEqual(["Goodbye ", "world", " !"]);
  });
  it("treats markup, expressions, quotes and newlines as inert string data", () => {
    const source = file("const Screen=()=> <button>Join</button>;");
    const input = '</button><img src=x onError={steal()}> & "\n{run()}';
    const rule = analyzeFile(source).rules[0];
    const patch = makePatch(source, rule.id, input);
    const updated = analyzeFile({ ...source, content: patch.updated });
    expect(updated.syntaxValid).toBe(true);
    expect(updated.rules[0].value).toBe(input);
    expect(
      flat(updated.interface!.roots).filter((n) => n.kind === "element"),
    ).toHaveLength(1);
    expect(patch.updated).toBe(
      `const Screen=()=> <button>{${JSON.stringify(input)}}</button>;`,
    );
  });
  it("edits quoted attributes and allows editing them a second time", () => {
    const source = file(
      'const Screen=()=> <input placeholder="Name &amp; surname"/>;',
    );
    const rule = analyzeFile(source).rules[0];
    expect(rule.value).toBe("Name & surname");
    const first = applyPatch(
      source,
      makePatch(source, rule.id, 'Your "name" <please>'),
    );
    expect(first.content).toBe(
      'const Screen=()=> <input placeholder={"Your \\"name\\" <please>"}/>;'.replaceAll(
        "\\\\",
        "\\",
      ),
    );
    const secondRule = analyzeFile(first).rules[0];
    const second = applyPatch(
      first,
      makePatch(first, secondRule.id, "Full name"),
    );
    expect(second.content).toBe(
      'const Screen=()=> <input placeholder={"Full name"}/>;',
    );
  });
  it("rejects unchanged values without rewriting JSX entities", () => {
    const source = file("const Screen=()=> <p>A &amp; B</p>;");
    expect(() =>
      makePatch(source, analyzeFile(source).rules[0].id, "A & B"),
    ).toThrow("No change");
  });
  it("preserves CRLF outside the precise text range and keeps stale-patch protection", () => {
    const source = file("const Screen = () => (\r\n  <p>Before</p>\r\n);");
    const patch = makePatch(source, analyzeFile(source).rules[0].id, "After");
    expect(patch.updated).toBe(
      'const Screen = () => (\r\n  <p>{"After"}</p>\r\n);',
    );
    expect(() =>
      applyPatch({ ...source, content: source.content + " " }, patch),
    ).toThrow("Stale patch");
  });
});
