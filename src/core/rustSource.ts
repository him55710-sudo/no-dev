import type { Node, Parser, Tree } from "web-tree-sitter";
import {
  words,
  type Anchor,
  type FileAnalysis,
  type FunctionInfo,
  type Patch,
  type Rule,
  type SourceFile,
  type Step,
} from "./types";

export const RUST_GRAMMAR_VERSION = "tree-sitter-rust 0.24.2";
export const RUST_LIMITS = {
  bytes: 128 * 1024,
  output: 2 * 1024 * 1024,
  steps: 400,
  functions: 100,
  parameters: 100,
  rules: 300,
  depth: 16,
  nodes: 20000,
  value: 4096,
};
const opaque = new Set([
  "macro_invocation",
  "macro_definition",
  "token_tree",
  "attribute_item",
  "inner_attribute_item",
]);
const field = (n: Node, name: string) => n.childForFieldName(name);
const short = (text: string) =>
  text.length > 400 ? `${text.slice(0, 400)}…` : text;
const code = (n: Node | null) => (n ? short(n.text) : "");
const comments = (n: Node) =>
  n.type === "line_comment" || n.type === "block_comment";

/** Rust UTF-8 strings only: byte/C strings and chars have different semantics. */
export function decodeRustString(raw: string): string | undefined {
  const r = /^r(#{0,255})"([\s\S]*)"\1$/.exec(raw);
  if (r) return r[2].replace(/\r\n/g, "\n");
  if (!raw.startsWith('"') || !raw.endsWith('"')) return;
  const body = raw.slice(1, -1).replace(/\r\n/g, "\n");
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const escape = body[++i];
    const simple: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      "0": "\0",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (Object.hasOwn(simple, escape)) out += simple[escape];
    else if (escape === "\n") {
      while (/[ \t\n\r]/.test(body[i + 1] || "!")) i++;
    } else if (escape === "x") {
      const digits = body.slice(i + 1, i + 3);
      if (!/^[0-7][\da-f]$/i.test(digits)) return;
      out += String.fromCharCode(parseInt(digits, 16));
      i += 2;
    } else if (escape === "u") {
      const match = /^\{([\da-f][\da-f_]*)\}/i.exec(body.slice(i + 1));
      if (!match) return;
      const digits = match[1].replaceAll("_", "");
      const value = parseInt(digits, 16);
      if (
        digits.length > 6 ||
        value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)
      )
        return;
      out += String.fromCodePoint(value);
      i += match[0].length;
    } else return;
  }
  return out;
}

function encodeString(value: string, original: string): string {
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw Error(
      "유효한 유니코드 문자열이 필요합니다. / Invalid Unicode string.",
    );
  if (original.startsWith("r") && !value.includes("\r")) {
    let hashes = /^r(#+)?"/.exec(original)?.[1] || "";
    while (value.includes(`"${hashes}`)) hashes += "#";
    if (hashes.length <= 255) return `r${hashes}"${value}"${hashes}`;
  }
  let result = '"';
  for (const c of value) {
    const escape: Record<string, string> = {
      '"': '\\"',
      "\\": "\\\\",
      "\n": "\\n",
      "\r": "\\r",
      "\t": "\\t",
      "\0": "\\0",
    };
    result +=
      escape[c] ??
      (c.codePointAt(0)! < 32 || c === "\x7f"
        ? `\\u{${c.codePointAt(0)!.toString(16)}}`
        : c);
  }
  return result + '"';
}

function lineStarts(source: string) {
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g))
    starts.push(match.index + match[0].length);
  return starts;
}
function lineAt(starts: number[], offset: number) {
  let low = 0,
    high = starts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid;
  }
  return low + 1;
}

export function parseRust(parser: Parser, source: string): Tree {
  if (new TextEncoder().encode(source).length > RUST_LIMITS.bytes)
    throw Error(
      "Rust 원문은 최대 128 KiB입니다. / Rust source exceeds 128 KiB.",
    );
  const started = Date.now();
  const tree = parser.parse(source, null, {
    progressCallback: () => Date.now() - started > 2000,
  });
  if (!tree) {
    parser.reset();
    throw Error("Rust 파싱 시간 한도를 넘었습니다. / Rust parsing timed out.");
  }
  return tree;
}

export function readRustTree(file: SourceFile, tree: Tree): FileAnalysis {
  const source = file.content,
    starts = lineStarts(source);
  const analysis: FileAnalysis = {
    path: file.path,
    kind: "script",
    lines: starts.length,
    functions: [],
    rules: [],
    imports: [],
    issues: [],
    steps: [],
    explained: 0,
    total: 0,
    syntaxValid: !tree.rootNode.hasError,
    rust: { version: RUST_GRAMMAR_VERSION, truncated: false },
  };
  const anchor = (node: Node): Anchor => ({
    start: node.startIndex,
    end: node.endIndex,
    line: lineAt(starts, node.startIndex),
    endLine: lineAt(starts, Math.max(node.startIndex, node.endIndex - 1)),
  });
  const truncate = () => {
    analysis.rust!.truncated = true;
  };
  if (!analysis.syntaxValid) {
    // ERROR and missing nodes are both included in hasError. Do not offer edits
    // or invented structure from a recovered, incomplete syntax tree.
    const stack = [tree.rootNode];
    let count = 0;
    while (
      stack.length &&
      count++ < RUST_LIMITS.nodes &&
      analysis.issues.length < 5
    ) {
      const node = stack.pop()!;
      if (node.isError || node.isMissing)
        analysis.issues.push({
          ...anchor(node),
          id: `rust-error:${node.startIndex}`,
          level: "error",
          title: words("Rust 문법 확인", "Check Rust syntax"),
          detail: words(
            `L${lineAt(starts, node.startIndex)}의 문법을 파서가 읽지 못했습니다. 원문을 확인하세요.`,
            `The parser could not read syntax at L${lineAt(starts, node.startIndex)}. Review the source.`,
          ),
        });
      else if (node.hasError)
        stack.push(
          ...node.children.filter((c) => c.hasError || c.isMissing).reverse(),
        );
    }
    if (!analysis.issues.length)
      analysis.issues.push({
        ...anchor(tree.rootNode),
        id: "rust-error",
        level: "error",
        title: words("Rust 문법 확인", "Check Rust syntax"),
        detail: words(
          "Rust 문법 파싱에 실패했습니다.",
          "Rust syntax parsing failed.",
        ),
      });
    return analysis;
  }
  let steps = 0;
  const step = (n: Node, depth = 0): Step | undefined => {
    if (comments(n)) return;
    if (steps >= RUST_LIMITS.steps || depth > RUST_LIMITS.depth) {
      truncate();
      return;
    }
    steps++;
    const result: Step = {
      ...anchor(n),
      id: `rust-step:${n.startIndex}:${n.type}`,
      kind: n.type,
      text: words(code(n), code(n)),
      children: [],
      supported: true,
    };
    const add = (child: Node | null) => {
      if (child) {
        const s = step(child, depth + 1);
        if (s) result.children.push(s);
      }
    };
    const body = (node: Node | null) =>
      node
        ? (node.type === "block" ? node.namedChildren : [node]).flatMap(
            (child) => {
              const s = step(child, depth + 1);
              return s ? [s] : [];
            },
          )
        : [];
    const say = (ko: string, en: string) => {
      result.text = words(ko, en);
    };
    switch (n.type) {
      case "expression_statement": {
        const inner = n.namedChildren.find((c) => !comments(c));
        // Keep the semicolon in the source anchor, but describe its expression.
        if (inner) {
          steps--;
          const s = step(inner, depth);
          if (s) return { ...s, ...anchor(n) };
        }
        break;
      }
      case "block":
        say("중괄호 안의 코드 블록", "Code block inside braces");
        result.children = body(n);
        break;
      case "if_expression":
        say(
          `조건 또는 패턴 확인: ${code(field(n, "condition"))}`,
          `Check condition or pattern: ${code(field(n, "condition"))}`,
        );
        result.children = body(field(n, "consequence"));
        {
          const alt = field(n, "alternative");
          if (alt)
            result.otherwise = body(
              alt.type === "else_clause"
                ? alt.namedChildren.at(-1) || null
                : alt,
            );
        }
        break;
      case "match_expression":
        say(
          `값을 패턴과 비교: ${code(field(n, "value"))}`,
          `Match a value against patterns: ${code(field(n, "value"))}`,
        );
        result.branches = [];
        for (const arm of field(n, "body")?.namedChildren || []) {
          if (arm.type !== "match_arm") continue;
          if (steps >= RUST_LIMITS.steps) {
            truncate();
            break;
          }
          steps++; // Empty arms also count toward the display budget.
          const pattern = code(field(arm, "pattern"));
          result.branches.push({
            label: words(
              `패턴·가드: ${pattern}`,
              `Pattern / guard: ${pattern}`,
            ),
            steps: body(field(arm, "value")),
          });
        }
        break;
      case "for_expression":
        say(
          `${code(field(n, "value"))}의 항목을 ${code(field(n, "pattern"))}에 받아 반복`,
          `Iterate ${code(field(n, "value"))} with pattern ${code(field(n, "pattern"))}`,
        );
        result.children = body(field(n, "body"));
        break;
      case "while_expression":
        say(
          `조건 또는 패턴이 맞는 동안 반복: ${code(field(n, "condition"))}`,
          `Repeat while the condition or pattern matches: ${code(field(n, "condition"))}`,
        );
        result.children = body(field(n, "body"));
        break;
      case "loop_expression":
        say(
          "loop 반복. 종료 여부는 본문과 호출 동작에 달려 있습니다.",
          "loop repetition. Termination depends on the body and called code.",
        );
        result.children = body(field(n, "body"));
        break;
      case "return_expression":
        say(
          `현재 함수·클로저에서 명시적으로 반환: ${short(n.text.replace(/^return\s*/, ""))}`,
          `Explicit return from the current function or closure: ${short(n.text.replace(/^return\s*/, ""))}`,
        );
        break;
      case "break_expression":
        say(
          `반복 또는 지정된 블록 종료: ${code(n)}`,
          `Exit a loop or labeled block: ${code(n)}`,
        );
        break;
      case "continue_expression":
        say(
          `다음 반복으로 이동: ${code(n)}`,
          `Continue with the next iteration: ${code(n)}`,
        );
        break;
      case "let_declaration":
        say(
          `지역 바인딩: ${code(field(n, "pattern"))}${field(n, "type") ? `: ${code(field(n, "type"))}` : ""}${field(n, "value") ? ` = ${code(field(n, "value"))}` : ""}`,
          `Local binding: ${code(field(n, "pattern"))}${field(n, "type") ? `: ${code(field(n, "type"))}` : ""}${field(n, "value") ? ` = ${code(field(n, "value"))}` : ""}`,
        );
        if (field(n, "alternative")) {
          say(
            `let 패턴 바인딩; 맞지 않으면 else 블록: ${code(n)}`,
            `let pattern binding; on mismatch use the else block: ${code(n)}`,
          );
          result.otherwise = body(field(n, "alternative"));
        }
        if (
          field(n, "value") &&
          [
            "if_expression",
            "match_expression",
            "closure_expression",
            "block",
            "try_expression",
            "async_block",
          ].includes(field(n, "value")!.type)
        )
          add(field(n, "value"));
        break;
      case "const_item":
      case "static_item":
        say(`선언: ${code(n)}`, `Declaration: ${code(n)}`);
        break;
      case "assignment_expression":
      case "compound_assignment_expr":
        say(`대입 식: ${code(n)}`, `Assignment expression: ${code(n)}`);
        break;
      case "call_expression":
        say(
          `호출 식: ${code(n)}. 실제 대상과 효과는 미확인입니다.`,
          `Call expression: ${code(n)}. The resolved target and effects are unchecked.`,
        );
        break;
      case "closure_expression":
        say(
          `클로저 값: ${code(n)}. 실행 시점은 호출하는 코드에 달려 있습니다.`,
          `Closure value: ${code(n)}. Execution timing depends on the calling code.`,
        );
        result.children = body(field(n, "body"));
        break;
      case "try_expression":
        say(
          `? 식: ${code(n)}. 값·타입에 따라 이어가거나 현재 반환 경계로 전파할 수 있습니다.`,
          `? expression: ${code(n)}. Depending on value and type, it can continue or propagate to the current return boundary.`,
        );
        break;
      case "async_block":
        say(
          "비동기 블록 값. 실행 시점과 완료는 이 파싱에서 확인하지 않습니다.",
          "Async block value. Execution timing and completion are not checked by this parser.",
        );
        result.children = body(
          n.namedChildren.find((c) => c.type === "block") || null,
        );
        break;
      case "unsafe_block":
      case "const_block":
        say(`특수 블록: ${n.type}`, `Special block: ${n.type}`);
        result.children = body(
          n.namedChildren.find((c) => c.type === "block") || null,
        );
        break;
      case "use_declaration":
        say(
          `가져오기 선언: ${code(n)}. 경로를 해석하거나 코드를 불러오지 않습니다.`,
          `Import declaration: ${code(n)}. Paths are not resolved and code is not loaded.`,
        );
        break;
      default:
        if (opaque.has(n.type)) {
          say(
            `매크로·속성 원문: ${code(n)}. 확장하거나 적용하지 않았습니다.`,
            `Macro / attribute source: ${code(n)}. It was not expanded or applied.`,
          );
          result.supported = false;
        } else if (
          [
            "integer_literal",
            "float_literal",
            "boolean_literal",
            "string_literal",
            "raw_string_literal",
            "identifier",
            "binary_expression",
            "unary_expression",
            "field_expression",
            "reference_expression",
            "tuple_expression",
            "array_expression",
            "unit_expression",
            "index_expression",
            "type_cast_expression",
            "scoped_identifier",
          ].includes(n.type)
        )
          say(
            `식 원문: ${code(n)}. 값과 타입은 평가하지 않았습니다.`,
            `Expression source: ${code(n)}. Its value and type were not evaluated.`,
          );
        else {
          say(
            `상세 해석을 제공하지 않는 원문: ${code(n)}`,
            `Source without a detailed interpretation: ${code(n)}`,
          );
          result.supported = false;
        }
    }
    const positionNode =
      n.parent?.type === "expression_statement" ? n.parent : n;
    if (
      positionNode.parent?.type === "block" &&
      positionNode.parent.namedChildren.filter((c) => !comments(c)).at(-1)
        ?.id === positionNode.id &&
      !positionNode.text.trimEnd().endsWith(";") &&
      !n.type.endsWith("_item") &&
      ![
        "let_declaration",
        "expression_statement",
        "line_comment",
        "block_comment",
      ].includes(n.type)
    ) {
      result.text = words(
        `블록의 마지막 식 — ${result.text.ko}`,
        `Final expression of this block — ${result.text.en}`,
      );
    }
    analysis.total++;
    if (result.supported) analysis.explained++;
    return result;
  };
  // One bounded traversal collects declarations and literals, respecting opaque
  // macro token trees. UTF-16 offsets come from the JS binding, not byte offsets.
  let visited = 0;
  const walk = (n: Node, scope: string, qualified: string[], depth: number) => {
    if (++visited > RUST_LIMITS.nodes || depth > 64) {
      truncate();
      return;
    }
    if (comments(n) || opaque.has(n.type)) return;
    if (["mod_item", "trait_item", "impl_item"].includes(n.type)) {
      const name = code(field(n, "name") || field(n, "type"));
      if (name) qualified = [...qualified, name];
    }
    if (n.type === "function_item") {
      const fullName = [...qualified, code(field(n, "name"))].join("::");
      const name = short(fullName);
      if (fullName.length > 400) truncate();
      scope = name;
      if (analysis.functions.length < RUST_LIMITS.functions) {
        const parameters =
          field(n, "parameters")?.namedChildren.filter((c) => !comments(c)) ||
          [];
        if (parameters.length > RUST_LIMITS.parameters) truncate();
        const fn: FunctionInfo = {
          ...anchor(n),
          id: `rust-fn:${n.startIndex}`,
          name,
          label: words(name, name),
          params: parameters.slice(0, RUST_LIMITS.parameters).map((p) => ({
            name: code(field(p, "pattern")) || code(p),
            type:
              code(field(p, "type")) ||
              (p.type === "self_parameter" ? "self" : "inferred"),
            optional: false,
          })),
          steps: (field(n, "body")?.namedChildren || []).flatMap((c) => {
            const s = step(c);
            return s ? [s] : [];
          }),
          calls: [],
          async: n.children.some(
            (c) => c.type === "function_modifiers" && /\basync\b/.test(c.text),
          ),
          simulatable: false,
        };
        analysis.functions.push(fn);
      } else truncate();
      qualified = [...qualified, code(field(n, "name"))];
    }
    const negative =
      ["unary_expression", "negative_literal"].includes(n.type) &&
      /^-\s*(?:\d)/.test(n.text) &&
      n.namedChildCount === 1 &&
      ["integer_literal", "float_literal"].includes(n.namedChildren[0].type);
    const literal = negative ? n.namedChildren[0] : n;
    if (
      negative ||
      [
        "integer_literal",
        "float_literal",
        "boolean_literal",
        "string_literal",
        "raw_string_literal",
      ].includes(n.type)
    ) {
      let value: Rule["value"] | undefined,
        type: Rule["type"] = "number";
      if (literal.type.includes("string")) {
        type = "string";
        value = decodeRustString(n.text);
      } else if (literal.type === "boolean_literal") {
        type = "boolean";
        value = n.text === "true";
      } else if (/^-?\s*\d/.test(n.text)) value = n.text;
      if (value !== undefined && n.text.length <= RUST_LIMITS.value) {
        if (analysis.rules.length < RUST_LIMITS.rules) {
          const parent = n.parent;
          const binding =
            parent &&
            ["let_declaration", "const_item", "static_item"].includes(
              parent.type,
            )
              ? code(field(parent, "name") || field(parent, "pattern"))
              : "";
          const name = `${binding || "value"} @ L${anchor(n).line}:${n.startIndex - starts[anchor(n).line - 1] + 1}`;
          analysis.rules.push({
            ...anchor(n),
            id: `rust:${n.startIndex}`,
            name,
            label: words(name, name),
            raw: n.text,
            value,
            type,
            syntax: "rust",
            scope,
            note: words(
              "원문에 적힌 값입니다. 타입·범위·소유권·실행 결과는 검사하지 않습니다.",
              "Value written in source. Types, ranges, ownership and runtime outcomes are unchecked.",
            ),
          });
        } else truncate();
      }
      if (negative) return;
    }
    for (const child of n.namedChildren) {
      if (visited >= RUST_LIMITS.nodes) {
        truncate();
        break;
      }
      walk(child, scope, qualified, depth + 1);
    }
  };
  walk(tree.rootNode, "file", [], 0);
  for (const n of tree.rootNode.namedChildren) {
    if (n.type === "function_item" || comments(n)) continue;
    const s = step(n);
    if (s) analysis.steps.push(s);
  }
  analysis.issues.push({
    ...anchor(tree.rootNode),
    id: "rust-limits",
    level: "info",
    title: words("문법 파싱 범위", "Syntax parsing scope"),
    detail: words(
      "포함된 Rust 문법 파서로 읽었습니다. rustc·타입·소유권·매크로 확장·속성/cfg 적용·모듈 해석·동작·성능은 검사하지 않았습니다. 매크로·속성 내부의 값은 직접 수정 목록에서 제외합니다.",
      "Read with the bundled Rust syntax parser. rustc, types, ownership, macro expansion, attributes/cfg, module resolution, behavior and performance are unchecked. Values inside macros and attributes are excluded from direct edits.",
    ),
  });
  if (analysis.rust!.truncated)
    analysis.issues.push({
      ...anchor(tree.rootNode),
      id: "rust-truncated",
      level: "review",
      title: words("일부 생략", "Some content omitted"),
      detail: words(
        "표시 한도(함수 100개·단계 400개·값 300개·단계 깊이 16)에 도달했습니다. 원문도 확인하세요.",
        "Display limits (100 functions, 400 steps, 300 values, step depth 16) were reached. Also review the source.",
      ),
    });
  if (
    new TextEncoder().encode(JSON.stringify(analysis)).length >
    RUST_LIMITS.output
  )
    throw Error(
      "Rust 분석 출력이 2 MiB 한도를 넘었습니다. / Rust analysis exceeds the 2 MiB output limit.",
    );
  return analysis;
}

export function makeRustPatch(
  file: SourceFile,
  parser: Parser,
  ruleId: string,
  value: string,
): Patch {
  if (typeof value !== "string" || value.length > RUST_LIMITS.value)
    throw Error("값은 최대 4096자입니다. / Value exceeds 4096 characters.");
  const before = parseRust(parser, file.content);
  let rule: Rule | undefined;
  try {
    rule = readRustTree(file, before).rules.find((r) => r.id === ruleId);
  } finally {
    before.delete();
  }
  if (!rule)
    throw Error(
      "수정할 Rust 값을 다시 선택하세요. / Select a current Rust value.",
    );
  let replacement: string;
  if (rule.type === "string") replacement = encodeString(value, rule.raw);
  else if (rule.type === "boolean") {
    if (!["true", "false"].includes(value))
      throw Error("true 또는 false를 입력하세요. / Enter true or false.");
    replacement = value;
  } else {
    replacement = value.trim();
    // A standalone constant initializer must contain exactly one number, with
    // no injected comments, delimiters, statements or binary operations.
    const prefix = "const VALUE: () = ";
    const probe = parseRust(parser, `${prefix}${replacement};`);
    try {
      const item = probe.rootNode.namedChildren[0],
        node = item && field(item, "value");
      const numeric =
        node &&
        (["integer_literal", "float_literal"].includes(node.type) ||
          (node.type === "unary_expression" &&
            /^-\s*\d/.test(node.text) &&
            node.namedChildCount === 1 &&
            ["integer_literal", "float_literal"].includes(
              node.namedChildren[0].type,
            )));
      if (
        probe.rootNode.hasError ||
        probe.rootNode.namedChildCount !== 1 ||
        !numeric ||
        node!.startIndex !== prefix.length ||
        node!.endIndex !== prefix.length + replacement.length
      )
        throw Error(
          "Rust 숫자 리터럴 하나를 입력하세요. / Enter one Rust numeric literal.",
        );
    } finally {
      probe.delete();
    }
  }
  const updated =
    file.content.slice(0, rule.start) +
    replacement +
    file.content.slice(rule.end);
  const candidate = parseRust(parser, updated);
  try {
    if (candidate.rootNode.hasError)
      throw Error(
        "변경 후 Rust 문법 오류가 있습니다. / Rust syntax error after the edit.",
      );
  } finally {
    candidate.delete();
  }
  return {
    path: file.path,
    ruleId,
    start: rule.start,
    end: rule.end,
    oldText: rule.raw,
    newText: replacement,
    original: file.content,
    updated,
    description: words(
      `${rule.label.ko} 값을 변경합니다. 타입과 동작은 별도 확인하세요.`,
      `Change ${rule.label.en}. Check types and behavior separately.`,
    ),
    semanticChecked: false,
  };
}
