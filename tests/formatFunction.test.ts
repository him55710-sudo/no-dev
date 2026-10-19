import { describe, expect, it } from "vitest";
import { analyzeFile } from "../src/core/analyze";
import { formatFunction } from "../src/core/formatFunction";

function format(content: string, name = "sum", path = "sample.js") {
  const file = { path, content };
  const fn = analyzeFile(file).functions.find((f) => f.name === name)!;
  expect(fn).toBeDefined();
  return formatFunction(file, fn.id);
}
describe("selected function local formatting", () => {
  it("reflows dense statements and declarations without changing the surrounding file", () => {
    const prefix = "// unrelated\nconst label='keep';\n",
      suffix = "\nconst unchanged = ()=>1;\n";
    const source =
      prefix +
      "export function sum(items) { let value=0, index=0; while(index<items.length) { if(items[index]>0) value+=items[index]; else value-=1; index++; } return value; }" +
      suffix;
    const { patch } = format(source);
    expect(patch!.updated.startsWith(prefix)).toBe(true);
    expect(patch!.updated.endsWith(suffix)).toBe(true);
    expect(patch!.newText).toContain("let value = 0,\n    index = 0;");
    expect(patch!.newText).toContain(
      "if (items[index] > 0)\n      value += items[index];\n    else\n      value -= 1;",
    );
    expect(patch!.updated.match(/[{}]/g)).toEqual(source.match(/[{}]/g));
    expect(format(patch!.updated).patch).toBeUndefined();
  });
  it("preserves CRLF, comments, regex and template text", () => {
    const source =
      "// outside\r\nfunction sum(items) { const pattern=/a{2}/; /* keep */ const text=`line\n  literal`; return pattern.test(items) ? text : ''; }\r\n";
    const patch = format(source).patch!;
    expect(patch.updated).toContain(
      "const pattern = /a{2}/; /* keep */\r\n  const text = `line\n  literal`;",
    );
    expect(patch.updated).toContain("\r\n  return");
    expect(patch.updated.endsWith("}\r\n")).toBe(true);
  });
  it("preserves ASI and does not add semicolons", () => {
    const source = "function sum() {\nreturn\n{ amount: 3 }\n}\n";
    const patch = format(source).patch!;
    expect(patch.updated).toContain("return\n");
    expect(patch.updated).not.toContain(";");
  });
  it.each(["sample.ts", "sample.mts", "sample.cts"])(
    "formats typed methods in %s and preserves class siblings",
    (path) => {
      const source =
        "class Ledger {\n  untouched = 2;\n  sum(x:number) { const value=x+1; return value; }\n  next() {return 5;}\n}\n";
      const patch = format(source, "sum", path).patch!;
      expect(patch.newText).toBe(
        "  sum(x: number) {\n    const value = x + 1;\n    return value;\n  }",
      );
      expect(patch.updated).toContain("  next() {return 5;}");
    },
  );
  it("preserves JSX text while formatting the selected arrow body", () => {
    const source =
      "const sum = (x: number) => { const y=x+1; return <span>  value {y} </span>; };\nconst other=1;";
    const patch = format(source, "sum", "sample.tsx").patch!;
    expect(patch.updated).toContain("<span>  value {y} </span>");
    expect(patch.updated.startsWith("const sum = ")).toBe(true);
    expect(patch.updated.endsWith(";\nconst other=1;")).toBe(true);
  });
  it("rejects stale IDs, invalid syntax, unsupported languages and oversized sources", () => {
    expect(() =>
      formatFunction({ path: "a.js", content: "function sum(){}" }, "fn:100"),
    ).toThrow(/again/);
    expect(() =>
      formatFunction({ path: "a.ts", content: "function sum( {" }, "fn:0"),
    ).toThrow(/syntax/);
    expect(() =>
      formatFunction({ path: "a.py", content: "def sum(): pass" }, "fn:0"),
    ).toThrow(/JS\/TS/);
    expect(() =>
      formatFunction(
        { path: "a.js", content: " ".repeat(128 * 1024 + 1) },
        "fn:0",
      ),
    ).toThrow(/128 KiB/);
  });
});
