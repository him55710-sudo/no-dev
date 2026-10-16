import {
  parseTree,
  printParseErrorCode,
  type ParseError,
  type Node,
} from "jsonc-parser";
import { words, type Anchor, type Rule, type Step, type Words } from "./types";

export const jsonDataLimits = {
  fields: 300,
  depth: 12,
  preview: 200,
  path: 256,
  editable: 4096,
};
export type JsonDataField = Anchor & {
  id: string;
  path: string;
  type: Exclude<Node["type"], "property">;
  preview: string;
  abbreviated: boolean;
  count: number;
  duplicate: boolean;
  ruleId?: string;
  note?: Words;
};
export type JsonDataFacts = {
  type: JsonDataField["type"];
  entries: number;
  fields: JsonDataField[];
  truncated: boolean;
};

function treeFor(source: string, comments: boolean) {
  // Strict JSON validation complements the fault-tolerant JSONC parser.
  // Never use parsed JS numbers for display or round-trip edits.
  if (!comments) JSON.parse(source);
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, {
    disallowComments: !comments,
    allowTrailingComma: comments,
    allowEmptyContent: false,
  });
  if (errors.length || !tree) {
    const first = errors[0];
    throw Error(
      first
        ? `${printParseErrorCode(first.error)} at ${first.offset}`
        : "JSON value required",
    );
  }
  return tree;
}

/** Read structure only; JSONC property names are never assigned to JS objects. */
export function readJsonStructure(source: string, comments = false) {
  const tree = treeFor(source, comments);
  return { type: tree.type, entries: tree.children?.length ?? 0 };
}

const typeName = {
  object: words("객체", "object"),
  array: words("목록", "array"),
  string: words("문자열", "string"),
  number: words("숫자", "number"),
  boolean: words("참·거짓 값", "boolean"),
  null: words("null 값", "null value"),
};

/** Literal facts only. Key names never establish consumer behavior. */
export function describeJsonData(source: string, comments = false) {
  const root = treeFor(source, comments);
  const facts: JsonDataFacts = {
    type: root.type as JsonDataField["type"],
    entries: root.children?.length ?? 0,
    fields: [],
    truncated: false,
  };
  const rules: Rule[] = [],
    steps: Step[] = [];
  const lines = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\r") {
      if (source[i + 1] === "\n") i++;
      lines.push(i + 1);
    } else if (source[i] === "\n") lines.push(i + 1);
  }
  const lineAt = (offset: number) => {
    let lo = 0,
      hi = lines.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (lines[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return lo + 1;
  };
  const short = (value: string, limit: number) =>
    value.length > limit ? value.slice(0, limit) + "…" : value;
  function visit(node: Node, path: string, depth: number, duplicate: boolean) {
    if (
      facts.fields.length >= jsonDataLimits.fields ||
      depth > jsonDataLimits.depth
    ) {
      facts.truncated = true;
      return;
    }
    const type = node.type as JsonDataField["type"];
    const container = type === "object" || type === "array";
    const raw = source.slice(node.offset, node.offset + node.length);
    const field: JsonDataField = {
      id: `json:${node.offset}`,
      path,
      type,
      start: node.offset,
      end: node.offset + node.length,
      line: lineAt(node.offset),
      endLine: lineAt(node.offset + node.length),
      preview: container ? "" : short(raw, jsonDataLimits.preview),
      abbreviated: !container && raw.length > jsonDataLimits.preview,
      count: node.children?.length ?? 0,
      duplicate,
    };
    if (duplicate)
      field.note = words(
        "같은 이름의 키가 중복된 범위입니다. 사용처마다 해석이 달라질 수 있어 여기서는 수정하지 않습니다.",
        "This range has duplicate keys. Consumers may interpret it differently; direct editing is disabled here.",
      );
    else if (!container && raw.length > jsonDataLimits.editable)
      field.note = words(
        "긴 값은 원문에서 수정해 주세요.",
        "Edit this long value in the source.",
      );
    if (
      !duplicate &&
      ["string", "number", "boolean"].includes(type) &&
      raw.length <= jsonDataLimits.editable
    ) {
      const id = field.id;
      field.ruleId = id;
      rules.push({
        start: field.start,
        end: field.end,
        line: field.line,
        endLine: field.endLine,
        id,
        name: path,
        label: words(path, path),
        type: type as Rule["type"],
        value: type === "number" ? raw : node.value,
        scope: "data",
        raw,
        syntax: "json",
        note: words(
          "원문에 저장된 값입니다. 실제 적용 방식은 이 데이터를 읽는 코드를 확인해야 합니다.",
          "A value stored in the source. Its effect depends on the code that reads it.",
        ),
      });
    }
    facts.fields.push(field);
    const name = typeName[type];
    steps.push({
      start: field.start,
      end: field.end,
      line: field.line,
      endLine: field.endLine,
      id: field.id,
      kind: "data",
      supported: true,
      children: [],
      text: container
        ? words(
            `${path}: ${field.count}개 항목의 ${name.ko}`,
            `${path}: ${name.en} with ${field.count} entries`,
          )
        : words(
            `${path}에 ${name.ko} ${field.preview}${field.abbreviated ? " (일부 표시)" : ""} 저장`,
            `${path} stores ${name.en} ${field.preview}${field.abbreviated ? " (abbreviated)" : ""}`,
          ),
    });
    if (container) children(node, path, depth, duplicate);
  }
  function children(
    node: Node,
    path: string,
    depth: number,
    inherited: boolean,
  ) {
    const nodes = node.children || [];
    const counts = new Map<string, number>();
    if (node.type === "object")
      for (const property of nodes) {
        const key = property.children![0].value as string;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    for (let i = 0; i < nodes.length; i++) {
      if (facts.fields.length >= jsonDataLimits.fields) {
        facts.truncated = true;
        break;
      }
      if (node.type === "object") {
        const [key, value] = nodes[i].children!;
        const segment = short(JSON.stringify(key.value), 80);
        visit(
          value,
          short(`${path}[${segment}]`, jsonDataLimits.path),
          depth + 1,
          inherited || counts.get(key.value)! > 1,
        );
      } else
        visit(
          nodes[i],
          short(`${path}[${i}]`, jsonDataLimits.path),
          depth + 1,
          inherited,
        );
    }
  }
  if (root.type === "object" || root.type === "array")
    children(root, "$", 0, false);
  else visit(root, "$", 0, false);
  return { facts, rules, steps };
}
