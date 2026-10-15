import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeFile } from "../src/core/analyze";
import { storyLines } from "../src/core/storyReport";
import { Steps } from "../src/components/Story";
import type { Lang, Step } from "../src/core/types";

const file = {
  path: "save.ts",
  content: `export function save() {
  try {
    persist();
  } catch (error) {
    recover(error);
  } finally {
    cleanup();
  }
}`,
};
const ordered = (text: string) => {
  const positions = ["persist", "recover", "cleanup"].map((word) =>
    text.indexOf(word),
  );
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
};

describe("source-grounded cleanup flow", () => {
  it("keeps the finalizer separate from both the try and catch bodies", () => {
    const step = analyzeFile(file).functions[0].steps[0];
    expect(step.children).toHaveLength(1);
    expect(step.otherwise).toHaveLength(1);
    expect(step.finalizer?.kind).toBe("finally");
    expect(step.finalizer?.children).toHaveLength(1);
    expect(file.content.slice(step.finalizer!.start, step.finalizer!.end)).toBe(
      "{\n    cleanup();\n  }",
    );
    expect(step.finalizer?.children[0].line).toBe(7);
  });

  it.each<Lang>(["ko", "en"])(
    "shows try, error handling and finalizer in that order in %s UI and export",
    (lang) => {
      const steps = analyzeFile(file).functions[0].steps;
      ordered(
        renderToStaticMarkup(
          createElement(Steps, { steps, lang, onSource: () => {} }),
        ),
      );
      const report = storyLines(steps, lang).join("\n");
      ordered(report);
      expect(report).toContain(lang === "ko" ? "오류가 나면" : "On error");
      expect(report).not.toContain("Otherwise / on error");
    },
  );

  it("does not invent catch behavior for try/finally or cleanup for try/catch", () => {
    const a = analyzeFile({
      path: "a.ts",
      content: "function f(){try {work()} finally {cleanup()}}",
    }).functions[0].steps[0];
    expect(a.otherwise).toBeUndefined();
    expect(a.text.en).toContain("no catch handler");
    expect(a.finalizer).toBeDefined();
    const b = analyzeFile({
      path: "b.ts",
      content: "function f(){try {work()} catch {recover()}}",
    }).functions[0].steps[0];
    expect(b.otherwise).toHaveLength(1);
    expect(b.finalizer).toBeUndefined();
  });

  it("marks pending finally for returns in try and catch but does not cross a function boundary", () => {
    const source = {
      path: "a.ts",
      content: `function outer(){
      try { const inner = () => { return 9; }; return 1; }
      catch { return; }
      finally { return 2; }
    }`,
    };
    const analysis = analyzeFile(source);
    const guard = analysis.functions.find((f) => f.name === "outer")!.steps[0];
    expect(guard.children.at(-1)?.text.en).toContain("enclosing finally");
    expect(guard.otherwise?.[0].text.en).toContain("enclosing finally");
    expect(guard.finalizer?.children[0].text.en).not.toContain(
      "enclosing finally",
    );
    expect(
      analysis.functions.find((f) => f.name === "inner")?.steps[0].text.en,
    ).not.toContain("enclosing finally");
  });

  it("preserves nested finalizers and outer cleanup for a return inside an inner finalizer", () => {
    const steps = analyzeFile({
      path: "a.ts",
      content: `function f(){try {
      try { return 1; } finally { return 2; }
    } finally { cleanup(); }}`,
    }).functions[0].steps;
    const inner = steps[0].children[0];
    expect(inner.finalizer?.children[0].text.en).toContain("enclosing finally");
    expect(steps[0].finalizer?.children[0].text.en).toContain("cleanup");
    expect(
      storyLines(steps, "en")
        .join("\n")
        .match(/Finally:/g),
    ).toHaveLength(2);
  });

  it("describes finalizer precedence consistently with an executed, authored reference function", () => {
    // Execute only this authored fixture, never code passed to the analyzer.
    function reference(log: string[]) {
      try {
        log.push("try");
        throw Error("failure");
      } catch {
        log.push("catch");
        return "recovered";
      } finally {
        log.push("finally");
        return "replacement";
      }
    }
    const log: string[] = [];
    expect(reference(log)).toBe("replacement");
    expect(log).toEqual(["try", "catch", "finally"]);
    const guard = analyzeFile({
      path: "reference.js",
      content: reference.toString(),
    }).functions[0].steps[0];
    expect(guard.otherwise?.at(-1)?.text.en).toContain("enclosing finally");
    expect(guard.finalizer?.text.en).toContain(
      "replace the earlier return value or error",
    );
  });

  it("bounds a real long else-if chain while retaining a source-review notice", () => {
    const conditions = Array.from(
      { length: 40 },
      (_, i) => `if (x === ${i}) { return ${i}; }`,
    ).join(" else ");
    const steps = analyzeFile({
      path: "long.ts",
      content: `function route(x){${conditions} else { return "DEEP_SENTINEL"; }}`,
    }).functions[0].steps;
    const html = renderToStaticMarkup(
      createElement(Steps, { steps, lang: "en", onSource: () => {} }),
    );
    expect(html).toContain("See source for deeper nesting");
    expect(html).not.toContain("DEEP_SENTINEL");
    expect(html.match(/step-condition/g)?.length).toBe(13);
  });

  it("also bounds nested finalizers in the rendered story", () => {
    const leaf: Step = {
      start: 0,
      end: 1,
      line: 1,
      endLine: 1,
      id: "leaf",
      kind: "action",
      text: { ko: "DEEP_SENTINEL", en: "DEEP_SENTINEL" },
      children: [],
      supported: true,
    };
    let step = leaf;
    for (let i = 0; i < 30; i++)
      step = {
        ...leaf,
        id: `cleanup${i}`,
        text: { ko: "정리", en: "Cleanup" },
        finalizer: step,
      };
    const html = renderToStaticMarkup(
      createElement(Steps, { steps: [step], lang: "en", onSource: () => {} }),
    );
    expect(html).toContain("See source for deeper nesting");
    expect(html).not.toContain("DEEP_SENTINEL");
  });
});
