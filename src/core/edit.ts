import { analyzeFile, diagnostics, parse } from "./analyze";
import { operators } from "./labels";
import { words, type Patch, type Rule, type SourceFile } from "./types";
export function makePatch(
  file: SourceFile,
  ruleId: string,
  input: string,
): Patch {
  const a = analyzeFile(file);
  if (!a.syntaxValid)
    throw Error(
      "먼저 원본의 문법 오류를 해결해 주세요. / Fix syntax errors first.",
    );
  const r = a.rules.find((x) => x.id === ruleId);
  if (!r)
    throw Error("규칙이 바뀌었습니다. 다시 선택해 주세요. / Rule is stale.");
  let value: string;
  if (r.type === "number") {
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.trim()) ||
      !Number.isFinite(Number(input))
    )
      throw Error(
        "유한한 숫자를 입력해 주세요. 예: 70000, 0.15 / Enter a finite number.",
      );
    value = String(Number(input));
  } else if (r.type === "boolean") {
    if (!["true", "false"].includes(input))
      throw Error("true 또는 false만 가능합니다.");
    value = input;
  } else if (r.type === "operator") {
    if (!operators[input]) throw Error("지원하지 않는 비교 방식입니다.");
    value = input;
  } else value = JSON.stringify(input);
  if (value === r.raw) throw Error("현재 값과 같습니다. / No change.");
  const updated =
    file.content.slice(0, r.start) + value + file.content.slice(r.end);
  if (diagnostics(parse({ ...file, content: updated })).length)
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
export function parseRequest(
  request: string,
  rules: Rule[],
): { rule: Rule; value: string } {
  const normalized = request.trim();
  const candidates = rules.filter(
    (r) =>
      normalized.toLocaleLowerCase().includes(r.name.toLocaleLowerCase()) ||
      normalized.includes(r.label.ko) ||
      normalized.toLowerCase().includes(r.label.en.toLowerCase()),
  );
  if (candidates.length !== 1)
    throw Error(
      candidates.length
        ? "여러 규칙이 해당됩니다. 표에서 하나를 선택해 주세요. / Choose one matching rule in the table."
        : "규칙 이름을 정확히 넣어 주세요. 예: 무료 배송 기준을 70000으로 변경 / Include a rule name.",
    );
  const rule = candidates[0];
  let rest = normalized;
  for (const n of [rule.name, rule.label.ko, rule.label.en].sort(
    (a, b) => b.length - a.length,
  )) {
    const i = rest.toLowerCase().indexOf(n.toLowerCase());
    if (i >= 0) {
      rest = rest.slice(0, i) + rest.slice(i + n.length);
      break;
    }
  }
  if (rule.type === "string") {
    const quoted = rest.match(/"((?:[^"\\]|\\.)*)"/g);
    if (!quoted || quoted.length !== 1)
      throw Error(
        "새 문구 하나를 큰따옴표로 감싸 주세요. / Quote one new string.",
      );
    return { rule, value: JSON.parse(quoted[0]) };
  }
  if (rule.type === "boolean") {
    const yes = /\btrue\b|켜기|(?<!비)활성화/.test(rest),
      no = /\bfalse\b|끄기|비활성화/.test(rest);
    if (yes === no) throw Error("true 또는 false 중 하나를 적어 주세요.");
    return { rule, value: yes ? "true" : "false" };
  }
  if (rule.type === "operator") {
    const symbolic = rest.match(/===|!==|>=|<=|==|!=|>|</g) || [];
    const matches = symbolic.length
      ? symbolic
      : Object.entries(operators)
          .filter(([, ds]) => ds.some((d) => rest.includes(d)))
          .map(([op]) => op);
    if (matches.length !== 1)
      throw Error(
        "표에서 비교 방식을 직접 선택해 주세요. / Select a comparison in the table.",
      );
    return { rule, value: matches[0] };
  }
  if (/%|퍼센트|percent|\d\s*만|\d\s*천|\d,\d/.test(rest))
    throw Error(
      "단위 없이 숫자를 적어 주세요. 7만 → 70000, 15% → 0.15 / Use plain numbers.",
    );
  const numbers = rest.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi);
  if (numbers?.length !== 1)
    throw Error("새 값 하나만 적어 주세요. / Provide exactly one new value.");
  return { rule, value: numbers[0] };
}
