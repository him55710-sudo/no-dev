import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Story } from "../src/components/Story";
import { analyzeFile } from "../src/core/analyze";
import { applyPatch, makePatch, parseRequest } from "../src/core/edit";
import { validateAssistantChange } from "../src/core/assistantValidation";
import {
  type FileAnalysis,
  type InterfaceNode,
  type Rule,
} from "../src/core/types";

const read = (content: string, language = "html") =>
  analyzeFile({ path: `page.${language}`, content });
const nodes = (a: FileAnalysis): InterfaceNode[] => {
  const all: InterfaceNode[] = [];
  const visit = (ns: InterfaceNode[]) => {
    for (const n of ns) {
      all.push(n);
      visit(n.children);
    }
  };
  visit(a.interface?.roots || []);
  return all;
};
const edit = (content: string, rule: Rule, value: string, language = "html") =>
  makePatch({ path: `page.${language}`, content }, rule.id, value);

describe("HTML source facts and exact edits", () => {
  it("reads source values and UTF-16 CRLF anchors without loading scripts or resources", () => {
    const content =
      '<!doctype html>\r\n<p title="A &amp; B">안녕 😀 &lt;친구&gt;</p>\r\n<script>throw Error("must not run")</script><img src="https://invalid.example/no-fetch">';
    const a = read(content);
    expect(a.syntaxValid).toBe(true);
    expect(a.web).toMatchObject({ language: "html", truncated: false });
    expect(a.rules.map((r) => r.value)).toEqual(["A & B", "안녕 😀 <친구>"]);
    for (const r of a.rules) {
      expect(content.slice(r.start, r.end)).toBe(r.raw);
      expect(r.line).toBe(2);
    }
    expect(a.imports).toEqual([]);
    expect(nodes(a).some((n) => n.title.en === "<script> element")).toBe(true);
  });
  it("encodes new text and preserves every character outside the selected range", () => {
    const content = "<p>한글 😀 &amp; text</p>\r\n<!-- keep -->";
    const r = read(content).rules[0];
    const patch = edit(content, r, '<script>😀 & "quoted"</script>');
    expect(patch.newText).toBe(
      '&lt;script&gt;😀 &amp; "quoted"&lt;/script&gt;',
    );
    expect(patch.updated).toBe(`<p>${patch.newText}</p>\r\n<!-- keep -->`);
    expect(read(patch.updated).rules[0].value).toBe(
      '<script>😀 & "quoted"</script>',
    );
    expect(patch.semanticChecked).toBe(false);
    expect(applyPatch({ path: "page.html", content }, patch).content).toBe(
      patch.updated,
    );
    expect(() =>
      applyPatch({ path: "page.html", content: content + " " }, patch),
    ).toThrow(/Stale/);
  });
  it("quotes textual attribute replacements without changing adjacent attributes", () => {
    for (const original of ['"old"', "'old'", "old"]) {
      const content = `<input placeholder = ${original} disabled data-keep='x'>`;
      const r = read(content).rules[0];
      const patch = edit(content, r, '새 문구 " & < >');
      expect(patch.updated).toBe(
        "<input placeholder = \"새 문구 &quot; &amp; &lt; &gt;\" disabled data-keep='x'>",
      );
      expect(read(patch.updated).rules[0].value).toBe('새 문구 " & < >');
    }
  });
  it("keeps raw text, template, foreign and executable attributes read-only", () => {
    const content =
      '<title>Title</title><style>.a{color:red}</style><textarea>Text</textarea><noscript>Fall back</noscript><template><p>Later</p></template><svg><text>Vector</text></svg><a href="javascript:0" onclick="run()" style="color:red">Now</a>';
    const a = read(content);
    expect(a.rules.map((r) => r.value)).toEqual(["Now"]);
    expect(nodes(a).some((n) => n.code === "Later")).toBe(true);
  });
  it("disables edits after recovery diagnostics and preserves source for inspection", () => {
    for (const content of [
      '<p title="a" title="b">Hi</p>',
      '<div title="never closes>',
      "<p>bad\u0000text</p>",
    ]) {
      const a = read(content);
      expect(a.syntaxValid, content).toBe(false);
      expect(a.rules).toHaveLength(0);
      expect(validateAssistantChange("html", content).status).toBe(
        "syntax-failed",
      );
    }
    expect(read("<ul><li>one<li>two</ul>").syntaxValid).toBe(true);
    expect(validateAssistantChange("html", "<p>Hello</p>").status).toBe(
      "syntax-passed",
    );
  });
  it("does not offer merged/reparented text spanning source markup as one edit", () => {
    const content = "<div>A<table>B<tr><td>C</td></tr>D</table>E</div>";
    const a = read(content);
    for (const r of a.rules) expect(r.raw).not.toContain("<");
    expect(a.rules.some((r) => r.value === "AB" || r.value === "ABD")).toBe(
      false,
    );
  });
  it("bounds display, depth, bytes and values without truncating an editable value", () => {
    const many = read("<p>x</p>".repeat(350));
    expect(many.web?.truncated).toBe(true);
    expect(many.web!.nodes).toBeLessThanOrEqual(300);
    expect(
      read("<div>".repeat(30) + "x" + "</div>".repeat(30)).web?.truncated,
    ).toBe(true);
    expect(read("한".repeat(45000)).syntaxValid).toBe(false);
    expect(read(`<p>${"x".repeat(4097)}</p>`).rules).toHaveLength(0);
    const r = read("<p>old</p>").rules[0];
    for (const input of ["x".repeat(4097), "\u0000", "\r", "\uD800"])
      expect(() => edit("<p>old</p>", r, input)).toThrow();
  });
});

describe("CSS source declarations and guarded edits", () => {
  it("retains conditions, selectors, exact numeric spelling and importance without guessing layout", () => {
    const content =
      "@media (min-width: 700px) {\r\n.grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12.0000px !important; --wide: 9007199254740993; } }";
    const a = read(content, "css");
    expect(a.syntaxValid).toBe(true);
    expect(a.rules.map((r) => r.value)).toEqual([
      "repeat(auto-fit, minmax(240px, 1fr))",
      "12.0000px",
      "9007199254740993",
    ]);
    expect(nodes(a).some((n) => n.code === "@media (min-width: 700px)")).toBe(
      true,
    );
    expect(
      nodes(a).some((n) => n.title.en === "gap declaration (!important)"),
    ).toBe(true);
    const r = a.rules[1];
    expect(r.line).toBe(2);
    const patch = edit(content, r, "24px", "css");
    expect(patch.updated).toBe(content.replace("12.0000px", "24px"));
    expect(patch.updated).toContain("!important");
  });
  it("supports repeated declarations as individually identified source ranges", () => {
    const repeated = read(".a { " + "color:red;".repeat(30) + "}", "css").rules;
    for (const rule of repeated)
      expect(
        parseRequest(`change ${rule.name} to "green"`, repeated).rule.id,
      ).toBe(rule.id);
    const content = ".a { color: red; color: blue; }";
    const a = read(content, "css");
    expect(new Set(a.rules.map((r) => r.name)).size).toBe(2);
    const requested = parseRequest(
      `change ${a.rules[1].name} to "green"`,
      a.rules,
    );
    expect(requested.rule.id).toBe(a.rules[1].id);
    expect(edit(content, requested.rule, requested.value, "css").updated).toBe(
      ".a { color: red; color: green; }",
    );
  });
  it("preserves comments and excludes values with embedded comments", () => {
    const literal = '.a { content: "/* literal */"; }';
    expect(read(literal, "css").rules).toHaveLength(1);
    const content =
      "/*keep*/ .a { color: /*before*/ red /*after*/; margin: 1px /*inside*/ 2px; }";
    const a = read(content, "css");
    expect(a.rules.some((r) => r.cssProperty === "margin")).toBe(false);
    const color = a.rules.find((r) => r.cssProperty === "color");
    if (color)
      expect(edit(content, color, "blue", "css").updated).toBe(
        content.replace("red", "blue"),
      );
    expect(nodes(a).some((n) => n.detail?.en.includes("comments"))).toBe(true);
  });
  it("rejects broken recovery input, including unmatched EOF tokens", () => {
    for (const content of [
      ".a { color: red",
      '.a { color: "oops; }',
      "/* never ends",
      ".a { invalid }",
      ".a { color: red; }}",
      ".a { color: rgb(1,2,3; }",
    ]) {
      expect(read(content, "css").syntaxValid, content).toBe(false);
      expect(validateAssistantChange("css", content).status, content).toBe(
        "syntax-failed",
      );
    }
  });
  it("rejects breakout edits, malformed values, added priority and known grammar errors", () => {
    const content = ".a { color: red; }";
    const r = read(content, "css").rules[0];
    for (const value of [
      "blue; display:none",
      "blue } .b { color:red",
      "blue !important",
      "2px",
      "rgb(",
      '"unterminated',
      "/*oops",
      "",
    ])
      expect(() => edit(content, r, value, "css"), value).toThrow();
  });
  it("does not mistake punctuation inside tokens for declaration breakouts", () => {
    const content =
      '.a { content: "old"; --user: old; background-image: none; }';
    const a = read(content, "css");
    expect(edit(content, a.rules[0], '"a;{}()[]"', "css").updated).toContain(
      'content: "a;{}()[]";',
    );
    expect(
      edit(content, a.rules[1], "var(--fallback, 24px)", "css").updated,
    ).toContain("--user: var(--fallback, 24px)");
    expect(
      edit(content, a.rules[2], 'url("data:image/svg+xml;a;b")', "css").updated,
    ).toContain('url("data:image/svg+xml;a;b")');
  });
  it("reports parsing separately from CSS property validity and rendered results", () => {
    const result = validateAssistantChange(
      "css",
      ".a { color: 17px; future-prop: foo; }",
    );
    expect(result.status).toBe("syntax-passed");
    expect(result.detail).toContain("property value validity");
    expect(result.detail).toContain("cascade");
  });
});

describe("HTML/CSS localized inert source UI", () => {
  it("renders both languages with explicit boundaries and disabled editing", () => {
    for (const lang of ["ko", "en"] as const)
      for (const language of ["html", "css"]) {
        const analysis = read(
          language === "html"
            ? "<p>&lt;script&gt;evil()&lt;/script&gt;</p>"
            : ".a { color: red; }",
          language,
        );
        const markup = renderToStaticMarkup(
          createElement(Story, {
            analysis,
            lang,
            onSource() {},
            onSimulate() {},
            onEdit() {},
            editDisabled: true,
          }),
        );
        expect(markup).toContain(language.toUpperCase());
        expect(markup).toContain('disabled=""');
        expect(markup).not.toContain("<script>evil()");
        expect(markup).toContain(
          lang === "ko" ? "원문 구조" : "source structure",
        );
      }
  });
});
