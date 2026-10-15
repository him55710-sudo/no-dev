import type { Words } from "./types";

export type DiagnosticInput = {
  severity: number;
  message: string;
  source?: string;
  code?: string | number | { value: string | number };
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};
export type EditorProblem = {
  id: string;
  severity: "error" | "warning" | "information" | "hint";
  message: string;
  source: string;
  code?: string;
  shortened: boolean;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  explanation?: Words;
};
export type EditorDiagnostics = {
  revision: string;
  version: number;
  status: "reported" | "edited";
  total: number;
  errors: number;
  warnings: number;
  other: number;
  omitted: number;
  items: EditorProblem[];
};

const meanings: Record<string, Words> = {
  "2322": {
    ko: "이 자리에 허용된 값의 종류와 넣은 값이 맞지 않습니다. 허용된 종류와 실제 값을 함께 확인하세요.",
    en: "This value does not fit the type allowed here. Compare the expected type with the value being assigned.",
  },
  "2345": {
    ko: "기능에 전달한 값이 그 기능이 받도록 정해진 종류와 맞지 않습니다. 전달한 값과 받는 정보의 정의를 확인하세요.",
    en: "An argument does not fit the type this function accepts. Check the value and the parameter definition.",
  },
  "2304": {
    ko: "이 위치에서 그 이름을 찾지 못했습니다. 이름의 철자, 선언 위치, 가져오기 구문을 확인하세요.",
    en: "This name cannot be found here. Check its spelling, declaration scope and imports.",
  },
  "2339": {
    ko: "이 값의 타입에 해당 항목이 정의되어 있지 않습니다. 항목 이름과 값의 타입 정의를 확인하세요.",
    en: "The declared type does not have this property. Check the property name and the value's type definition.",
  },
};
const clip = (value: string, length: number) =>
  value.length > length ? value.slice(0, length) + "…" : value;

// Diagnostics are editor reports, not a completed or versioned type-check result.
// Keep messages as text and never forward provider links, commands or related URIs.
export function editorDiagnostics(
  diagnostics: readonly DiagnosticInput[],
  version: number,
  revision: string,
): EditorDiagnostics {
  const counts = [0, 0, 0, 0];
  for (const d of diagnostics) counts[d.severity]++;
  const ordered = [...diagnostics].sort(
    (a, b) =>
      a.severity - b.severity ||
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character,
  );
  const items = ordered.slice(0, 100).map((d, index): EditorProblem => {
    const code = typeof d.code === "object" ? d.code.value : d.code;
    const codeText = code === undefined ? undefined : String(code);
    return {
      id: String(index),
      severity: (["error", "warning", "information", "hint"] as const)[
        d.severity
      ],
      source: clip(d.source || "", 80),
      code: codeText === undefined ? undefined : clip(codeText, 80),
      message: clip(d.message, 3000),
      shortened: d.message.length > 3000,
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      explanation:
        d.source === "ts" && codeText ? meanings[codeText] : undefined,
    };
  });
  return {
    revision,
    version,
    status: "reported",
    total: diagnostics.length,
    errors: counts[0],
    warnings: counts[1],
    other: counts[2] + counts[3],
    omitted: Math.max(0, diagnostics.length - items.length),
    items,
  };
}
