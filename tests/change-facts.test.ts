import { describe, expect, it } from "vitest";
import { validateAssistantChange } from "../src/core/assistantValidation";

const facts = (before: string, after: string, language = "javascript") =>
  validateAssistantChange(language, after, undefined, before).changeFacts;
describe("independent source change facts", () => {
  it("recognizes actual formatting without changing source or comments", () => {
    expect(
      facts(
        "function f(x) { return x + 1; }",
        "function f(x) {\r\n  return x + 1;\r\n}",
      ),
    ).toMatchObject({
      status: "available",
      whitespaceOnly: true,
      commentsChanged: false,
      codeTokensChanged: false,
      parseStructureChanged: false,
    });
  });
  it("exposes added braces even if a model calls its proposal formatting", () => {
    expect(
      facts(
        "if (ready) run(); else wait();",
        "if (ready) { run(); } else { wait(); }",
      ),
    ).toMatchObject({
      status: "available",
      whitespaceOnly: false,
      codeTokensChanged: true,
      parseStructureChanged: true,
      braces: { before: 0, after: 4 },
    });
  });
  it("does not mistake automatic semicolon insertion for harmless whitespace", () => {
    expect(
      facts("function f(){return value;}", "function f(){return\nvalue;}"),
    ).toMatchObject({
      whitespaceOnly: false,
      codeTokensChanged: false,
      parseStructureChanged: true,
    });
  });
  it("counts literal and JSX whitespace as code content", () => {
    for (const [before, after, language] of [
      ['const s="a b";', 'const s="a  b";', "javascript"],
      ["const s=`a b`;", "const s=`a  b`;", "javascript"],
      [
        "const x=<span>a b</span>;",
        "const x=<span>a  b</span>;",
        "typescriptreact",
      ],
      [
        "const x=<span> a</span>;",
        "const x=<span>  a</span>;",
        "typescriptreact",
      ],
      [
        "const x=<span>a </span>;",
        "const x=<span>a  </span>;",
        "javascriptreact",
      ],
      [
        "const x=<span> </span>;",
        "const x=<span>  </span>;",
        "typescriptreact",
      ],
    ])
      expect(facts(before, after, language)).toMatchObject({
        whitespaceOnly: false,
        codeTokensChanged: true,
      });
  });
  it("distinguishes comments from regex or string contents, including documentation comments", () => {
    expect(
      facts(
        'const x=/a\\/b/; const y="//not comment";',
        'const x = /a\\/b/;\nconst y = "//not comment";',
      ),
    ).toMatchObject({ whitespaceOnly: true, commentsChanged: false });
    expect(
      facts("/** old */\nconst x=1;", "/** new */\nconst x=1;"),
    ).toMatchObject({
      codeTokensChanged: false,
      parseStructureChanged: false,
      commentsChanged: true,
      whitespaceOnly: false,
    });
    expect(
      facts("// @ts-ignore\nconst x=1;", "// ordinary comment\nconst x=1;"),
    ).toMatchObject({ commentsChanged: true, whitespaceOnly: false });
    expect(
      facts("/* keep */ const x=1;", "const x=1; /* keep */"),
    ).toMatchObject({
      codeTokensChanged: false,
      commentsChanged: false,
      whitespaceOnly: false,
    });
    expect(
      facts("if (ready) run(); /* keep */", "if (ready) { run(); } /* keep */"),
    ).toMatchObject({
      codeTokensChanged: true,
      commentsChanged: false,
      whitespaceOnly: false,
    });
  });
  it("withholds facts for recovered syntax trees and unsupported languages", () => {
    expect(facts("const x=;", "const x=1;")).toEqual({ status: "unavailable" });
    expect(facts("const x=1;", "const x=;")).toEqual({ status: "unavailable" });
    expect(facts("x=1", "x = 1", "python")).toBeUndefined();
  });
});
