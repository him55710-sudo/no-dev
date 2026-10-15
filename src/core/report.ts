import { displayValue, type ScenarioReport } from "./scenarioModel";
import type { Lang, Simulation } from "./types";

const statuses = {
  changed: { ko: "달라짐", en: "Changed" },
  same: { ko: "같음", en: "Same" },
  unavailable: { ko: "확인 불가", en: "Unavailable" },
  observed: { ko: "계산됨", en: "Observed" },
};
export const scenarioStatus = (status: keyof typeof statuses, lang: Lang) =>
  statuses[status][lang];
const output = (s?: Simulation) =>
  !s ? "—" : s.ok ? displayValue(s.result) : s.error || "Unavailable";
const cell = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/[\r\n]+/g, " ")
    .replace(/`/g, "&#96;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");
export function scenarioMarkdown(report: ScenarioReport, lang: Lang): string {
  const ko = lang === "ko";
  return [
    `# ${ko ? "풀어봄 · 변경 영향 비교" : "Pureobom · Change impact"}`,
    "",
    `${ko ? "파일" : "File"}: ${cell(report.path)} · ${ko ? "기능" : "Function"}: ${cell(report.name)}`,
    "",
    report.change
      ? cell(report.change[lang])
      : ko
        ? "현재 코드의 계산 결과입니다."
        : "Results for the current source.",
    "",
    ko
      ? "| 사례 | 입력 | 변경 전 | 변경 후 | 결과 |"
      : "| Case | Inputs | Before | After | Result |",
    "| --- | --- | --- | --- | --- |",
    ...report.rows.map(
      (r) =>
        `| ${cell(r.label)} | ${cell(displayValue(r.args))} | ${cell(output(r.before))} | ${cell(output(r.after))} | ${scenarioStatus(r.status, lang)} |`,
    ),
    "",
    ko
      ? "제한된 정적 해석기의 결과입니다. 표시된 입력만 확인했으며 실제 앱 실행·전체 타입 검사·회귀 테스트를 대신하지 않습니다. 확인 불가는 성공으로 계산하지 않습니다."
      : "Results from a limited AST interpreter, for these inputs only. This is not an app execution, type check or regression suite. Unavailable cases are not passes.",
    "",
    ko
      ? "이 문서에는 위 파일명·입력·출력이 포함됩니다. 외부 공유 전 내용을 검토하세요. 자동 전송이나 공개는 하지 않습니다."
      : "This document contains the displayed file name, inputs and outputs. Review it before sharing. Nothing is automatically uploaded or published.",
    "",
    "Made with Pureobom · Read it. Change it. Check it.",
    "",
  ].join("\n");
}
