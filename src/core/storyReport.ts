import type { Lang, Step } from "./types";

// Parser-free: exported explanations follow the same branch order as the UI.
export function storyLines(steps: Step[], lang: Lang, depth = 0): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    lines.push("  ".repeat(depth) + `- L${step.line}: ${step.text[lang]}`);
    lines.push(...storyLines(step.children, lang, depth + 1));
    for (const branch of step.branches || []) {
      lines.push("  ".repeat(depth + 1) + `- ${branch.label[lang]}`);
      lines.push(...storyLines(branch.steps, lang, depth + 2));
    }
    if (step.otherwise) {
      const label =
        step.kind === "guard"
          ? lang === "ko"
            ? "오류가 나면"
            : "On error"
          : lang === "ko"
            ? "그렇지 않으면"
            : "Otherwise";
      lines.push("  ".repeat(depth + 1) + `- ${label}`);
      lines.push(...storyLines(step.otherwise, lang, depth + 2));
    }
    if (step.finalizer)
      lines.push(...storyLines([step.finalizer], lang, depth + 1));
  }
  return lines;
}
