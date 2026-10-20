import ts from "typescript";
import { expression } from "../core/analyze";
import type { ConnectionSite, StructureEdge } from "./model";

const clip = (text: string, limit = 240) =>
  text.length > limit ? text.slice(0, limit) + "…" : text;
const unwrap = (node: ts.Node): ts.Node => {
  let current = node;
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent))
  )
    current = current.parent;
  return current;
};
function optionalCall(node: ts.CallExpression) {
  let part: ts.Node = node;
  while (
    ts.isCallExpression(part) ||
    ts.isPropertyAccessExpression(part) ||
    ts.isElementAccessExpression(part)
  ) {
    if (part.questionDotToken) return true;
    part = part.expression;
  }
  return false;
}

/** Describe the syntax around a single occurrence, stopping at the nearest function.
 * Evidence nodes are hashed separately without display truncation or source offsets. */
export function connectionSite(
  kind: StructureEdge["kind"],
  location: ts.Node,
  signature?: ts.SignatureDeclaration,
): { site: ConnectionSite; evidence: (ts.Node | string)[] } {
  const sf = location.getSourceFile();
  // Resolved parameters can belong to a different file than the call site.
  const code = (node: ts.Node) => clip(node.getText(node.getSourceFile()));
  const describe = (node: ts.Node) =>
    node.getWidth(sf) > 1000
      ? "긴 표현입니다. 원문에서 확인하세요."
      : clip(expression(node, sf, "ko"), 400);
  const site: ConnectionSite = {
    summary: "모듈 선언을 가져오거나 다시 내보내는 위치입니다.",
    code: code(location),
    inputs: [],
    contexts: [],
    omittedInputs: 0,
    omittedContexts: 0,
  };
  const evidence: (ts.Node | string)[] = [kind, location];
  const input = (
    label: string,
    node: ts.Node,
    description = describe(node),
  ) => {
    if (site.inputs.length < 12)
      site.inputs.push({ label, code: code(node), description });
    else site.omittedInputs++;
  };
  const context = (
    description: string,
    node: ts.Node,
    identity = description,
  ) => {
    evidence.push(identity, node);
    if (site.contexts.length < 8)
      site.contexts.push({
        description,
        code: code(node),
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
    else site.omittedContexts++;
  };
  if (
    kind === "calls" &&
    (ts.isCallExpression(location) || ts.isNewExpression(location))
  ) {
    site.summary = `${code(location.expression)}${ts.isNewExpression(location) ? " 객체를 만드는" : "에 값을 전달해 호출하는"} 위치입니다.`;
    let spread = false;
    for (const [index, argument] of (location.arguments ?? []).entries()) {
      const parameters = signature?.parameters;
      const parameter =
        parameters?.[index] ??
        (parameters?.at(-1)?.dotDotDotToken ? parameters.at(-1) : undefined);
      const expanded = ts.isSpreadElement(argument);
      const name =
        !spread && !expanded && parameter
          ? ` → ${code(parameter.name)}${parameter.dotDotDotToken ? " (나머지 인수)" : ""}`
          : "";
      input(
        spread || expanded
          ? `코드상 ${index + 1}번째 전달 항목`
          : `${index + 1}번째 인수${name}`,
        argument,
        expanded
          ? "값을 펼쳐 전달합니다. 실제 개수와 이후 인수의 대응은 여기서 확정하지 않습니다."
          : describe(argument),
      );
      spread ||= expanded;
    }
    if (ts.isCallExpression(location) && optionalCall(location))
      context(
        "선택적 호출·접근입니다. 앞값이 null 또는 undefined이면 호출을 건너뛸 수 있습니다.",
        location.expression,
        "optional-call",
      );
    let result = unwrap(location);
    if (result.parent && ts.isAwaitExpression(result.parent)) {
      site.result = "이 호출 결과를 await로 기다립니다.";
      result = unwrap(result.parent);
    }
    if (result.parent && ts.isReturnStatement(result.parent))
      site.result =
        `${site.result ?? ""} 이 표현의 결과를 현재 함수에서 반환합니다.`.trim();
    else if (
      result.parent &&
      ts.isVariableDeclaration(result.parent) &&
      result.parent.initializer === result
    )
      site.result =
        `${site.result ?? ""} 결과를 ${code(result.parent.name)}에 담습니다.`.trim();
    evidence.push(site.result ?? "");
  } else if (kind === "passes") {
    const parent = location.parent;
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent))) {
      const index =
        parent.arguments?.findIndex((argument) => argument === location) ?? -1;
      const followsSpread = parent.arguments
        ?.slice(0, index)
        .some(ts.isSpreadElement);
      site.summary = followsSpread
        ? `${code(parent.expression)}의 펼친 인수 뒤에 함수 값을 넘깁니다. 실제 인수 위치는 별도 확인이 필요합니다.`
        : `${code(parent.expression)}의 ${index + 1}번째 인수로 함수 값을 넘깁니다.`;
      site.code = code(parent);
      evidence.push(parent);
    } else if (
      parent &&
      ts.isJsxExpression(parent) &&
      ts.isJsxAttribute(parent.parent)
    ) {
      site.summary = `${code(parent.parent.name)} 화면 속성으로 함수 값을 넘깁니다.`;
      site.code = code(parent.parent);
      evidence.push(parent.parent);
    } else site.summary = "함수 값을 전달하는 위치입니다.";
    input("전달하는 함수", location);
  } else if (
    kind === "renders" &&
    (ts.isJsxOpeningElement(location) || ts.isJsxSelfClosingElement(location))
  ) {
    site.summary = `${code(location.tagName)} 화면 요소에 속성을 전달합니다.`;
    for (const property of location.attributes.properties) {
      if (ts.isJsxSpreadAttribute(property))
        input(
          "펼쳐 전달하는 속성",
          property.expression,
          "객체의 속성을 펼쳐 전달합니다. 겹치는 속성의 최종 값은 별도 확인이 필요합니다.",
        );
      else if (!property.initializer) {
        if (site.inputs.length < 12)
          site.inputs.push({
            label: code(property.name),
            code: "true",
            description: "참 값을 전달합니다.",
          });
        else site.omittedInputs++;
      } else {
        const value = ts.isJsxExpression(property.initializer)
          ? property.initializer.expression
          : property.initializer;
        if (value) input(code(property.name), value);
      }
    }
  }
  let child = location;
  for (
    let parent = child.parent;
    parent;
    child = parent, parent = parent.parent
  ) {
    if (ts.isFunctionLike(parent)) break;
    if (ts.isIfStatement(parent)) {
      if (child === parent.thenStatement)
        context(
          "이 if 조건이 참으로 평가되는 분기 안입니다.",
          parent.expression,
          "if:true",
        );
      else if (child === parent.elseStatement)
        context(
          "이 if 조건이 거짓으로 평가되는 else 분기 안입니다.",
          parent.expression,
          "if:false",
        );
      else if (child === parent.expression)
        context(
          "이 위치는 if 조건식 자체를 계산하는 부분 안에 있습니다.",
          parent.expression,
          "if:test",
        );
    } else if (ts.isConditionalExpression(parent)) {
      if (child === parent.whenTrue)
        context(
          "이 조건식의 참 분기 안입니다.",
          parent.condition,
          "conditional:true",
        );
      else if (child === parent.whenFalse)
        context(
          "이 조건식의 거짓 분기 안입니다.",
          parent.condition,
          "conditional:false",
        );
    } else if (ts.isBinaryExpression(parent) && child === parent.right) {
      const operator = parent.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken)
        context(
          "왼쪽 값이 참으로 평가될 때 계산하는 && 오른쪽 식입니다.",
          parent.left,
          "and:right",
        );
      if (operator === ts.SyntaxKind.BarBarToken)
        context(
          "왼쪽 값이 거짓으로 평가될 때 계산하는 || 오른쪽 식입니다.",
          parent.left,
          "or:right",
        );
      if (operator === ts.SyntaxKind.QuestionQuestionToken)
        context(
          "왼쪽 값이 null 또는 undefined일 때 계산하는 ?? 오른쪽 식입니다.",
          parent.left,
          "nullish:right",
        );
    } else if (
      (ts.isForStatement(parent) ||
        ts.isWhileStatement(parent) ||
        ts.isDoStatement(parent)) &&
      child === parent.statement
    ) {
      const condition = ts.isForStatement(parent)
        ? parent.condition
        : parent.expression;
      if (condition)
        context(
          ts.isDoStatement(parent)
            ? "do 반복 본문입니다. 첫 실행은 이 조건 검사보다 앞섭니다."
            : "이 조건을 검사하는 반복문의 본문 안입니다.",
          condition,
          ts.isDoStatement(parent) ? "do:body" : "loop:body",
        );
    } else if (
      (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
      child === parent.statement
    ) {
      context(
        "이 대상을 순회하는 반복문의 본문 안입니다.",
        parent.expression,
        ts.isForOfStatement(parent) ? "for-of:body" : "for-in:body",
      );
    } else if (ts.isTryStatement(parent)) {
      if (child === parent.tryBlock) {
        evidence.push("try:body");
        if (parent.catchClause)
          context(
            "주변 try에 catch 처리가 있습니다. 기다리지 않는 비동기 실패까지 잡힌다는 뜻은 아닙니다.",
            parent.catchClause,
            "try:catch",
          );
        if (parent.finallyBlock)
          context(
            "주변 try에 finally 처리가 있습니다.",
            parent.finallyBlock,
            "try:finally",
          );
      } else if (child === parent.finallyBlock)
        context(
          "finally 처리 블록 안입니다.",
          parent.finallyBlock,
          "finally:body",
        );
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      const statement = parent.parent.parent;
      if (ts.isSwitchStatement(statement)) {
        context(
          ts.isCaseClause(parent)
            ? child === parent.expression
              ? "이 case의 비교 값을 계산하는 부분입니다."
              : "이 case 절 안입니다. 앞 case에서 내려오는 실행도 있을 수 있습니다."
            : "default 절 안입니다. 앞 case에서 내려오는 실행도 있을 수 있습니다.",
          ts.isCaseClause(parent) ? parent.expression : statement.expression,
          ts.isCaseClause(parent) ? "switch:case" : "switch:default",
        );
        context(
          "이 값을 분기 대상으로 사용하는 switch 안입니다.",
          statement.expression,
          "switch:subject",
        );
      }
    } else if (ts.isCatchClause(parent)) {
      // Keep the catch boundary, but do not include the caller's surrounding try as a guard.
      evidence.push("catch:body");
      context(
        "오류를 받은 catch 처리 안입니다.",
        parent.variableDeclaration ?? parent,
        "catch:body",
      );
    } else if (
      ts.isCallExpression(parent) &&
      parent.arguments.includes(child as ts.Expression) &&
      optionalCall(parent)
    ) {
      context(
        "선택적 호출의 인수 안입니다. 바깥 호출을 건너뛰면 이 인수도 계산하지 않습니다.",
        parent.expression,
        "optional:argument",
      );
    }
  }
  site.contexts.reverse();
  return { site, evidence };
}
