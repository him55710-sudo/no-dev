import ts from "typescript";
import { diagnostics, parse } from "./analyze";

export function validateAssistantChange(language: string, source: string) {
  const extensions: Record<string, string> = {
    javascript: "js",
    javascriptreact: "jsx",
    typescript: "ts",
    typescriptreact: "tsx",
  };
  if (Object.hasOwn(extensions, language)) {
    const errors = diagnostics(
      parse({ path: `proposal.${extensions[language]}`, content: source }),
    );
    return {
      status: errors.length ? "syntax-failed" : "syntax-passed",
      detail: errors.length
        ? errors
            .slice(0, 3)
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
            .join("\n")
        : "JS/TS 문법 검사 통과. 타입·동작·성능은 미검증입니다. / JS/TS syntax passed; types, behavior and performance are unchecked.",
    };
  }
  if (language === "json") {
    try {
      JSON.parse(source);
      return {
        status: "syntax-passed",
        detail:
          "JSON 문법 검사 통과. 데이터 의미는 미검증입니다. / JSON syntax passed; meaning unchecked.",
      };
    } catch {
      return {
        status: "syntax-failed",
        detail: "JSON 문법 오류 / Invalid JSON syntax",
      };
    }
  }
  return {
    status: "unavailable",
    detail:
      "이 언어의 문법·타입·동작·성능 검사를 실행하지 않았습니다. / Syntax, types, behavior and performance were not checked for this language.",
  };
}
