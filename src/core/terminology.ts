import ts from "typescript";
import { label } from "./labels";
import type { CodeTerm, GlossaryEntry } from "./glossary";
import type { Words } from "./types";

type Candidate = {
  node: ts.Identifier;
  id: string;
  scope: string;
  kind: CodeTerm["kind"];
};
function topFunction(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    ts.isSourceFile(node.parent) &&
    node.name
  )
    return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name) &&
    ts.isSourceFile(node.parent.parent.parent.parent)
  )
    return node.parent.name.text;
}
function candidate(node: ts.Node): Candidate | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    ts.isSourceFile(node.parent)
  )
    return {
      node: node.name,
      scope: "file",
      kind: "function",
      id: JSON.stringify(["file", "function", node.name.text]),
    };
  if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
    const fn = topFunction(node.parent);
    if (fn)
      return {
        node: node.name,
        scope: fn,
        kind: "parameter",
        id: JSON.stringify(["function", fn, "parameter", node.name.text]),
      };
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
  ) {
    const container = node.parent.parent.parent;
    const fn = ts.isBlock(container)
      ? topFunction(container.parent)
      : undefined;
    if (ts.isSourceFile(container) || fn) {
      const scope = fn || "file";
      return {
        node: node.name,
        scope,
        kind: "variable",
        id: JSON.stringify([
          fn ? "function" : "file",
          ...(fn ? [fn] : []),
          "variable",
          node.name.text,
        ]),
      };
    }
  }
}

export function terminology(sf: ts.SourceFile, entries: GlossaryEntry[]) {
  const candidates: Candidate[] = [];
  function walk(node: ts.Node) {
    const item = candidate(node);
    if (item) candidates.push(item);
    ts.forEachChild(node, walk);
  }
  walk(sf);
  const counts = new Map<string, number>();
  candidates.forEach((c) => counts.set(c.id, (counts.get(c.id) || 0) + 1));
  const aliases = new Map(
    entries
      .filter((e) => e.path === sf.fileName)
      .map((e) => [e.symbolId, e.labels]),
  );
  const bindings = new Map<ts.Symbol, Words>();
  // The checker is only created for files with custom terms. It binds names;
  // it does not load dependencies, libraries or the user's filesystem.
  const checker = aliases.size
    ? ts
        .createProgram(
          [sf.fileName],
          {
            noLib: true,
            noResolve: true,
            allowJs: true,
            target: ts.ScriptTarget.Latest,
            jsx: ts.JsxEmit.Preserve,
          },
          {
            getSourceFile: (name) => (name === sf.fileName ? sf : undefined),
            getDefaultLibFileName: () => "",
            writeFile: () => {},
            getCurrentDirectory: () => "",
            getDirectories: () => [],
            fileExists: (name) => name === sf.fileName,
            readFile: (name) => (name === sf.fileName ? sf.text : undefined),
            getCanonicalFileName: (name) => name,
            useCaseSensitiveFileNames: () => true,
            getNewLine: () => "\n",
          },
        )
        .getTypeChecker()
    : undefined;
  const terms: CodeTerm[] = [];
  for (const c of candidates) {
    if (counts.get(c.id) !== 1) continue;
    const symbol = checker?.getSymbolAtLocation(c.node);
    const requested = aliases.get(c.id);
    const custom =
      requested && symbol?.declarations?.length === 1 ? requested : undefined;
    const defaults = label(c.node.text),
      words = { ...defaults, ...custom };
    if (symbol && custom) bindings.set(symbol, words);
    terms.push({
      id: c.id,
      name: c.node.text,
      scope: c.scope,
      kind: c.kind,
      label: words,
      defaults,
      custom,
      start: c.node.getStart(sf),
      end: c.node.end,
      line: sf.getLineAndCharacterOfPosition(c.node.getStart(sf)).line + 1,
      endLine: sf.getLineAndCharacterOfPosition(c.node.end).line + 1,
    });
  }
  const describe = (node: ts.Node | undefined, fallback = "") => {
    if (!node || !ts.isIdentifier(node))
      return label(node?.getText(sf) || fallback);
    let symbol: ts.Symbol | undefined;
    if (checker) {
      symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
    }
    return (symbol && bindings.get(symbol)) || label(node.text);
  };
  return { terms, describe };
}
