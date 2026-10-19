import ts from "typescript";
import type { SourceFile } from "../core/types";
import { analyzeFile } from "../core/analyze";
import { connectionSite } from "./connectionSite";
import { symbolDescription } from "./symbolDescription";
import { routeCandidates } from "./routeCandidates";
import {
  relativePath,
  sha256,
  structureLimits,
  type SourceRef,
  type StructureGraph,
  type StructureNode,
  type StructureEdge,
} from "./model";

const root = "/pureobom/";
const script = /\.[cm]?[jt]sx?$/i;
const idFor = (kind: string, path: string, symbol = "") =>
  `${kind}:${encodeURIComponent(path)}:${encodeURIComponent(symbol)}`;
const sourcePath = (file: ts.SourceFile) => file.fileName.slice(root.length);
const nodeName = (node: ts.Node): string | undefined => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)) &&
    node.name
  )
    return node.name.getText();
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
    return node.name.text;
  if (ts.isFunctionDeclaration(node) && !node.name) return "default";
  return undefined;
};
const roleOf = (node: ts.Node) =>
  ts.isClassDeclaration(node)
    ? "class"
    : ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      ? "type"
      : ts.isEnumDeclaration(node)
        ? "enum"
        : ts.isVariableDeclaration(node) &&
            (!node.initializer ||
              (!ts.isArrowFunction(node.initializer) &&
                !ts.isFunctionExpression(node.initializer)))
          ? "data"
          : "function";

/** Static analysis only. The compiler can read only the supplied in-memory files. */
export async function analyzeStructure(
  input: SourceFile[],
): Promise<StructureGraph> {
  if (input.length > structureLimits.files)
    throw Error("프로젝트 파일 수 제한(500개)을 초과했습니다.");
  const files = new Map<string, string>();
  let totalBytes = 0;
  for (const file of input) {
    relativePath.parse(file.path);
    if (files.has(root + file.path)) throw Error(`중복 파일: ${file.path}`);
    const size = new TextEncoder().encode(file.content).length;
    if (size > structureLimits.fileBytes)
      throw Error(`파일 크기 제한 초과: ${file.path}`);
    totalBytes += size;
    files.set(root + file.path, file.content);
  }
  if (totalBytes > structureLimits.bytes)
    throw Error("프로젝트 분석 크기 제한(8MB)을 초과했습니다.");
  const hashes = new Map(
    await Promise.all(
      input.map(
        async (file) => [file.path, await sha256(file.content)] as const,
      ),
    ),
  );
  const notices: StructureGraph["notices"] = [];
  const normalize = (path: string) => path.replaceAll("\\", "/");
  const directoryExists = (path: string) =>
    [...files.keys()].some((key) =>
      key.startsWith(normalize(path).replace(/\/$/, "") + "/"),
    );
  const host: ts.CompilerHost = {
    getSourceFile: (path, languageVersion) => {
      const text = files.get(normalize(path));
      return text === undefined
        ? undefined
        : ts.createSourceFile(normalize(path), text, languageVersion, true);
    },
    getDefaultLibFileName: () => root + "__unavailable_lib__.d.ts",
    writeFile: () => {
      throw Error("Static analysis cannot write files");
    },
    getCurrentDirectory: () => root,
    getDirectories: () => [],
    getCanonicalFileName: normalize,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (path) => files.has(normalize(path)),
    readFile: (path) => files.get(normalize(path)),
    directoryExists,
    realpath: normalize,
  };
  let options: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const config =
    files.get(root + "tsconfig.json") ?? files.get(root + "jsconfig.json");
  if (config) {
    const parsed = ts.parseConfigFileTextToJson("tsconfig.json", config);
    if (parsed.error)
      notices.push({
        path: "tsconfig.json",
        message: ts.flattenDiagnosticMessageText(parsed.error.messageText, " "),
      });
    else {
      const result = ts.parseJsonConfigFileContent(
        parsed.config,
        {
          useCaseSensitiveFileNames: true,
          fileExists: host.fileExists,
          readFile: host.readFile,
          readDirectory: () =>
            [...files.keys()].filter((path) => script.test(path)),
        },
        root,
      );
      options = { ...options, ...result.options };
      for (const error of result.errors)
        notices.push({
          path: "tsconfig.json",
          message: ts.flattenDiagnosticMessageText(error.messageText, " "),
        });
    }
  }
  options = {
    ...options,
    noEmit: true,
    noLib: true,
    allowJs: true,
    plugins: [],
  };
  const program = ts.createProgram(
    [...files.keys()].filter((path) => script.test(path)),
    options,
    host,
  );
  const checker = program.getTypeChecker();
  const nodes: StructureNode[] = [
    {
      id: "system",
      kind: "system",
      origin: "directory",
      label: "프로젝트",
      summary:
        "코드에서 확인한 모듈·함수·규칙과 연결입니다. 폴더 묶음은 업무상의 시스템 경계를 확정하지 않습니다.",
      sources: [],
      syntaxValid: true,
    },
  ];
  const edges: StructureEdge[] = [];
  const groups = new Set<string>();
  const declarations = new Map<ts.Node, StructureNode>();
  const sourceFiles = new Map<string, ts.SourceFile>();
  const hashTasks: Promise<void>[] = [];
  const nodeHashes = new WeakMap<ts.Node, Promise<string>>();
  const printer = ts.createPrinter({ removeComments: true });
  const contentHash = (node: ts.Node) => {
    let hash = nodeHashes.get(node);
    if (!hash) {
      hash = sha256(
        printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()),
      );
      nodeHashes.set(node, hash);
    }
    return hash;
  };
  const siteHashes = new Map<StructureEdge, Promise<string>[]>();
  const ref = (node: ts.Node, symbol = ""): SourceRef => {
    const sf = node.getSourceFile();
    const start = node.getStart(sf),
      end = node.end;
    const reference: SourceRef = {
      path: sourcePath(sf),
      symbol,
      start,
      end,
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
      endLine: sf.getLineAndCharacterOfPosition(end).line + 1,
      fileHash: hashes.get(sourcePath(sf))!,
      contentHash: "",
    };
    hashTasks.push(
      contentHash(node).then((hash) => {
        reference.contentHash = hash;
      }),
    );
    return reference;
  };
  const addNode = (node: StructureNode) => {
    if (nodes.length >= structureLimits.nodes)
      throw Error("구조가 분석 노드 한도를 초과했습니다.");
    nodes.push(node);
    return node;
  };
  for (const file of input) {
    const parts = file.path.split("/");
    parts.pop();
    let parentId = "system";
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join("/");
      const id = idFor("group", path);
      if (!groups.has(id)) {
        addNode({
          id,
          parentId,
          kind: "group",
          label: parts[depth - 1],
          origin: "directory",
          summary: `폴더 ${path}에서 추출한 구조입니다. 이름은 코드 경로에서 가져왔습니다.`,
          sources: [],
          syntaxValid: true,
        });
        groups.add(id);
      }
      parentId = id;
    }
    const sf = program.getSourceFile(root + file.path);
    const fileId = idFor("file", file.path);
    const fileNode = addNode({
      id: fileId,
      parentId,
      kind: "file",
      origin: "syntax",
      label: file.path.split("/").at(-1)!,
      summary: sf
        ? "선언과 호출·화면 요소의 정적 연결을 확인할 수 있습니다."
        : "구조 분석 미지원 파일입니다. 원문은 탐색할 수 있습니다.",
      sources: [],
      syntaxValid: true,
    });
    if (!sf) {
      const hash = hashes.get(file.path)!;
      fileNode.sources.push({
        path: file.path,
        symbol: "",
        start: 0,
        end: file.content.length,
        line: 1,
        endLine: file.content.split("\n").length,
        fileHash: hash,
        contentHash: hash,
      });
      continue;
    }
    sourceFiles.set(file.path, sf);
    fileNode.sources = [ref(sf)];
    const diagnostics = program.getSyntacticDiagnostics(sf);
    fileNode.syntaxValid = diagnostics.length === 0;
    for (const error of diagnostics)
      notices.push({
        path: file.path,
        line: sf.getLineAndCharacterOfPosition(error.start ?? 0).line + 1,
        message: ts.flattenDiagnosticMessageText(error.messageText, " "),
      });
    const explained = analyzeFile(file);
    const explainedFunctions = new Map(
      explained.functions.map((fn) => [fn.start, fn]),
    );
    const names = new Map<string, number>();
    const visit = (node: ts.Node, owner: StructureNode, qualified: string) => {
      let current = owner,
        scope = qualified;
      const name = nodeName(node);
      if (name) {
        scope = qualified ? `${qualified}.${name}` : name;
        const count = names.get(scope) ?? 0;
        names.set(scope, count + 1);
        const key = count ? `${scope}#${count}` : scope;
        const description = symbolDescription(
          node,
          explainedFunctions,
          checker,
          roleOf(node),
        );
        current = addNode({
          id: idFor("symbol", file.path, key),
          parentId: owner.id,
          kind: "symbol",
          origin: "syntax",
          role: description.role,
          label: name,
          summary: description.summary,
          sources: [ref(node, key)],
          syntaxValid: fileNode.syntaxValid,
        });
        declarations.set(node, current);
        if (ts.isVariableDeclaration(node) && node.initializer)
          declarations.set(node.initializer, current);
      } else if (
        ts.isIfStatement(node) ||
        ts.isSwitchStatement(node) ||
        ts.isConditionalExpression(node)
      ) {
        const expression = ts.isConditionalExpression(node)
          ? node.condition
          : node.expression;
        const prefix = `${qualified || "module"}::condition`;
        const count = names.get(prefix) ?? 0;
        names.set(prefix, count + 1);
        current = addNode({
          id: idFor("rule", file.path, `${prefix}#${count}`),
          parentId: owner.id,
          kind: "rule",
          origin: "syntax",
          role: "condition",
          label: expression.getText(sf),
          summary: `이 조건에 따라 실행 경로가 달라집니다: ${expression.getText(sf)}`,
          sources: [ref(node, `${prefix}#${count}`)],
          syntaxValid: fileNode.syntaxValid,
        });
      }
      ts.forEachChild(node, (child) => visit(child, current, scope));
    };
    ts.forEachChild(sf, (node) => visit(node, fileNode, ""));
  }
  const ownerFor = (node: ts.Node): StructureNode | undefined => {
    let current: ts.Node | undefined = node;
    while (current) {
      const found = declarations.get(current);
      if (found) return found;
      current = current.parent;
    }
    return nodes.find(
      (n) => n.id === idFor("file", sourcePath(node.getSourceFile())),
    );
  };
  const resolveSymbol = (location: ts.Node): StructureNode | undefined => {
    let symbol = checker.getSymbolAtLocation(location);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations
      ?.map((decl) => declarations.get(decl))
      .find(Boolean);
  };
  const addEdge = (
    source: string,
    target: string,
    kind: StructureEdge["kind"],
    label: string,
    location: ts.Node,
    signature?: ts.SignatureDeclaration,
    candidateDetail?: ReturnType<typeof connectionSite>,
  ) => {
    if (edges.length >= structureLimits.edges)
      throw Error("구조가 분석 연결 한도를 초과했습니다.");
    const existing = edges.find(
      (edge) =>
        edge.source === source && edge.target === target && edge.kind === kind,
    );
    const edge: StructureEdge = existing ?? {
      id: `edge:${edges.length}:${source}:${target}`,
      source,
      target,
      kind,
      label,
      sources: [],
      sites: [],
      evidence: kind === "routes" ? "framework" : "compiler",
    };
    if (!existing) edges.push(edge);
    edge.sources.push(ref(location));
    const detail = candidateDetail ?? connectionSite(kind, location, signature);
    edge.sites!.push(detail.site);
    const pending = siteHashes.get(edge) ?? [];
    pending.push(
      Promise.all(
        detail.evidence.map((part) =>
          typeof part === "string" ? part : contentHash(part),
        ),
      ).then((parts) => sha256(JSON.stringify(parts))),
    );
    siteHashes.set(edge, pending);
  };
  for (const [path, sf] of sourceFiles) {
    // A function value passed to a hook/form is a dependency, not a call at
    // this location. Resolve its symbol and call signature through the same
    // in-memory compiler; never match an unrelated declaration by name.
    const passedFunction = (expression: ts.Expression) => {
      let value = expression;
      while (
        ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isTypeAssertionExpression(value) ||
        ts.isNonNullExpression(value) ||
        ts.isSatisfiesExpression(value)
      )
        value = value.expression;
      if (
        ts.isArrowFunction(value) ||
        ts.isFunctionExpression(value) ||
        ts.isCallExpression(value) ||
        ts.isNewExpression(value)
      )
        return; // Inline bodies/calls are visited separately; returned values are unknown.
      const type = checker.getNonNullableType(checker.getTypeAtLocation(value));
      if (!checker.getSignaturesOfType(type, ts.SignatureKind.Call).length)
        return;
      const target = resolveSymbol(value),
        owner = ownerFor(expression);
      if (target && owner)
        addEdge(
          owner.id,
          target.id,
          "passes",
          "함수 값을 인수 또는 화면 속성으로 전달",
          expression,
        );
      else
        notices.push({
          path,
          line:
            sf.getLineAndCharacterOfPosition(expression.getStart()).line + 1,
          message: `전달된 함수 값의 구현을 정적으로 확인하지 못했습니다: ${expression.getText(sf)}`,
        });
    };
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const resolved = ts.resolveModuleName(
          node.moduleSpecifier.text,
          sf.fileName,
          options,
          host,
        ).resolvedModule;
        const target =
          resolved &&
          sourceFiles.has(resolved.resolvedFileName.slice(root.length))
            ? idFor("file", resolved.resolvedFileName.slice(root.length))
            : undefined;
        if (target)
          addEdge(
            idFor("file", path),
            target,
            "imports",
            node.moduleSpecifier.text,
            node,
          );
        else
          notices.push({
            path,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            message: `가져온 범위 밖의 모듈 또는 미해석 경로: ${node.moduleSpecifier.text}`,
          });
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        for (const argument of node.arguments ?? []) passedFunction(argument);
        const signature = checker.getResolvedSignature(node);
        const target =
          (signature?.declaration && declarations.get(signature.declaration)) ||
          resolveSymbol(node.expression);
        const owner = ownerFor(node);
        if (target && owner)
          addEdge(
            owner.id,
            target.id,
            "calls",
            node.expression.getText(sf),
            node,
            signature?.declaration?.kind === ts.SyntaxKind.JSDocSignature
              ? undefined
              : signature?.declaration,
          );
        else if (
          ts.isIdentifier(node.expression) &&
          !["String", "Number", "Boolean", "Error", "require"].includes(
            node.expression.text,
          )
        )
          notices.push({
            path,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            message: `호출 대상을 정적으로 확인하지 못했습니다: ${node.expression.getText(sf)}`,
          });
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")
        )
          notices.push({
            path,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            message: "동적 import/require의 실행 연결은 확인하지 않았습니다.",
          });
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const target = resolveSymbol(node.tagName),
          owner = ownerFor(node);
        if (target && owner)
          addEdge(
            owner.id,
            target.id,
            "renders",
            node.tagName.getText(sf),
            node,
          );
      }
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      )
        passedFunction(node.initializer.expression);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // Append convention-based candidates after compiler edges to preserve their IDs.
  const routes = routeCandidates(input, sourceFiles, checker);
  notices.push(...routes.notices);
  for (const match of routes.matches) {
    const owner = ownerFor(match.call);
    const target = nodes.find(
      (node) => node.id === idFor("file", match.targetPath),
    );
    if (owner?.syntaxValid && target?.syntaxValid)
      addEdge(
        owner.id,
        target.id,
        "routes",
        "요청 경로 후보",
        match.call,
        undefined,
        match.detail,
      );
  }
  for (const [edge, pending] of siteHashes)
    hashTasks.push(
      Promise.all(pending).then(async (hashes) => {
        edge.evidenceHash = await sha256(JSON.stringify(hashes));
      }),
    );
  await Promise.all(hashTasks);
  return {
    schemaVersion: 1,
    revision: await sha256(
      "static-structure:5:route-candidates\n" +
        [...hashes.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([p, h]) => `${p}:${h}`)
          .join("\n"),
    ),
    nodes,
    edges,
    files: input.map((file) => ({
      path: file.path,
      hash: hashes.get(file.path)!,
      supported: sourceFiles.has(file.path),
    })),
    notices,
  };
}
