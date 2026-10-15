import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  editorDiagnostics,
  type DiagnosticInput,
} from "../src/core/editorDiagnostics";
import { EditorProblems } from "../extension/ui/EditorProblems";

const diagnostic = (
  overrides: Partial<DiagnosticInput> = {},
): DiagnosticInput => ({
  severity: 0,
  source: "ts",
  code: 2322,
  message: "Type '4000' is not assignable to type '3000 | 5000'.",
  range: { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } },
  ...overrides,
});
const render = (
  input: ReturnType<typeof editorDiagnostics>,
  lang: "ko" | "en" = "ko",
) =>
  renderToStaticMarkup(
    createElement(EditorProblems, {
      snapshot: input,
      lang,
      disabled: false,
      onSource: () => {},
    }),
  );

describe("editor report evidence", () => {
  it("preserves provider, message, severity and exact source range independently of syntax findings", () => {
    const input = [
      diagnostic({ severity: 1, source: "eslint", code: "rule-name" }),
      diagnostic(),
    ];
    const result = editorDiagnostics(input, 7, "report-a");
    expect(result).toMatchObject({
      version: 7,
      revision: "report-a",
      status: "reported",
      errors: 1,
      warnings: 1,
      other: 0,
      total: 2,
    });
    expect(result.items[0]).toMatchObject({
      line: 3,
      column: 7,
      endLine: 3,
      endColumn: 10,
      code: "2322",
      source: "ts",
      message: input[1].message,
    });
    expect(input[0].severity).toBe(1);
  });
  it("explains only recognized TypeScript codes and does not reinterpret other providers", () => {
    for (const code of [2304, 2322, 2339, 2345])
      expect(
        editorDiagnostics([diagnostic({ code })], 1, "a").items[0].explanation
          ?.ko,
      ).toBeTruthy();
    for (const overrides of [
      { code: 999999 },
      { source: "eslint" },
      { source: undefined },
    ])
      expect(
        editorDiagnostics([diagnostic(overrides)], 1, "a").items[0].explanation,
      ).toBeUndefined();
  });
  it("bounds report count and text without hiding omitted report counts", () => {
    const many = Array.from({ length: 140 }, () =>
      diagnostic({ severity: 3, message: "long".repeat(2000) }),
    );
    many.push(diagnostic());
    const snapshot = editorDiagnostics(many, 1, "a");
    expect(snapshot).toMatchObject({
      errors: 1,
      other: 140,
      total: 141,
      omitted: 41,
    });
    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.items[0].severity).toBe("error");
    expect(snapshot.items[1].message.length).toBe(3001);
    expect(snapshot.items[1].shortened).toBe(true);
    expect(render(snapshot)).toContain("41개 알림을 더 받았습니다");
  });
  it.each(["ko", "en"] as const)(
    "shows an empty report as unverified in %s",
    (lang) => {
      const html = render(editorDiagnostics([], 1, "empty"), lang);
      expect(html).toContain(
        lang === "ko"
          ? "알림이 없어도 검사 완료나 정상 동작을 뜻하지 않습니다"
          : "No reports does not mean checking finished",
      );
      expect(html).not.toContain("success");
    },
  );
  it("marks an edited report and disables its old source link", () => {
    const html = render({
      ...editorDiagnostics([diagnostic()], 1, "old"),
      status: "edited",
    });
    expect(html).toContain("이전 코드에 대한 것일 수 있습니다");
    expect(html).toContain('disabled=""');
  });
  it("renders provider text inertly and excludes diagnostic links and related data", () => {
    const input = {
      ...diagnostic({
        source: "other",
        message: '<img src=x onerror="alert(1)">',
        code: {
          value: "2322",
          target: "command:danger",
        } as DiagnosticInput["code"],
      }),
      relatedInformation: [{ location: "file:///private.ts" }],
    };
    const snapshot = editorDiagnostics([input], 1, "a");
    const html = render(snapshot);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(JSON.stringify(snapshot)).not.toMatch(/command:danger|private\.ts/);
    expect(snapshot.items[0].explanation).toBeUndefined();
  });
});
