import ts from "typescript";
import type { FunctionInfo } from "../core/types";
import { iterStoryLines } from "../core/storyReport";

const unwrap = (node: ts.Expression): ts.Expression => {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
};
const inlineFunction = (node: ts.Node) =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** A bounded reading of syntax, not a claim that wrappers execute a callback. */
export function symbolDescription(
  node: ts.Node,
  functions: ReadonlyMap<number, FunctionInfo>,
  checker: ts.TypeChecker,
  syntacticRole: string,
): { role: string; summary: string } {
  const sf = node.getSourceFile();
  const short = (text: string, limit = 200) =>
    text.length > limit ? text.slice(0, limit) + "…" : text;
  const code = (value: ts.Node) => short(value.getText(value.getSourceFile()));
  const initializer =
    ts.isVariableDeclaration(node) && node.initializer
      ? unwrap(node.initializer)
      : undefined;
  const direct =
    initializer && inlineFunction(initializer) ? initializer : node;
  const fn = functions.get(direct.getStart(sf));
  const valueType = ts.isVariableDeclaration(node)
    ? checker.getTypeAtLocation(node.name)
    : undefined;
  const callable =
    !!valueType &&
    checker.getSignaturesOfType(valueType, ts.SignatureKind.Call).length > 0;
  const role = fn || callable ? "function" : syntacticRole;
  const lines: string[] = [];
  let omitted = false;
  let used = 0;
  const append = (line: string) => {
    if (omitted) return;
    const clipped = short(line, 600);
    if (lines.length >= 40 || used + clipped.length > 5500) {
      omitted = true;
      return;
    }
    lines.push(clipped);
    used += clipped.length;
  };
  const body = (value: FunctionInfo, depth = 0) => {
    append(
      `${"  ".repeat(depth)}받는 값: ${value.params.length ? value.params.map((p) => short(p.name, 80)).join(", ") : "없음"}`,
    );
    // Source line numbers remain in SourceRef. Exclude them from descriptions so
    // moving unchanged code does not manufacture a new behavioral explanation.
    for (const line of iterStoryLines(value.steps, "ko")) {
      append("  ".repeat(depth) + line.replace(/^(\s*)- L\d+: /, "$1- "));
      if (omitted) break;
    }
    if (!value.steps.length)
      append(`${"  ".repeat(depth)}본문에 처리 구문이 없습니다.`);
  };
  if (fn) {
    append(
      fn.async
        ? "비동기 함수의 본문입니다. 호출된 경우의 처리 구문을 읽습니다."
        : "함수의 본문입니다. 호출된 경우의 처리 구문을 읽습니다.",
    );
    body(fn);
  } else if (
    initializer &&
    (ts.isCallExpression(initializer) || ts.isNewExpression(initializer))
  ) {
    append(
      `「${code(initializer.expression)}」${ts.isNewExpression(initializer) ? "로 객체를 만든" : "을(를) 호출한"} 결과를 보관하는 선언입니다.`,
    );
    if (callable)
      append(
        "정적 타입에서 호출 가능한 함수 값으로 확인했습니다. 생성 호출과 이후 함수 실행은 별개입니다.",
      );
    else if (
      valueType &&
      valueType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)
    )
      append(
        "호출 결과의 타입은 미확인입니다. 반환값이 함수라고 단정하지 않습니다.",
      );
  } else if (callable && initializer) {
    append(
      `「${code(initializer)}」 표현의 값을 보관합니다. 정적 타입에서 호출 가능한 함수 값으로 확인했습니다. 본문은 이 표현이 가리키는 원래 선언에서 확인하세요.`,
    );
  } else {
    return {
      role,
      summary: `${role} 선언입니다. 코드만으로 업무 목적이나 작성 의도를 확정하지 않습니다.`,
    };
  }

  const root =
    fn &&
    (ts.isFunctionDeclaration(direct) ||
      ts.isMethodDeclaration(direct) ||
      inlineFunction(direct))
      ? direct.body
      : initializer;
  // Explain only explicit function arguments and returned functions at this
  // level. Never flatten a nested callback's contents into its parent's steps.
  const visit = (current: ts.Node) => {
    if (omitted) return;
    if (inlineFunction(current)) {
      let value: ts.Node = current;
      while (
        value.parent &&
        ts.isExpression(value.parent) &&
        unwrap(value.parent) === current
      )
        value = value.parent;
      const parent = value.parent;
      let title: string | undefined;
      if (
        parent &&
        (ts.isCallExpression(parent) || ts.isNewExpression(parent))
      ) {
        const index = parent.arguments?.findIndex((arg) => arg === value) ?? -1;
        if (index >= 0)
          title = `「${code(parent.expression)}」에 넘기는 함수 본문 · 코드상 ${index + 1}번째 전달 항목`;
      } else if (parent && ts.isReturnStatement(parent)) {
        title = "반환하는 함수의 본문";
      } else if (
        parent &&
        ts.isArrowFunction(parent) &&
        parent.body === value
      ) {
        title = "반환하는 함수의 본문";
      }
      const nested = functions.get(current.getStart(sf));
      if (title && nested) {
        append("");
        append(`${title}. 실행 시점·호출 횟수는 받는 쪽 구현에서 확인하세요.`);
        body(nested, 1);
      }
      return;
    }
    if (ts.isFunctionLike(current)) return;
    ts.forEachChild(current, visit);
  };
  if (root) visit(root);
  if (omitted) lines.push("… 남은 처리 설명은 원문에서 확인하세요.");
  return { role, summary: lines.join("\n") };
}
