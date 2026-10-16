import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DatabaseSync } from "node:sqlite";
import { analyzeFile } from "../src/core/analyze";
import { applyPatch, makePatch, parseRequest } from "../src/core/edit";
import { ProjectAnalyzer } from "../src/core/project";
import { readFiles } from "../src/core/import";
import { validateAssistantChange } from "../src/core/assistantValidation";
import { assistantMessages } from "../src/core/localAssistant";
import { Story } from "../src/components/Story";
import type { SourceFile, Step } from "../src/core/types";

const file = (content: string): SourceFile => ({
  path: "query.sql",
  content,
  sqlDialect: "sqlite",
});
const flatten = (steps: Step[]): Step[] =>
  steps.flatMap((s) => [s, ...flatten(s.children)]);
describe("explicit SQLite source analysis", () => {
  it("anchors INSERT and DELETE at SQL tokens after comments and targets matching rows", () => {
    const content =
      "SELECT 1;\r\n/* insert 😀 */\r\nINSERT INTO t VALUES (2);\r\n-- delete\r\nDELETE FROM t WHERE id = 2;";
    const a = analyzeFile(file(content));
    expect(a.steps.map((step) => step.line)).toEqual([1, 3, 5]);
    expect(content.slice(a.steps[1].start, a.steps[1].start + 6)).toBe(
      "INSERT",
    );
    expect(content.slice(a.steps[2].start, a.steps[2].start + 6)).toBe(
      "DELETE",
    );
    expect(
      flatten(a.steps).find((step) => step.text.en.startsWith("WHERE"))?.text
        .en,
    ).toContain("target rows");
  });
  it("requires a dialect, invalidates cached analysis when it changes and does not assume other engines", async () => {
    const p = new ProjectAnalyzer();
    const source = { path: "a.sql", content: "SELECT 1;" };
    const imported = await readFiles([new File([source.content], source.path)]);
    expect(imported.skipped).toEqual([]);
    expect(imported.files).toEqual([source]);
    expect(p.analyze([source]).files[0].rules).toEqual([]);
    const enabled = p.analyze([{ ...source, sqlDialect: "sqlite" }]);
    expect(enabled.cacheHits).toBe(0);
    expect(enabled.files[0].rules[0].raw).toBe("1");
    expect(p.analyze([source]).files[0].rules).toEqual([]);
    expect(validateAssistantChange("sql", "SELECT 1").status).toBe(
      "unavailable",
    );
  });
  it("reads CASE, CTE, joins, filters, grouping, sorting and limits at actual Unicode/CRLF ranges", () => {
    const f = file(
      "-- 😀 유지\r\nWITH prices AS (SELECT id, total FROM orders) SELECT id, CASE WHEN total >= 50000 THEN 0 ELSE 3000 END AS fee FROM prices LEFT JOIN labels USING(id) WHERE id IS NOT NULL GROUP BY id HAVING count(*) > 0 ORDER BY id DESC LIMIT -1 OFFSET 0;",
    );
    const a = analyzeFile(f);
    expect(a.syntaxValid).toBe(true);
    expect(a.sql?.truncated).toBe(false);
    const text = flatten(a.steps)
      .map((s) => s.text.en)
      .join("\n");
    for (const s of [
      "Named queries",
      "WHEN",
      "ELSE",
      "WHERE",
      "GROUP BY",
      "HAVING",
      "ORDER BY",
      "LIMIT",
      "Join type",
    ])
      expect(text).toContain(s);
    for (const r of a.rules) {
      expect(f.content.slice(r.start, r.end)).toBe(r.raw);
      expect(r.line).toBe(2);
    }
    expect(a.rules.some((r) => r.raw === "-1")).toBe(true);
    expect(a.functions).toEqual([]);
  });
  it("preserves large numbers, exponent spelling, hex and separators and rejects expressions", () => {
    const f = file("SELECT 9007199254740993, 1.0000, -5, 0x7f;");
    const a = analyzeFile(f);
    for (const [i, value] of [
      "9223372036854775807",
      "1.2300e+02",
      "+9",
      "0x7f_ff",
    ].entries()) {
      const patch = makePatch(f, a.rules[i].id, value);
      expect(patch.newText).toBe(value);
      expect(patch.updated).toBe(
        f.content.slice(0, patch.start) + value + f.content.slice(patch.end),
      );
      expect(patch.semanticChecked).toBe(false);
    }
    for (const value of [
      "1; DELETE FROM orders",
      "1+2",
      "NaN",
      "Infinity",
      "?",
      "1_",
      "1__2",
      "--1",
      "1 /*comment*/",
      "",
    ])
      expect(() => makePatch(f, a.rules[0].id, value)).toThrow();
    expect(
      parseRequest(`${a.rules[0].name}를 0x7f_ff로 변경`, a.rules).value,
    ).toBe("0x7f_ff");
  });
  it("quotes strings once, retains exact surrounding text and checks with an actual SQLite engine", () => {
    const f = file(
      "/* 😀 */\rSELECT 'O''Brien' AS name, 9007199254740993 AS n; -- untouched\n",
    );
    const r = analyzeFile(f).rules[0];
    expect(r.value).toBe("O'Brien");
    expect(r.line).toBe(2);
    const input = "x'; DROP TABLE orders; -- 😀";
    const patch = makePatch(f, r.id, input);
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE orders(id INTEGER);");
      const stmt = db.prepare(patch.updated);
      stmt.setReadBigInts(true);
      expect(stmt.get()).toEqual({ name: input, n: 9007199254740993n });
      expect(db.prepare("SELECT count(*) AS n FROM orders").get()?.n).toBe(0);
    } finally {
      db.close();
    }
    expect(applyPatch(f, patch).content).toBe(patch.updated);
    expect(() => applyPatch({ ...f, content: f.content + " " }, patch)).toThrow(
      /Stale/,
    );
  });
  it("does not edit quoted identifiers, parameters, NULL, blobs or signs separated by comments", () => {
    const a = analyzeFile(
      file(
        "SELECT \"name\", [id], `key`, ?, :bound, NULL, TRUE, x'1234', - /* keep */ 5;",
      ),
    );
    expect(a.syntaxValid).toBe(true);
    expect(a.rules).toEqual([]);
  });
  it("blocks invalid syntax, oversized input and NUL; bounds deep and wide descriptions", () => {
    for (const content of [
      "SELECT FROM orders;",
      "SELECT 1; unexpected",
      "SELECT '\0';",
      "--" + "a".repeat(128 * 1024),
    ]) {
      const a = analyzeFile(file(content));
      expect(a.syntaxValid).toBe(false);
      expect(a.rules).toEqual([]);
    }
    const wide = analyzeFile(
      file(
        "SELECT " + Array.from({ length: 1000 }, (_, i) => i).join(",") + ";",
      ),
    );
    expect(wide.syntaxValid).toBe(true);
    expect(wide.sql?.truncated).toBe(true);
    expect(wide.rules.length).toBeLessThanOrEqual(300);
    const f = file("SELECT 1;");
    const r = analyzeFile(f).rules[0];
    expect(() => makePatch(f, r.id, "1".repeat(4097))).toThrow();
    expect(
      validateAssistantChange(
        "sql",
        "SELECT missing FROM unknown_table",
        "sqlite",
      ).status,
    ).toBe("syntax-passed");
    expect(validateAssistantChange("sql", "SELECT FROM", "sqlite").status).toBe(
      "syntax-failed",
    );
  });
  it("renders honest bilingual scope, dialect selection and escaped source", () => {
    const a = analyzeFile(file("SELECT '<script>alert(1)</script>';"));
    for (const lang of ["ko", "en"] as const) {
      const html = renderToStaticMarkup(
        createElement(Story, {
          analysis: a,
          lang,
          onSource() {},
          onEdit() {},
          onSimulate() {},
          onSqlDialect() {},
        }),
      );
      expect(html).toContain("SQLite");
      expect(html).not.toContain("<script>");
      expect(html).toContain(
        lang === "ko"
          ? "쿼리를 실행하지 않았으며"
          : "Queries were not executed",
      );
      expect(html).toContain("select");
    }
    const messages = assistantMessages({
      source: "SELECT 1",
      language: "sql",
      sqlDialect: "sqlite",
      task: "explain",
      lang: "en",
      instruction: "",
    });
    expect(messages[0].content).toContain("The user selected SQLite");
  });
  it("distinguishes LIMIT count from offset in both SQLite spellings", () => {
    for (const source of [
      "SELECT 1 LIMIT 10 OFFSET 5",
      "SELECT 1 LIMIT 5, 10",
    ]) {
      const steps = flatten(analyzeFile(file(source)).steps);
      expect(
        steps.find((s) => s.text.en.startsWith("Maximum returned"))?.text.en,
      ).toContain(": 10");
      expect(
        steps.find((s) => s.text.en.startsWith("Rows to skip"))?.text.en,
      ).toContain(": 5");
    }
  });
});
