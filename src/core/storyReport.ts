import type { Lang, Step } from "./types";

// Parser-free: exported explanations follow the same branch order as the UI.
export function storyLines(steps: Step[], lang: Lang, depth = 0): string[] {
  return Array.from(iterStoryLines(steps, lang, depth));
}

/** Allows bounded consumers to stop without expanding the entire step tree. */
export function* iterStoryLines(
  steps: Step[],
  lang: Lang,
  depth = 0,
): Generator<string> {
  for (const step of steps) {
    yield "  ".repeat(depth) + `- L${step.line}: ${step.text[lang]}`;
    yield* iterStoryLines(step.children, lang, depth + 1);
    if (step.otherwise) {
      const label =
        step.kind === "guard"
          ? lang === "ko"
            ? "오류가 나면"
            : "On error"
          : lang === "ko"
            ? "그렇지 않으면"
            : "Otherwise";
      yield "  ".repeat(depth + 1) + `- ${label}`;
      yield* iterStoryLines(step.otherwise, lang, depth + 2);
    }
    if (step.finalizer)
      yield* iterStoryLines([step.finalizer], lang, depth + 1);
  }
}
