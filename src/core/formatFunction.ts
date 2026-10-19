import ts from "typescript";
import { parse, diagnostics } from "./analyze";
import { compareParsedChanges } from "./changeFacts";
import { words, type Patch, type SourceFile, type Words } from "./types";

export type FunctionFormatResult = { description: Words; patch?: Patch };

/** Local layout only. Never loads project config/plugins or executes source. */
export function formatFunction(
  file: SourceFile,
  functionId: string,
): FunctionFormatResult {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file.path))
    throw Error(
      "JS/TS 함수만 정리할 수 있습니다. / Only JS/TS functions are supported.",
    );
  if (new TextEncoder().encode(file.content).length > 128 * 1024)
    throw Error(
      "128 KiB 이하 파일로 시도해 주세요. / Use a file up to 128 KiB.",
    );
  const source = file.content,
    sf = parse(file);
  if (diagnostics(sf).length)
    throw Error("먼저 문법 오류를 확인해 주세요. / Fix syntax errors first.");
  let selected:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | undefined;
  function find(node: ts.Node, depth = 0) {
    if (depth > 200)
      throw Error("코드 중첩이 너무 깊습니다. / Code nesting is too deep.");
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      `fn:${node.getStart(sf)}` === functionId
    )
      selected = node;
    ts.forEachChild(node, (child) => find(child, depth + 1));
  }
  find(sf);
  if (!selected)
    throw Error("기능을 다시 선택해 주세요. / Select the function again.");
  const nodeStart = selected.getStart(sf),
    end = selected.end;
  const lineStart =
    Math.max(
      source.lastIndexOf("\n", nodeStart - 1),
      source.lastIndexOf("\r", nodeStart - 1),
    ) + 1;
  const start = /^[\t ]*$/.test(source.slice(lineStart, nodeStart))
    ? lineStart
    : nodeStart;
  const newline = source.match(/\r\n|\r|\n/)?.[0] || "\n";
  const breaks = new Set<number>();
  function mark(pos: number) {
    if (pos <= nodeStart || pos >= end) return;
    const line =
      Math.max(
        source.lastIndexOf("\n", pos - 1),
        source.lastIndexOf("\r", pos - 1),
      ) + 1;
    if (source.slice(line, pos).trim()) breaks.add(pos);
  }
  function reflow(node: ts.Node) {
    if (ts.isBlock(node) && node.statements.length) {
      for (const statement of node.statements) mark(statement.getStart(sf));
      mark(node.getLastToken(sf)!.getStart(sf));
    }
    if (ts.isIfStatement(node)) {
      if (!ts.isBlock(node.thenStatement))
        mark(node.thenStatement.getStart(sf));
      if (node.elseStatement) {
        mark(
          node
            .getChildren(sf)
            .find((child) => child.kind === ts.SyntaxKind.ElseKeyword)!
            .getStart(sf),
        );
        if (
          !ts.isBlock(node.elseStatement) &&
          !ts.isIfStatement(node.elseStatement)
        )
          mark(node.elseStatement.getStart(sf));
      }
    }
    if (
      (ts.isWhileStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isDoStatement(node)) &&
      !ts.isBlock(node.statement)
    )
      mark(node.statement.getStart(sf));
    if (ts.isVariableDeclarationList(node))
      for (const declaration of node.declarations.slice(1))
        mark(declaration.getStart(sf));
    ts.forEachChild(node, reflow);
  }
  reflow(selected);
  let layout = source;
  for (const pos of [...breaks].sort((a, b) => b - a))
    layout = layout.slice(0, pos) + newline + layout.slice(pos);
  const layoutEnd = end + breaks.size * newline.length;
  const filename = `source${file.path.match(/\.[^.]+$/)![0].toLowerCase()}`;
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({
      allowJs: true,
      noLib: true,
      jsx: ts.JsxEmit.Preserve,
    }),
    getScriptFileNames: () => [filename],
    getScriptVersion: () => "1",
    getScriptSnapshot: (path) =>
      path === filename ? ts.ScriptSnapshot.fromString(layout) : undefined,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "",
    fileExists: (path) => path === filename,
    readFile: () => undefined,
  });
  let updated = layout;
  try {
    const edits = service.getFormattingEditsForRange(
      filename,
      start,
      layoutEnd,
      {
        ...ts.getDefaultFormatCodeSettings(newline),
        indentSize: 2,
        tabSize: 2,
        convertTabsToSpaces: true,
        semicolons: ts.SemicolonPreference.Ignore,
      },
    );
    for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) {
      if (
        edit.span.start < start ||
        edit.span.start + edit.span.length > layoutEnd
      )
        throw Error(
          "선택한 기능 밖의 변경을 차단했습니다. / A change outside the function was blocked.",
        );
      updated =
        updated.slice(0, edit.span.start) +
        edit.newText +
        updated.slice(edit.span.start + edit.span.length);
    }
  } finally {
    service.dispose();
  }
  const description = words(
    "선택한 기능의 줄바꿈과 들여쓰기 정리 · 2칸 공백 · 모델 없이 로컬 처리",
    "Format the selected function · 2-space indentation · local, no model",
  );
  if (updated === source)
    return {
      description: words(
        "이미 이 서식으로 정리되어 있습니다.",
        "This function already uses this layout.",
      ),
    };
  const after = parse({ ...file, content: updated });
  const facts = diagnostics(after).length
    ? undefined
    : compareParsedChanges(sf, after);
  if (facts?.status !== "available" || !facts.whitespaceOnly)
    throw Error(
      "코드·주석·구조가 달라지는 변경을 차단했습니다. / A code, comment or structure change was blocked.",
    );
  const updatedEnd = updated.length - (source.length - end);
  if (
    updated.slice(0, start) !== source.slice(0, start) ||
    updated.slice(updatedEnd) !== source.slice(end)
  )
    throw Error(
      "선택한 기능 밖의 변경을 차단했습니다. / A change outside the function was blocked.",
    );
  return {
    description,
    patch: {
      path: file.path,
      ruleId: functionId,
      start,
      end,
      oldText: source.slice(start, end),
      newText: updated.slice(start, updatedEnd),
      original: source,
      updated,
      description,
      semanticChecked: false,
    },
  };
}
