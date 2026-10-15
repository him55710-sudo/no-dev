import { describe, expect, it } from "vitest";
import { analyzeFile } from "../src/core/analyze";
import { makePatch, parseRequest } from "../src/core/edit";
import {
  normalizeGlossary,
  updateGlossary,
  type GlossaryEntry,
} from "../src/core/glossary";
import { ProjectAnalyzer } from "../src/core/project";
import type { SourceFile } from "../src/core/types";

const file = {
  path: "src/billing.ts",
  content: `const cutoff = 12;
export function billing(amount: number) {
  const remaining = cutoff - amount;
  return { remaining, cutoff: amount, quoted: "cutoff" };
}
function other(amount: number) { const cutoff = 3; return amount + cutoff; }
const arrow = (amount: number) => amount + cutoff;`,
};
function term(f: SourceFile, name: string, scope = "file") {
  return analyzeFile(f).terms!.find(
    (t) => t.name === name && t.scope === scope,
  )!;
}
function glossary(): GlossaryEntry[] {
  return [
    {
      path: file.path,
      symbolId: term(file, "cutoff").id,
      labels: { ko: "무료 이용 한도", en: "free allowance" },
    },
    {
      path: file.path,
      symbolId: term(file, "amount", "billing").id,
      labels: { ko: "사용한 횟수" },
    },
    {
      path: file.path,
      symbolId: term(file, "billing").id,
      labels: { ko: "이용량 계산" },
    },
    {
      path: file.path,
      symbolId: term(file, "amount", "arrow").id,
      labels: { ko: "화살표 입력" },
    },
  ];
}
describe("project terminology", () => {
  it("binds labels to declarations and their references, keeping shadowed names separate", () => {
    const a = analyzeFile(file, glossary());
    expect(a.functions[0].label.ko).toBe("이용량 계산");
    expect(a.functions[0].params[0].label?.ko).toBe("사용한 횟수");
    expect(a.functions[0].steps[0].text.ko).toContain("무료 이용 한도");
    expect(a.functions[0].steps[0].text.ko).toContain("사용한 횟수");
    expect(JSON.stringify(a.functions[1])).not.toContain("무료 이용 한도");
    expect(JSON.stringify(a.functions[1])).not.toContain("사용한 횟수");
    expect(a.functions[2].steps[0].text.ko).toContain("화살표 입력");
    expect(a.functions[2].steps[0].text.ko).toContain("무료 이용 한도");
    expect(a.functions[0].steps[1].text.ko).toContain("“cutoff”");
    expect(a.functions[0].steps[1].text.ko).toContain("cutoff: 사용한 횟수");
  });
  it("does not relabel object properties or nested block declarations", () => {
    const f = {
      ...file,
      content: `const cutoff=12; function f(obj) { if (obj) { const cutoff=3; return cutoff; } return obj.cutoff + cutoff; }`,
    };
    const a = analyzeFile(f, glossary());
    expect(a.functions[0].steps[0].children[1].text.ko).not.toContain(
      "무료 이용 한도",
    );
    expect(a.functions[0].steps[1].text.en).toContain("cutoff");
    expect(a.functions[0].steps[1].text.en).toContain("free allowance");
  });
  it("uses the custom term for a bounded sentence edit without renaming code", () => {
    const entries = glossary(),
      a = analyzeFile(file, entries);
    const requested = parseRequest("무료 이용 한도를 20으로 변경", a.rules);
    const patch = makePatch(file, requested.rule.id, requested.value, entries);
    expect(patch.updated).toBe(
      file.content.replace("cutoff = 12", "cutoff = 20"),
    );
    expect(patch.description.ko).toContain("무료 이용 한도");
    expect(
      analyzeFile({ ...file, content: "// moved\n" + patch.updated }, entries)
        .rules[0].label.ko,
    ).toBe("무료 이용 한도");
  });
  it("does not transfer a label to another file or a renamed declaration", () => {
    expect(
      analyzeFile({ ...file, path: "other.ts" }, glossary()).rules[0].label.ko,
    ).not.toBe("무료 이용 한도");
    expect(
      analyzeFile(
        { ...file, content: file.content.replaceAll("cutoff", "cap") },
        glossary(),
      ).rules[0].label.ko,
    ).not.toBe("무료 이용 한도");
  });
  it("omits duplicate declarations from editable terms", () => {
    const f = { ...file, content: "var cutoff=1; var cutoff=2;" };
    expect(analyzeFile(f, glossary()).terms).toEqual([]);
  });
  it("only invalidates cached files whose terms changed", () => {
    const project = new ProjectAnalyzer(),
      files = [file, { path: "other.ts", content: "const cutoff=8;" }];
    project.analyze(files);
    expect(project.analyze(files, glossary()).cacheHits).toBe(1);
    expect(project.analyze(files, glossary()).cacheHits).toBe(2);
    expect(project.analyze(files).cacheHits).toBe(1);
  });
  it("preserves the other language when updating and resetting a term", () => {
    const id = term(file, "cutoff").id;
    const updated = updateGlossary(
      glossary(),
      file.path,
      id,
      "ko",
      "  월 한도  ",
    );
    expect(updated.find((e) => e.symbolId === id)?.labels).toEqual({
      ko: "월 한도",
      en: "free allowance",
    });
    const reset = updateGlossary(updated, file.path, id, "ko", "");
    expect(reset.find((e) => e.symbolId === id)?.labels).toEqual({
      en: "free allowance",
    });
  });
  it.each(["x\ny", "x\u202ey", "x".repeat(81)])(
    "rejects misleading or overlong labels",
    (value) => {
      expect(() => updateGlossary([], file.path, "id", "ko", value)).toThrow();
    },
  );
  it("validates persisted data and caps its size", () => {
    expect(normalizeGlossary(undefined)).toEqual([]);
    expect(() => normalizeGlossary({})).toThrow();
    expect(() => normalizeGlossary(Array(501).fill(glossary()[0]))).toThrow();
  });
});
