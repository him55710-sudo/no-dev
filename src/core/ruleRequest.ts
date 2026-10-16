import { operators } from "./labels";
import type { Rule } from "./types";
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
    if (rule.syntax === "python") rest = rest.toLowerCase();
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
  const numbers =
    rule.syntax === "python"
      ? rest.match(
          /(?<![\w.])[+-]?(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?)(?![\w.])/g,
        )
      : rest.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi);
  if (numbers?.length !== 1)
    throw Error("새 값 하나만 적어 주세요. / Provide exactly one new value.");
  return { rule, value: numbers[0] };
}
