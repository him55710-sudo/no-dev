import { parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";

/** Read structure only; JSONC property names are never assigned to JS objects. */
export function readJsonStructure(source: string, comments = false) {
  if (!comments) {
    const data: unknown = JSON.parse(source);
    return {
      type: Array.isArray(data)
        ? "array"
        : data === null
          ? "null"
          : typeof data,
      entries: data && typeof data === "object" ? Object.keys(data).length : 0,
    };
  }
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, {
    disallowComments: false,
    allowTrailingComma: true,
    allowEmptyContent: false,
  });
  if (errors.length || !tree) {
    const first = errors[0];
    throw Error(
      first
        ? `${printParseErrorCode(first.error)} at ${first.offset}`
        : "JSONC value required",
    );
  }
  return { type: tree.type, entries: tree.children?.length ?? 0 };
}
