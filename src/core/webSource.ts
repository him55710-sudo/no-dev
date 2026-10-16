import {
  parse as parseHtml,
  parseFragment,
  type DefaultTreeAdapterMap,
} from "parse5";
import {
  parse as parseCss,
  tokenize,
  tokenTypes as T,
  lexer,
  type CssNode,
} from "css-tree";
import {
  words,
  type Anchor,
  type FileAnalysis,
  type InterfaceNode,
  type Rule,
} from "./types";

export const webSourceLimits = {
  bytes: 128 * 1024,
  nodes: 300,
  depth: 12,
  edit: 4096,
} as const;
type HtmlNode = DefaultTreeAdapterMap["node"];
const textAttributes = new Set([
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
]);
const opaqueTags = new Set([
  "script",
  "style",
  "title",
  "textarea",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "svg",
  "math",
  "template",
]);
const short = (value: string) =>
  value.length > 240 ? value.slice(0, 240) + "…" : value;

function anchors(source: string) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\r") {
      if (source[i + 1] === "\n") i++;
      starts.push(i + 1);
    } else if (source[i] === "\n") starts.push(i + 1);
  }
  const line = (offset: number) => {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return lo + 1;
  };
  return (start: number, end: number): Anchor => ({
    start,
    end,
    line: line(start),
    endLine: line(end),
  });
}

// CSS parsers recover at EOF. Require explicit token closure for an editable source.
export function checkCssTokens(source: string) {
  const stack: number[] = [];
  let bad = false;
  const closes = new Map([
    [T.LeftCurlyBracket, T.RightCurlyBracket],
    [T.LeftSquareBracket, T.RightSquareBracket],
    [T.LeftParenthesis, T.RightParenthesis],
    [T.Function, T.RightParenthesis],
  ]);
  tokenize(source, (type, start, end) => {
    const raw = source.slice(start, end);
    if (closes.has(type)) stack.push(closes.get(type)!);
    else if (
      [T.RightCurlyBracket, T.RightSquareBracket, T.RightParenthesis].includes(
        type,
      )
    )
      bad ||= stack.pop() !== type;
    else if (type === T.BadString || type === T.BadUrl) bad = true;
    else if (type === T.Comment && !raw.endsWith("*/")) bad = true;
    else if (type === T.Url && !raw.endsWith(")")) bad = true;
    else if (type === T.String) {
      let escapes = 0;
      for (let i = raw.length - 2; i >= 0 && raw[i] === "\\"; i--) escapes++;
      if (raw.length < 2 || raw.at(-1) !== raw[0] || escapes % 2) bad = true;
    }
  });
  if (bad || stack.length)
    throw Error(
      "CSS 따옴표·주석·괄호를 닫아 주세요. / Close CSS strings, comments and brackets.",
    );
}

function css(
  source: string,
  context = "stylesheet",
  comments?: { start: number; end: number }[],
) {
  checkCssTokens(source);
  return parseCss(source, {
    context,
    positions: true,
    onComment(_value, location) {
      if (location)
        comments?.push({
          start: location.start.offset,
          end: location.end.offset,
        });
    },
    onParseError(error) {
      throw error;
    },
  });
}

export function readWebSource(
  source: string,
  language: "html" | "css",
  out: FileAnalysis,
): void {
  out.kind = "script";
  out.web = { language, truncated: false, nodes: 0 };
  out.interface = { roots: [], truncated: false };
  const at = anchors(source);
  const issue = (message: string, start = 0, end = start) => {
    out.syntaxValid = false;
    if (out.issues.length < 10)
      out.issues.push({
        ...at(start, end),
        id: `web-error-${out.issues.length}`,
        level: "error",
        title: words("원문 확인이 필요합니다", "Source needs review"),
        detail: words(`파서 진단: ${message}`, `Parser diagnostic: ${message}`),
      });
  };
  const node = (
    start: number,
    end: number,
    kind: InterfaceNode["kind"],
    ko: string,
    en: string,
    code?: string,
  ): InterfaceNode => ({
    ...at(start, end),
    id: `web-${start}-${out.web!.nodes++}`,
    kind,
    title: words(ko, en),
    code: code && short(code),
    children: [],
  });
  const limit = (depth: number) => {
    if (
      out.web!.nodes >= webSourceLimits.nodes ||
      depth > webSourceLimits.depth
    ) {
      out.web!.truncated = out.interface!.truncated = true;
      return true;
    }
    return false;
  };
  const rule = (
    n: InterfaceNode,
    start: number,
    end: number,
    value: string,
    syntax: Rule["syntax"],
    name: string,
  ) => {
    const raw = source.slice(start, end);
    if (
      raw.length > webSourceLimits.edit ||
      value.length > webSourceLimits.edit
    )
      return;
    const id = `${syntax}-${start}-${end}`;
    // Closing delimiter prevents @12 matching the name of @120 in requests.
    const uniqueName = `${short(name)} [@${start}]`;
    out.rules.push({
      ...at(start, end),
      id,
      name: uniqueName,
      label: words(uniqueName, uniqueName),
      type: "string",
      value,
      raw,
      syntax,
      scope: "source",
    });
    n.ruleId = id;
  };
  try {
    if (new TextEncoder().encode(source).length > webSourceLimits.bytes)
      throw Error("128 KiB source limit / 원문 크기 한도 초과");
    if (language === "html") {
      const doc = parseHtml(source, {
        sourceCodeLocationInfo: true,
        scriptingEnabled: true,
        onParseError(error) {
          // A missing doctype is common for snippets. All other recovery diagnostics disable edits.
          if (error.code !== "missing-doctype")
            issue(error.code, error.startOffset, error.endOffset);
        },
      });
      const visit = (
        n: HtmlNode,
        into: InterfaceNode[],
        depth: number,
        opaque: boolean,
      ) => {
        if (limit(depth)) return;
        const loc = n.sourceCodeLocation;
        if ("tagName" in n) {
          const blocked =
            opaque ||
            opaqueTags.has(n.tagName) ||
            n.namespaceURI !== "http://www.w3.org/1999/xhtml";
          let children = into;
          if (loc) {
            const el = node(
              loc.startOffset,
              loc.endOffset,
              "element",
              `<${n.tagName}> 요소`,
              `<${n.tagName}> element`,
            );
            if (blocked)
              el.detail = words(
                "이 영역의 문구·내부 문법은 직접 수정하지 않습니다.",
                "Text and embedded syntax in this region are read-only.",
              );
            into.push(el);
            children = el.children;
            for (const attr of n.attrs) {
              if (limit(depth + 1)) break;
              const a = n.sourceCodeLocation?.attrs?.[attr.name];
              if (!a) continue;
              const item = node(
                a.startOffset,
                a.endOffset,
                "attribute",
                `${attr.name} 속성`,
                `${attr.name} attribute`,
                source.slice(a.startOffset, a.endOffset),
              );
              children.push(item);
              if (
                !blocked &&
                textAttributes.has(attr.name) &&
                !attr.namespace
              ) {
                const raw = source.slice(a.startOffset, a.endOffset);
                const match =
                  /^[^\s=]+\s*=\s*("[\s\S]*"|'[\s\S]*'|[^\s]+)$/.exec(raw);
                if (match) {
                  const start = a.endOffset - match[1].length;
                  rule(
                    item,
                    start,
                    a.endOffset,
                    attr.value,
                    "htmlAttribute",
                    `${n.tagName}.${attr.name}`,
                  );
                }
              }
            }
          }
          // Implicit html/head/body wrappers have no source location and are flattened.
          for (const child of n.childNodes) {
            if (limit(depth + 1)) break;
            visit(child, children, depth + (loc ? 1 : 0), blocked);
          }
          if ("content" in n)
            for (const child of (
              n.content as DefaultTreeAdapterMap["documentFragment"]
            ).childNodes) {
              if (limit(depth + 1)) break;
              visit(child, children, depth + 1, true);
            }
        } else if ("value" in n && loc && n.value.trim()) {
          const item = node(
            loc.startOffset,
            loc.endOffset,
            "text",
            "원문 문구",
            "Source text",
            n.value,
          );
          into.push(item);
          if (!opaque) {
            const raw = source.slice(loc.startOffset, loc.endOffset);
            const fragment = parseFragment(raw);
            // Reparented/merged text may span markup; only edit a contiguous text token.
            if (
              fragment.childNodes.length === 1 &&
              "value" in fragment.childNodes[0] &&
              fragment.childNodes[0].value === n.value
            )
              rule(
                item,
                loc.startOffset,
                loc.endOffset,
                n.value,
                "htmlText",
                `text L${item.line}`,
              );
          }
        } else if ("childNodes" in n)
          for (const child of n.childNodes) {
            if (limit(depth)) break;
            visit(child, into, depth, opaque);
          }
      };
      visit(doc, out.interface.roots, 0, false);
    } else {
      const comments: { start: number; end: number }[] = [];
      const tree = css(source, "stylesheet", comments);
      const raw = (n: CssNode | null) =>
        n?.loc ? source.slice(n.loc.start.offset, n.loc.end.offset) : "";
      const visit = (
        n: CssNode,
        into: InterfaceNode[],
        depth: number,
        context: string,
      ) => {
        if (limit(depth)) return;
        if (n.type === "StyleSheet" || n.type === "Block") {
          for (const child of n.children) {
            if (limit(depth)) break;
            visit(child, into, depth, context);
          }
          return;
        }
        if (!n.loc) return;
        const start = n.loc.start.offset,
          end = n.loc.end.offset;
        if (n.type === "Rule" || n.type === "Atrule") {
          const title =
            n.type === "Rule"
              ? raw(n.prelude).trim()
              : `@${n.name}${n.prelude ? " " + raw(n.prelude).trim() : ""}`;
          const item = node(
            start,
            end,
            n.type === "Rule" ? "element" : "condition",
            n.type === "Rule" ? "선택자" : "앳 규칙",
            n.type === "Rule" ? "Selector" : "At-rule",
            title,
          );
          into.push(item);
          if (n.block) visit(n.block, item.children, depth + 1, title);
        } else if (n.type === "Declaration") {
          const value = raw(n.value);
          const hasComment =
            !!n.value.loc &&
            comments.some(
              (comment) =>
                comment.start < n.value.loc!.end.offset &&
                comment.end > n.value.loc!.start.offset,
            );
          const item = node(
            start,
            end,
            "attribute",
            `${n.property} 선언${n.important ? " (!important)" : ""}`,
            `${n.property} declaration${n.important ? " (!important)" : ""}`,
            value,
          );
          into.push(item);
          if (n.value.loc && value.trim() && !hasComment) {
            const leading = value.match(/^[\t\n\r\f ]*/)?.[0].length || 0;
            const trailing = value.match(/[\t\n\r\f ]*$/)?.[0].length || 0;
            rule(
              item,
              n.value.loc.start.offset + leading,
              n.value.loc.end.offset - trailing,
              value.slice(leading, value.length - trailing),
              "css",
              `${context} → ${n.property}`,
            );
            const editable = out.rules.find((r) => r.id === item.ruleId);
            if (editable) editable.cssProperty = n.property;
          }
          if (hasComment)
            item.detail = words(
              "값 안의 주석을 보존하기 위해 직접 수정은 제공하지 않습니다.",
              "Direct editing is unavailable to preserve comments inside this value.",
            );
        } else {
          into.push(
            node(
              start,
              end,
              "unknown",
              "해석하지 않은 CSS 원문",
              "Uninterpreted CSS source",
              raw(n),
            ),
          );
        }
      };
      visit(tree, out.interface.roots, 0, "CSS");
    }
  } catch (error) {
    issue(error instanceof Error ? error.message : String(error));
  }
  if (!out.syntaxValid) out.rules = [];
  out.total = out.web.nodes;
  // These are source facts, not an executable explanation coverage score.
  out.explained = 0;
}

export function webReplacement(rule: Rule, input: string) {
  if (input.length > webSourceLimits.edit)
    throw Error(
      "4096자 이내로 입력해 주세요. / Enter at most 4096 characters.",
    );
  if (input === rule.value) throw Error("현재 값과 같습니다. / No change.");
  if (rule.syntax === "css") {
    const value = input.replace(/^[\t\n\r\f ]+|[\t\n\r\f ]+$/g, "");
    if (!value) throw Error("CSS 값이 필요합니다. / Enter a CSS value.");
    const ast = css(`x:${value}`, "declaration");
    if (
      ast.type !== "Declaration" ||
      ast.important ||
      ast.value.type !== "Value"
    )
      throw Error(
        "하나의 CSS 값만 입력하세요. / Enter one CSS value without !important.",
      );
    // Verify no extra declaration, brace or priority escapes the selected value.
    css(value, "value");
    const property = rule.cssProperty!;
    if (!property.startsWith("--")) {
      const result = lexer.matchProperty(property, ast.value);
      if (result.error && result.error.name === "SyntaxMatchError")
        throw Error(
          `CSS 값 문법 불일치 / CSS value does not match ${property}`,
        );
    }
    return value;
  }
  // Reject characters that HTML normalizes so the new value remains exact.
  if (/\r|\u0000|[\uD800-\uDFFF]/u.test(input))
    throw Error(
      "HTML에서 정규화되는 문자는 입력할 수 없습니다. / Use well-formed text without CR or NUL.",
    );
  const encoded = input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return rule.syntax === "htmlAttribute"
    ? `"${encoded.replaceAll('"', "&quot;")}"`
    : encoded;
}
