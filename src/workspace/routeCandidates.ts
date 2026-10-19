import ts from "typescript";
import type { SourceFile } from "../core/types";
import { connectionSite } from "./connectionSite";
import type { StructureGraph } from "./model";

const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);
const unwrap = (expression: ts.Expression): ts.Expression => {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression;
  return value;
};

/** File convention candidates, not proof that a network request reaches a handler.
 * Never execute Next config or a fetcher to infer routing. */
export function routeCandidates(
  input: SourceFile[],
  sourceFiles: Map<string, ts.SourceFile>,
  checker: ts.TypeChecker,
) {
  const matches: {
    call: ts.CallExpression;
    targetPath: string;
    detail: ReturnType<typeof connectionSite>;
  }[] = [];
  const notices: StructureGraph["notices"] = [];
  let next = false;
  try {
    const manifest = JSON.parse(
      input.find((file) => file.path === "package.json")?.content ?? "{}",
    );
    next = [manifest.dependencies, manifest.devDependencies].some(
      (deps) => deps && typeof deps.next === "string" && deps.next.trim(),
    );
  } catch {
    /* Invalid manifest is not framework evidence. */
  }
  if (!next) return { matches, notices };

  const appRoot = input.some((file) => file.path.startsWith("app/"))
    ? "app/"
    : "src/app/";
  const routes = new Map<string, string[]>();
  const localSources = new Set(
    [...sourceFiles.values()].map((file) => file.fileName),
  );
  for (const [path, sf] of sourceFiles) {
    if (!path.startsWith(appRoot) || !/(?:^|\/)route\.[jt]s$/.test(path))
      continue;
    const parts = path.slice(appRoot.length).split("/").slice(0, -1);
    // Dynamic, parallel, private and intercepted routes need more context.
    if (
      parts.some(
        (part) =>
          /[\[\]@%]/.test(part) ||
          part.startsWith("_") ||
          part.startsWith("(."),
      )
    )
      continue;
    const segments = parts.filter((part) => !/^\([^()]+\)$/.test(part));
    if (segments.some((part) => /[()]/.test(part))) continue;
    const module = checker.getSymbolAtLocation(sf);
    const exports = module ? checker.getExportsOfModule(module) : [];
    if (
      !exports.some((symbol) => {
        if (!methods.has(symbol.name)) return false;
        const value =
          symbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(symbol)
            : symbol;
        const declaration = value.valueDeclaration ?? value.declarations?.[0];
        return (
          declaration &&
          checker.getSignaturesOfType(
            checker.getTypeOfSymbolAtLocation(value, declaration),
            ts.SignatureKind.Call,
          ).length
        );
      })
    )
      continue;
    const url = "/" + segments.join("/");
    routes.set(url, [...(routes.get(url) ?? []), path]);
  }

  const api = (call: ts.CallExpression): "fetch" | "SWR" | undefined => {
    const expression = unwrap(call.expression);
    if (!ts.isIdentifier(expression)) return;
    const symbol = checker.getSymbolAtLocation(expression);
    // A local parameter, import or declaration named fetch is not the global API.
    if (expression.text === "fetch" && !symbol?.declarations?.length)
      return "fetch";
    for (const declaration of symbol?.declarations ?? []) {
      const clause = ts.isImportClause(declaration)
        ? declaration
        : ts.isImportSpecifier(declaration) &&
            declaration.propertyName?.text === "default"
          ? declaration.parent.parent
          : undefined;
      if (
        !clause ||
        !ts.isImportClause(clause) ||
        clause.isTypeOnly ||
        (ts.isImportSpecifier(declaration) && declaration.isTypeOnly)
      )
        continue;
      const statement = clause.parent;
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "swr" &&
        !checker
          .getSymbolAtLocation(statement.moduleSpecifier)
          ?.declarations?.some((node) =>
            localSources.has(node.getSourceFile().fileName),
          )
      )
        return "SWR";
    }
  };
  for (const [path, sf] of sourceFiles) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = api(node);
        if (name) {
          const notice = (message: string) =>
            notices.push({
              path,
              line:
                sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              message,
            });
          const argument = node.arguments[0] && unwrap(node.arguments[0]);
          if (
            !argument ||
            !(
              ts.isStringLiteral(argument) ||
              ts.isNoSubstitutionTemplateLiteral(argument)
            )
          ) {
            // null explicitly disables a SWR request; it is not an unresolved route.
            if (
              !(name === "SWR" && argument?.kind === ts.SyntaxKind.NullKeyword)
            )
              notice(
                `${name}의 동적 주소·키는 경로 후보와 연결하지 않았습니다. 원문에서 확인하세요.`,
              );
          } else {
            const address = argument.text;
            if (address.startsWith("/") && !address.startsWith("//")) {
              const pathname =
                address.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
              const segments = pathname.slice(1).split("/");
              const normalized =
                !/[\\%\s]/.test(pathname) &&
                (pathname === "/" ||
                  segments.every(
                    (part) => part && part !== "." && part !== "..",
                  ));
              const candidates = normalized ? (routes.get(pathname) ?? []) : [];
              if (candidates.length === 1) {
                const detail = connectionSite("calls", node);
                if (detail.site.inputs.length === 12) {
                  detail.site.inputs.pop();
                  detail.site.omittedInputs++;
                }
                detail.site.summary = `${name === "SWR" ? "SWR의 고정 키" : "fetch의 고정 주소"}와 Next.js App Router 파일 경로가 일치하는 후보입니다. 실제 요청 실행·도착 여부는 확인하지 않았습니다.`;
                detail.site.inputs.unshift({
                  label: "경로에 대응하는 파일 후보",
                  code: candidates[0],
                  description: `${pathname} → ${candidates[0]}`,
                });
                if (name === "SWR")
                  detail.site.summary +=
                    " SWR 키만으로 HTTP 메서드나 fetcher의 동작을 확정하지 않습니다.";
                detail.evidence.push(
                  "next-app-route-candidate:1",
                  name,
                  pathname,
                  candidates[0],
                );
                matches.push({ call: node, targetPath: candidates[0], detail });
              } else
                notice(
                  candidates.length > 1
                    ? `요청 경로 후보가 여러 파일에 겹칩니다: ${pathname}. 자동 연결하지 않았습니다.`
                    : `고정 App Router 경로 후보를 찾지 못했습니다: ${address.slice(0, 240)}. 동적 경로·재작성·외부 서버는 별도 확인이 필요합니다.`,
                );
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { matches, notices };
}
