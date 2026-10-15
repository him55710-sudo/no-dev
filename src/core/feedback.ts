import type { Lang } from "./types";
import { productVersion } from "../product";

export const feedbackOutcomes = {
  completed: { ko: "원하는 변경을 완료했어요", en: "I completed my change" },
  stuck: { ko: "중간에 막혔어요", en: "I got stuck" },
  unsupported: {
    ko: "필요한 기능을 지원하지 않아요",
    en: "My task is not supported",
  },
} as const;
export const feedbackProjects = {
  example: { ko: "제공된 예제", en: "Built-in example" },
  own: { ko: "내 프로젝트", en: "My own project" },
} as const;
export type FeedbackInput = {
  lang: Lang;
  environment: "browser" | "vscode";
  project: keyof typeof feedbackProjects;
  outcome: keyof typeof feedbackOutcomes;
  task: string;
  detail: string;
};

// Intentionally accepts no source, path, workspace, browser or user identity.
// Read only these six fields, even if callers pass other properties at runtime.
export function feedbackMarkdown(input: FeedbackInput): string {
  if (
    !["ko", "en"].includes(input.lang) ||
    !["browser", "vscode"].includes(input.environment) ||
    !Object.hasOwn(feedbackProjects, input.project) ||
    !Object.hasOwn(feedbackOutcomes, input.outcome)
  )
    throw Error("Invalid feedback selection");
  const clean = (value: string, required = false) => {
    if (
      typeof value !== "string" ||
      value.length > 1200 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
        value,
      )
    )
      throw Error("Invalid feedback text");
    const text = value.replace(/\r\n?/g, "\n").trim();
    if (required && !text) throw Error("Describe the task first");
    return text;
  };
  const task = clean(input.task, true),
    detail = clean(input.detail);
  // Fence user prose so Markdown formatting and HTML stay visible as text.
  const quoted = (value: string) => {
    const length = Math.max(
      3,
      ...[...value.matchAll(/`+/g)].map((m) => m[0].length + 1),
    );
    const fence = "`".repeat(length);
    return `${fence}text\n${value}\n${fence}`;
  };
  const ko = input.lang === "ko";
  return [
    `# ${ko ? "풀어봄 사용 경험" : "Pureobom use experience"}`,
    "",
    `- Version: ${productVersion}`,
    `- Environment: ${input.environment}`,
    `- Language: ${input.lang}`,
    `- ${ko ? "사용한 코드" : "Project"}: ${feedbackProjects[input.project][input.lang]}`,
    `- ${ko ? "결과" : "Outcome"}: ${feedbackOutcomes[input.outcome][input.lang]}`,
    "",
    `## ${ko ? "하려던 일" : "What I tried"}`,
    "",
    quoted(task),
    "",
    `## ${ko ? "잘된 점 또는 막힌 지점" : "What worked or got in the way"}`,
    "",
    quoted(detail || (ko ? "작성하지 않음" : "Not provided")),
    "",
    ko
      ? "이 요약은 사용자가 작성한 내용입니다. 자동으로 수집한 사용 통계가 아닙니다. 코드·파일명·기기 정보는 자동 첨부하지 않았습니다."
      : "This is a user-authored account, not automatically collected usage telemetry. Source, file names and device details were not attached automatically.",
    "",
  ].join("\n");
}
