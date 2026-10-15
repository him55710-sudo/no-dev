import ts from "typescript";
import {
  words,
  type Anchor,
  type InterfaceNode,
  type InterfaceStructure,
  type Rule,
  type Words,
} from "./types";

const isMarkup = (n: ts.Node) =>
  ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n);
const roles: Record<string, Words> = {
  button: words("버튼", "Button"),
  input: words("입력란", "Input"),
  textarea: words("여러 줄 입력란", "Text area"),
  a: words("링크", "Link"),
  form: words("입력 양식", "Form"),
  img: words("이미지", "Image"),
  p: words("문단", "Paragraph"),
  label: words("입력란 이름", "Field label"),
  ul: words("목록", "List"),
  ol: words("순서 있는 목록", "Ordered list"),
  li: words("목록 항목", "List item"),
  h1: words("큰 제목", "Main heading"),
  h2: words("제목", "Heading"),
  h3: words("작은 제목", "Subheading"),
  section: words("구역", "Section"),
  nav: words("탐색 영역", "Navigation"),
  select: words("선택란", "Select"),
};

// Compile bounded literal probes, then read emitted literals as data. Never execute
// source, imports, emitted code or component functions. This matches TypeScript's
// JSX entity decoding and whitespace normalization without an approximate decoder.
function decodedLiterals(sf: ts.SourceFile) {
  const nodes: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (nodes.length >= 500) return;
    if (
      (ts.isJsxText(n) && !n.containsOnlyTriviaWhiteSpaces) ||
      (ts.isStringLiteral(n) && ts.isJsxAttribute(n.parent))
    )
      nodes.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  const values = new Map<ts.Node, string>();
  if (!nodes.length) return values;
  const probes = nodes.map((n) =>
    ts.isJsxText(n)
      ? `<span>${sf.text.slice(n.pos, n.end)}</span>`
      : `<span title=${n.getText(sf)}/>`,
  );
  const emitted = ts.transpileModule(`const probes = [${probes.join(",")}];`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ESNext },
    fileName: "literal-probes.tsx",
  }).outputText;
  const output = ts.createSourceFile(
    "literal-probes.js",
    emitted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const statement = output.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return values;
  const array = statement.declarationList.declarations[0]?.initializer;
  if (
    !array ||
    !ts.isArrayLiteralExpression(array) ||
    array.elements.length !== nodes.length
  )
    return values;
  array.elements.forEach((call, i) => {
    if (!ts.isCallExpression(call)) return;
    let value: ts.Node | undefined;
    if (ts.isJsxText(nodes[i])) value = call.arguments[2];
    else {
      const props = call.arguments[1];
      if (props && ts.isObjectLiteralExpression(props)) {
        const prop = props.properties[0];
        if (prop && ts.isPropertyAssignment(prop)) value = prop.initializer;
      }
    }
    if (value && ts.isStringLiteral(value)) values.set(nodes[i], value.text);
  });
  return values;
}

export function analyzeInterface(
  sf: ts.SourceFile,
  describe: (n: ts.Node) => Words,
): {
  structure: InterfaceStructure;
  rules: Rule[];
  contains: (n: ts.Node) => boolean;
} {
  const contains = new WeakMap<ts.Node, boolean>();
  const mark = (n: ts.Node): boolean => {
    let found = isMarkup(n);
    ts.forEachChild(n, (child) => {
      if (mark(child)) found = true;
    });
    contains.set(n, found);
    return found;
  };
  const structure: InterfaceStructure = { roots: [], truncated: false };
  const rules: Rule[] = [];
  mark(sf);
  const has = (n: ts.Node) => contains.get(n) === true;
  if (!has(sf)) return { structure, rules, contains: has };
  const decoded = decodedLiterals(sf);
  let count = 0;
  const at = (n: ts.Node): Anchor => {
    const start = ts.isJsxText(n) ? n.pos : n.getStart(sf);
    return {
      start,
      end: n.end,
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
      endLine: sf.getLineAndCharacterOfPosition(n.end).line + 1,
    };
  };
  const node = (
    n: ts.Node,
    kind: InterfaceNode["kind"],
    title: Words,
    extra: Partial<InterfaceNode> = {},
  ): InterfaceNode => ({
    ...at(n),
    id: `ui:${n.pos}:${kind}:${count++}`,
    kind,
    title,
    children: [],
    ...extra,
  });
  const code = (n: ts.Node) => n.getText(sf).slice(0, 180);
  function editable(
    n: ts.Node,
    value: string | number | boolean,
    title: Words,
    syntax?: Rule["syntax"],
  ) {
    const a = at(n);
    const id = `jsx:${a.start}`;
    rules.push({
      ...a,
      id,
      name: `jsxText@${a.line}:${a.start}`,
      label: title,
      value,
      type: typeof value as Rule["type"],
      scope: "JSX",
      raw: sf.text.slice(a.start, a.end),
      syntax,
      note: words(
        "화면 코드의 값입니다. 실제 표시 여부와 디자인은 실행 환경에서 확인하세요.",
        "A value in interface source. Verify visibility and styling in the running app.",
      ),
    });
    return id;
  }
  function literal(n: ts.Node, title?: Words): InterfaceNode | undefined {
    let value: string | number | boolean | undefined;
    let syntax: Rule["syntax"];
    if (ts.isJsxText(n)) {
      value = decoded.get(n);
      syntax = "jsxText";
    } else if (ts.isStringLiteral(n) && ts.isJsxAttribute(n.parent)) {
      value = decoded.get(n);
      syntax = "jsxAttribute";
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
      value = n.text;
    else if (ts.isNumericLiteral(n)) value = Number(n.text);
    else if (
      n.kind === ts.SyntaxKind.TrueKeyword ||
      n.kind === ts.SyntaxKind.FalseKeyword
    )
      value = n.kind === ts.SyntaxKind.TrueKeyword;
    if (value === undefined) return;
    const text = String(value);
    const name =
      title ||
      words(`문구: “${text.slice(0, 80)}”`, `Text: “${text.slice(0, 80)}”`);
    return node(n, "text", name, {
      detail: words(text, text),
      ruleId: editable(n, value, name, syntax),
    });
  }
  function build(n: ts.Node, depth = 0): InterfaceNode | undefined {
    if (count >= 300 || depth > 12) {
      structure.truncated = true;
      return;
    }
    const child = (x: ts.Node) => build(x, depth + 1);
    const children = (list: readonly ts.Node[]) =>
      list.map(child).filter((x): x is InterfaceNode => !!x);
    if (ts.isJsxExpression(n))
      return n.expression ? child(n.expression) : undefined;
    if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isSatisfiesExpression(n)
    )
      return child(n.expression);
    if (ts.isJsxText(n) && n.containsOnlyTriviaWhiteSpaces) return;
    const text = literal(n);
    if (text) return text;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const opening = ts.isJsxElement(n) ? n.openingElement : n;
      const tag = opening.tagName.getText(sf);
      const custom = !/^[a-z][\w-]*$/.test(tag);
      const root = node(
        n,
        custom ? "component" : "element",
        custom
          ? words(`컴포넌트 ${tag}`, `Component ${tag}`)
          : roles[tag] || words("화면 요소", "Element"),
        {
          code: `<${tag}>`,
          detail: custom
            ? words(
                "전달된 속성과 자식만 표시합니다. 실제 내용은 컴포넌트 정의에서 확인하세요.",
                "Shows passed props and children. See the component definition for its contents.",
              )
            : undefined,
        },
      );
      root.children = children(opening.attributes.properties);
      if (ts.isJsxElement(n)) root.children.push(...children(n.children));
      return root;
    }
    if (ts.isJsxFragment(n))
      return node(n, "fragment", words("요소 묶음", "Fragment"), {
        children: children(n.children),
      });
    if (ts.isJsxSpreadAttribute(n))
      return node(
        n,
        "attribute",
        words("묶음으로 전달하는 속성", "Spread props"),
        {
          code: code(n),
          detail: words(
            "속성 이름과 값은 실행 시 결정됩니다. 앞의 속성을 덮어쓸 수 있습니다.",
            "Names and values depend on runtime data and may override earlier props.",
          ),
        },
      );
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(sf);
      const title = words(`속성 ${name}`, `Prop ${name}`);
      const root = node(n, "attribute", title);
      if (!n.initializer) {
        root.detail = words("true를 전달합니다.", "Passes true.");
        return root;
      }
      let value = ts.isJsxExpression(n.initializer)
        ? n.initializer.expression
        : n.initializer;
      if (!value) return root;
      while (
        ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isNonNullExpression(value) ||
        ts.isSatisfiesExpression(value)
      )
        value = value.expression;
      const edit = literal(value, title);
      if (edit) {
        root.ruleId = edit.ruleId;
        root.detail = edit.detail;
        return root;
      }
      root.code = code(value);
      root.detail = describe(value);
      if (/^on[A-Z]/.test(name)) {
        const opening = n.parent.parent;
        const native =
          (ts.isJsxOpeningElement(opening) ||
            ts.isJsxSelfClosingElement(opening)) &&
          /^[a-z][\w-]*$/.test(opening.tagName.getText(sf));
        root.title = words(
          `${native ? "이벤트 속성" : "컴포넌트 속성"} ${name}`,
          `${native ? "Event prop" : "Component prop"} ${name}`,
        );
        root.detail = ts.isCallExpression(value)
          ? words(
              "JSX를 만드는 동안 이 호출을 실행하고, 반환값을 속성으로 전달합니다.",
              "Calls this while constructing JSX and passes its return value as the prop.",
            )
          : ts.isArrowFunction(value) || ts.isFunctionExpression(value)
            ? words(
                "이 함수를 속성으로 전달합니다. 함수 내용은 호출될 때 실행됩니다.",
                "Passes this function as a prop. Its body runs when called.",
              )
            : words(
                "이 값을 속성으로 전달합니다. 연결된 함수의 동작은 정의에서 확인하세요.",
                "Passes this value as a prop. See the referenced function for its behavior.",
              );
      }
      if (has(value)) root.children = children([value]);
      return root;
    }
    if (ts.isConditionalExpression(n)) {
      const condition = describe(n.condition);
      const root = node(
        n,
        "condition",
        words(`조건: ${condition.ko}`, `Condition: ${condition.en}`),
        { code: code(n.condition) },
      );
      root.children = [
        node(n.whenTrue, "branch", words("참으로 평가되면", "When truthy"), {
          children: children([n.whenTrue]),
        }),
        node(n.whenFalse, "branch", words("거짓으로 평가되면", "When falsy"), {
          children: children([n.whenFalse]),
        }),
      ];
      return root;
    }
    if (
      ts.isBinaryExpression(n) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(n.operatorToken.kind)
    ) {
      const op = n.operatorToken.getText(sf);
      const left = describe(n.left);
      return node(
        n,
        "condition",
        words(
          `값 선택 (${op}): ${left.ko}`,
          `Value selection (${op}): ${left.en}`,
        ),
        {
          code: code(n.left),
          detail:
            op === "&&"
              ? words(
                  "왼쪽이 참으로 평가되면 오른쪽을 사용합니다. 아니면 왼쪽 값이 남습니다. 숫자 0은 화면에 표시될 수 있습니다.",
                  "Uses the right value when the left is truthy; otherwise keeps the left. A numeric 0 can appear on screen.",
                )
              : op === "||"
                ? words(
                    "왼쪽이 거짓으로 평가될 때 오른쪽을 사용합니다. 아니면 왼쪽 값을 사용합니다.",
                    "Uses the right value when the left is falsy; otherwise uses the left.",
                  )
                : words(
                    "왼쪽이 null 또는 undefined일 때만 오른쪽을 사용합니다.",
                    "Uses the right value only when the left is null or undefined.",
                  ),
          children: children([n.left, n.right]),
        },
      );
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "map"
    ) {
      const callback = n.arguments[0];
      return node(
        n,
        "iteration",
        words("map 호출로 항목을 만듭니다", "Builds items through a map call"),
        {
          code: code(n.expression.expression),
          detail: words(
            "Array.map을 쓰면 각 항목에 이 함수를 적용합니다. 실제 항목 수와 사용자 정의 map의 동작은 확인하지 않았습니다.",
            "With Array.map, the callback handles each item. Item count and custom map behavior are not determined.",
          ),
          children:
            callback &&
            (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
              ? children([callback.body])
              : [],
        },
      );
    }
    return node(
      n,
      has(n) ? "unknown" : "value",
      has(n)
        ? words(
            "내부 화면 구조는 원문에서 확인하세요",
            "See source for the nested interface structure",
          )
        : words("계산된 값", "Computed value"),
      { code: code(n), detail: describe(n) },
    );
  }
  function roots(n: ts.Node) {
    if (!has(n)) return;
    if (
      isMarkup(n) ||
      ts.isConditionalExpression(n) ||
      (ts.isBinaryExpression(n) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(n.operatorToken.kind)) ||
      (ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "map")
    ) {
      const root = build(n);
      if (root) structure.roots.push(root);
      return;
    }
    ts.forEachChild(n, roots);
  }
  roots(sf);
  return { structure, rules, contains: has };
}
