import { spawn } from "node:child_process";
import { dirname } from "node:path";
import type { AssistantValidation } from "./localAssistantController";

// This fixed program parses stdin as data; it never imports or executes the user's file.
const checker = `import ast, json, sys
source = sys.stdin.buffer.read().decode("utf-8")
try:
    ast.parse(source, filename="proposal.py")
    result = {"valid": True, "version": sys.version.split()[0]}
except (SyntaxError, ValueError) as error:
    result = {"valid": False, "version": sys.version.split()[0], "message": str(error)}
sys.stdout.buffer.write(json.dumps(result, ensure_ascii=True).encode("utf-8"))
`;
export function validatePython(
  source: string,
  executable = process.platform === "win32" ? "python" : "python3",
  timeoutMs = 5000,
): Promise<AssistantValidation> {
  return new Promise((resolve) => {
    let settled = false,
      bytes = 0;
    const chunks: Buffer[] = [];
    const child = spawn(executable, ["-I", "-S", "-c", checker], {
      cwd: dirname(process.execPath),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const finish = (result: AssistantValidation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const unavailable = (detail: string) =>
      finish({ status: "unavailable", detail });
    const timer = setTimeout(() => {
      unavailable("Python 문법 검사 시간 초과 / Python syntax check timed out");
      child.kill();
    }, timeoutMs);
    child.on("error", () =>
      unavailable(
        "Python을 실행할 수 없어 문법을 검사하지 못했습니다. / Python unavailable; syntax not checked.",
      ),
    );
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16000) {
        unavailable(
          "Python 검사 응답 한도 초과 / Python check response exceeded the limit",
        );
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0) throw Error();
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          typeof result.valid !== "boolean" ||
          typeof result.version !== "string"
        )
          throw Error();
        finish({
          status: result.valid ? "syntax-passed" : "syntax-failed",
          detail: result.valid
            ? `Python ${result.version} 문법 검사 통과. 타입·동작·성능은 미검증입니다. / Syntax passed; types, behavior and performance are unchecked.`
            : `Python ${result.version}: ${String(result.message).slice(0, 2000)}`,
        });
      } catch {
        unavailable(
          "Python 검사 결과를 확인할 수 없습니다. / Python check result unavailable.",
        );
      }
    });
    child.stdin.end(Buffer.from(source, "utf8"));
  });
}
