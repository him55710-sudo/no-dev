import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  decodeRustString,
  makeRustPatch,
  parseRust,
  readRustTree,
  RUST_LIMITS,
} from "../src/core/rustSource";
import type { Step } from "../src/core/types";
import { parseRequest } from "../src/core/ruleRequest";
const require = createRequire(import.meta.url);
let parser: Parser;
beforeAll(async () => {
  await Parser.init({
    wasmBinary: await readFile(
      require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    ),
  });
  parser = new Parser();
  parser.setLanguage(
    await Language.load(
      await readFile("extension/runtime/rust/tree-sitter-rust.wasm"),
    ),
  );
});
afterAll(() => parser?.delete());
const file = (content: string) => ({ path: "sample.rs", content });
function read(content: string) {
  const tree = parseRust(parser, content);
  try {
    return readRustTree(file(content), tree);
  } finally {
    tree.delete();
  }
}
const flat = (steps: Step[]): Step[] =>
  steps.flatMap((s) => [
    s,
    ...flat(s.children),
    ...flat(s.otherwise || []),
    ...flat(s.branches?.flatMap((b) => b.steps) || []),
  ]);

describe("bundled Rust source reader", () => {
  it("extracts one exact Rust numeric spelling from Korean and English requests", () => {
    const rules = read("const LIMIT:u64=10;").rules;
    for (const value of [
      "9007199254740993u64",
      "-0x80i64",
      "0b10usize",
      "1.25e-3f64",
    ]) {
      expect(
        parseRequest(`change ${rules[0].name} to ${value}`, rules).value,
      ).toBe(value);
      expect(
        parseRequest(`${rules[0].name}을 ${value}으로 변경`, rules).value,
      ).toBe(value);
    }
    expect(() =>
      parseRequest(`change ${rules[0].name} to 1u64 or 2u64`, rules),
    ).toThrow();
  });
  it("anchors UTF-16 source with BOM, emoji, CRLF and huge suffixed integers", () => {
    const source =
      '\uFEFF// 😀 한글\r\nconst LIMIT:u64 = 9007199254740993u64;\r\nfn label()->&\'static str { "한글😀" }';
    const a = read(source);
    expect(a.syntaxValid).toBe(true);
    expect(a.rules.map((r) => r.value)).toEqual([
      "9007199254740993u64",
      "한글😀",
    ]);
    expect(a.rules[0].line).toBe(2);
    for (const n of [...a.rules, ...a.functions, ...flat(a.functions[0].steps)])
      expect(source.slice(n.start, n.end).length).toBeGreaterThan(0);
    for (const r of a.rules) expect(source.slice(r.start, r.end)).toBe(r.raw);
    const p = makeRustPatch(
      file(source),
      parser,
      a.rules[0].id,
      "9007199254740995u64",
    );
    expect(p.updated).toBe(
      source.replace("9007199254740993u64", "9007199254740995u64"),
    );
    expect(p.semanticChecked).toBe(false);
  });
  it("tracks physical CR-only lines without relying on parser row coordinates", () => {
    const a = read("const A:u8=1;\rconst B:u8=2;\rfn f(){true}");
    expect(a.rules.map((r) => r.line)).toEqual([1, 2, 3]);
  });
  it("reads functions, impl methods, trait defaults, parameters and async modifiers", () => {
    const a = read(
      "mod nested { pub async fn load((a,b):(u8,u8))->u8 { a+b } } struct S; impl S { fn get(&self, n:i32)->i32 { n } } trait T { fn missing(); fn default(&self)->bool { true } }",
    );
    expect(a.functions.map((f) => f.name)).toEqual([
      "nested::load",
      "S::get",
      "T::default",
    ]);
    expect(a.functions[0].async).toBe(true);
    expect(a.functions[0].params[0]).toMatchObject({
      name: "(a,b)",
      type: "(u8,u8)",
    });
    expect(a.functions.every((f) => !f.simulatable)).toBe(true);
    expect(a.functions[1].steps[0].text.en).toContain("Final expression");
  });
  it("keeps if/else-if and match patterns, guards and every arm", () => {
    const a = read(
      "fn check(x:i32)->i32 { if x<0 { return -1; } else if x==0 { return 0; } else { log(x); } match x { n if n>10 => 10, 1|2 => 2, _ => {3} } }",
    );
    const all = flat(a.functions[0].steps);
    expect(all.filter((s) => s.kind === "if_expression")).toHaveLength(2);
    const match = all.find((s) => s.kind === "match_expression")!;
    expect(match.branches).toHaveLength(3);
    expect(match.text.en).toContain("Final expression");
    expect(match.branches![0].label.en).toContain("n if n>10");
    expect(match.branches![2].label.en).toContain("_");
    expect(a.rules.some((r) => r.raw === "-1")).toBe(true);
  });
  it("describes loops, early propagation, closures, async and let-else conservatively", () => {
    const a = read(
      "fn go(v:Option<i32>) { let Some(n)=v else { return; }; for x in 0..3 { if x>1 { break; } } while ready() {continue;} loop {break 5;} let f=|x:i32| x+1; let value=read()?; let future=async {run().await}; }",
    );
    const texts = flat(a.functions[0].steps)
      .map((s) => s.text.en)
      .join("\n");
    expect(texts).toContain("let pattern binding");
    expect(texts).toContain("Iterate 0..3");
    expect(texts).toContain("Repeat while");
    expect(texts).toContain("Closure value");
    expect(texts).toContain("Execution timing depends");
    expect(texts).toContain("Depending on value and type");
    expect(texts).toContain("Async block value");
  });
  it("never treats opaque macros, attributes, chars, byte or C strings as editable strings", () => {
    const a = read(
      '#[cfg(any(feature="x",feature="y"))] fn f(){ println!("{}",99); unknown!(???); let b=b"bytes"; let c=c"ffi"; let r=br#"raw bytes"#; let ch=\'x\'; let ordinary="ok"; } macro_rules! m {()=>{77}}',
    );
    expect(a.syntaxValid).toBe(true);
    expect(a.rules.map((r) => r.value)).toEqual(["ok"]);
    expect(
      flat(a.functions[0].steps)
        .filter((s) => s.kind === "macro_invocation")
        .every((s) => !s.supported),
    ).toBe(true);
    expect(a.issues[0].detail.en).toContain("macro expansion");
  });
  it("reports syntax errors and withholds recovered-tree edits", () => {
    for (const source of [
      "fn bad( { let x = ;",
      "fn f(){let x=1;",
      "fn f(){ let x = 1 }",
    ]) {
      const a = read(source);
      expect(a.syntaxValid).toBe(false);
      expect(a.rules).toEqual([]);
      expect(a.functions).toEqual([]);
      expect(a.issues[0].level).toBe("error");
      expect(() =>
        makeRustPatch(file(source), parser, "rust:0", "2"),
      ).toThrow();
    }
  });
  it("does not misrepresent type or macro checks as compiler success", () => {
    const a = read(
      "fn wrong()->bool { 123 } fn f(){ nonsense!(not rust ???); }",
    );
    expect(a.syntaxValid).toBe(true);
    expect(a.issues[0].detail.en).toContain("types, ownership");
    expect(a.issues[0].detail.en).toContain("unchecked");
  });
  it("decodes Rust escapes and continuation without JavaScript escape assumptions", () => {
    expect(
      decodeRustString('"\\u{1f600}\\u{D55C}\\x41\\n\\t\\0\\\\\\\""'),
    ).toBe('😀한A\n\t\0\\"');
    expect(decodeRustString('"first\\\r\n   second"')).toBe("firstsecond");
    expect(decodeRustString('"\\u{d800}"')).toBeUndefined();
    expect(decodeRustString('"\\x80"')).toBeUndefined();
    expect(decodeRustString('b"bytes"')).toBeUndefined();
  });
  it("round-trips plain strings, control characters, quotes and Unicode", () => {
    const source = 'fn f(){ let text="old"; }',
      rule = read(source).rules[0];
    for (const value of ["새 이름😀", 'quote " \\ newline\n\r\t\0\u0001', ""]) {
      const p = makeRustPatch(file(source), parser, rule.id, value);
      expect(read(p.updated).rules[0].value).toBe(value);
      expect(p.updated.slice(p.start + p.newText.length)).toBe(
        source.slice(rule.end),
      );
    }
    expect(() =>
      makeRustPatch(file(source), parser, rule.id, "\ud800"),
    ).toThrow(/Unicode/);
  });
  it("preserves raw-string form and grows delimiters when necessary", () => {
    const source = 'fn f(){let text=r#"old"#;}',
      rule = read(source).rules[0];
    const p = makeRustPatch(
      file(source),
      parser,
      rule.id,
      'quote "# then "## end 😀',
    );
    expect(p.newText).toBe('r###"quote "# then "## end 😀"###');
    expect(read(p.updated).rules[0].value).toBe('quote "# then "## end 😀');
    const cr = makeRustPatch(file(source), parser, rule.id, "a\r\nb");
    expect(cr.newText.startsWith('"')).toBe(true);
    expect(read(cr.updated).rules[0].value).toBe("a\r\nb");
  });
  it("accepts one numeric literal while rejecting injected statements, comments and expressions", () => {
    const source = "fn f()->i64 {-1}",
      rule = read(source).rules[0];
    for (const value of [
      "-0x80i64",
      "9_007_199_254_740_993u128",
      "1.25e-3f64",
      "0b1010",
      "- 2",
    ]) {
      const p = makeRustPatch(file(source), parser, rule.id, value);
      expect(p.updated).toBe(`fn f()->i64 {${value}}`);
    }
    for (const value of [
      "1; dangerous(); const X:()=1",
      "1 + 2",
      "1/* hi */",
      "/*hi*/1",
      "NaN",
      '"1"',
      "-/*hi*/1",
      "",
    ])
      expect(
        () => makeRustPatch(file(source), parser, rule.id, value),
        value,
      ).toThrow();
  });
  it("requires exact boolean and current rule and bounds source and value sizes", () => {
    const source = "fn f()->bool{true}",
      rule = read(source).rules[0];
    expect(
      read(makeRustPatch(file(source), parser, rule.id, "false").updated)
        .rules[0].value,
    ).toBe(false);
    expect(() =>
      makeRustPatch(file(source), parser, rule.id, "False"),
    ).toThrow();
    expect(() =>
      makeRustPatch(file("// shifted\n" + source), parser, rule.id, "false"),
    ).toThrow();
    expect(() =>
      makeRustPatch(file(source), parser, rule.id, "a".repeat(4097)),
    ).toThrow();
    expect(() => read(" ".repeat(RUST_LIMITS.bytes + 1))).toThrow(/128 KiB/);
    expect(() => read("😀".repeat(RUST_LIMITS.bytes / 4 + 1))).toThrow(
      /128 KiB/,
    );
  });
  it("bounds large function/rule lists and repeated match arms with an explicit notice", () => {
    const a = read(
      Array.from(
        { length: 110 },
        (_, i) => `fn f${i}(){ let x=1; let y=2; let z=3; }`,
      ).join("\n"),
    );
    expect(a.rust!.truncated).toBe(true);
    expect(a.functions).toHaveLength(100);
    expect(a.rules).toHaveLength(300);
    const b = read(
      `fn f(x:i32){match x {${Array.from({ length: 600 }, (_, i) => `${i}=>{},`).join("")}_=>{}}}`,
    );
    expect(b.rust!.truncated).toBe(true);
    expect(b.functions[0].steps[0].branches!.length).toBeLessThanOrEqual(400);
  });
  it("bounds wide parameter lists and deeply qualified display names", () => {
    const a = read(
      `fn f(${Array.from({ length: 150 }, (_, i) => `p${i}:u8`).join(",")}) {}`,
    );
    expect(a.functions[0].params).toHaveLength(100);
    expect(a.rust!.truncated).toBe(true);
    const b = read(
      `mod ${"a".repeat(250)} { mod ${"b".repeat(250)} { fn f(){let value=1;} } }`,
    );
    expect(b.functions[0].name.length).toBe(401);
    expect(b.functions[0].name.endsWith("…")).toBe(true);
    expect(b.rust!.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThan(
      RUST_LIMITS.output,
    );
  });
});
