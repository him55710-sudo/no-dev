import { analyzeFile, diagnostics, parse } from "./analyze";
import { operators } from "./labels";
import { words, type Patch, type SourceFile } from "./types";
import type { GlossaryEntry } from "./glossary";
import { readJsonStructure, jsonDataLimits } from "./jsonData";
import { webReplacement } from "./webSource";
export function makePatch(
  file: SourceFile,
  ruleId: string,
  input: string,
  glossary: GlossaryEntry[] = [],
): Patch {
  const a = analyzeFile(file, glossary);
  if (!a.syntaxValid)
    throw Error(
      "먼저 원본의 문법 오류를 해결해 주세요. / Fix syntax errors first.",
    );
  const r = a.rules.find((x) => x.id === ruleId);
  if (!r)
    throw Error("규칙이 바뀌었습니다. 다시 선택해 주세요. / Rule is stale.");
  if (r.syntax === "json" && input.length > jsonDataLimits.editable)
    throw Error(
      "값은 4096자 이내로 입력해 주세요. / Enter a value up to 4096 characters.",
    );
  let value: string;
  if (a.web) {
    value = webReplacement(r, input);
  } else if (r.type === "number") {
    if (r.syntax === "json") {
      // Preserve numeric lexemes, including integers outside JS's safe range.
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input.trim()))
        throw Error(
          "JSON 숫자 표기로 입력해 주세요. / Enter a valid JSON number.",
        );
      value = input.trim();
    } else {
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.trim()) ||
        !Number.isFinite(Number(input))
      )
        throw Error(
          "유한한 숫자를 입력해 주세요. 예: 70000, 0.15 / Enter a finite number.",
        );
      value = String(Number(input));
    }
  } else if (r.type === "boolean") {
    if (!["true", "false"].includes(input))
      throw Error("true 또는 false만 가능합니다.");
    value = input;
  } else if (r.type === "operator") {
    if (!operators[input]) throw Error("지원하지 않는 비교 방식입니다.");
    value = input;
  } else {
    if (input === r.value) throw Error("현재 값과 같습니다. / No change.");
    value = JSON.stringify(input);
    if (r.syntax === "jsxText" || r.syntax === "jsxAttribute")
      value = `{${value}}`;
  }
  if (value === r.raw) throw Error("현재 값과 같습니다. / No change.");
  const updated =
    file.content.slice(0, r.start) + value + file.content.slice(r.end);
  if (a.web) {
    if (!analyzeFile({ ...file, content: updated }).syntaxValid)
      throw Error("변경 후 원문을 읽을 수 없습니다. / Invalid updated source.");
  } else if (r.syntax === "json") {
    readJsonStructure(updated, /\.jsonc$/i.test(file.path));
  } else if (diagnostics(parse({ ...file, content: updated })).length)
    throw Error(
      "변경 후 문법 오류가 발견되어 적용할 수 없습니다. / Invalid syntax.",
    );
  return {
    path: file.path,
    ruleId,
    start: r.start,
    end: r.end,
    oldText: r.raw,
    newText: value,
    original: file.content,
    updated,
    description: words(
      `${r.label.ko}: ${r.raw} → ${value}`,
      `${r.label.en}: ${r.raw} → ${value}`,
    ),
    semanticChecked: false,
  };
}
export function applyPatch(file: SourceFile, patch: Patch) {
  if (
    file.path !== patch.path ||
    file.content !== patch.original ||
    file.content.slice(patch.start, patch.end) !== patch.oldText
  )
    throw Error(
      "미리보기 이후 파일이 변경되었습니다. 변경안을 다시 만들어 주세요. / Stale patch.",
    );
  return { ...file, content: patch.updated };
}
export { parseRequest } from "./ruleRequest";
