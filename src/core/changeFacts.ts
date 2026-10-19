import ts from "typescript";

export type ChangeFacts =
  | { status: "unavailable" }
  | {
      status: "available";
      codeTokensChanged: boolean;
      parseStructureChanged: boolean;
      commentsChanged: boolean;
      whitespaceOnly: boolean;
      braces: { before: number; after: number };
    };

/** Written-code comparison, never a proof of equivalent behavior or intent. */
export function compareParsedChanges(
  before: ts.SourceFile,
  after: ts.SourceFile,
): ChangeFacts {
  function collect(file: ts.SourceFile) {
    const tokens: Array<[number, string]> = [], shape: number[] = [];
    const spans: Array<{ start: number; end: number }> = [];
    function visit(node: ts.Node) {
      // Documentation is compared as comment text, not executable syntax.
      if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
      shape.push(node.kind);
      const children = node.getChildren(file);
      if (children.length) for (const child of children) visit(child);
      else if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.getWidth(file)) {
        tokens.push([node.kind, node.getText(file)]);
        spans.push({ start: node.getStart(file), end: node.end });
      }
      shape.push(-1);
    }
    visit(file);
    const comments: string[] = [];
    let previous = 0;
    // The parser supplies token boundaries, so /regex/, templates and JSX text
    // are not accidentally reinterpreted as comments by a standalone scanner.
    for (const span of [...spans, { start: file.text.length, end: file.text.length }]) {
      const gap = file.text.slice(previous, span.start);
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, gap);
      for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia)
          comments.push(scanner.getTokenText());
      }
      previous = span.end;
    }
    return { tokens, shape, comments, braces: tokens.filter(([kind]) => kind === ts.SyntaxKind.OpenBraceToken || kind === ts.SyntaxKind.CloseBraceToken).length };
  }
  const a = collect(before), b = collect(after);
  const codeTokensChanged = JSON.stringify(a.tokens) !== JSON.stringify(b.tokens);
  const parseStructureChanged = JSON.stringify(a.shape) !== JSON.stringify(b.shape);
  const commentsChanged = JSON.stringify(a.comments) !== JSON.stringify(b.comments);
  return {
    status: "available", codeTokensChanged, parseStructureChanged, commentsChanged,
    whitespaceOnly: before.text !== after.text && !codeTokensChanged && !parseStructureChanged && !commentsChanged,
    braces: { before: a.braces, after: b.braces },
  };
}
