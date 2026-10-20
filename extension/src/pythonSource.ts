import { spawn } from "node:child_process";
import { dirname } from "node:path";
import type {
  Anchor,
  FileAnalysis,
  Patch,
  SourceFile,
  Step,
} from "../../src/core/types";

export const pythonSourceLimit = 128 * 1024;
export async function pythonSource(
  file: SourceFile,
  script: string,
  action:
    | { action: "analyze" }
    | { action: "patch"; ruleId: string; value: string },
  options: {
    executable?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<FileAnalysis | Patch> {
  if (Buffer.byteLength(file.content, "utf8") > pythonSourceLimit)
    throw Error(
      "Python 설명은 128KB까지입니다. / Python analysis limit: 128KB.",
    );
  if (options.signal?.aborted) throw Error("Python analysis cancelled.");
  const result = await new Promise<unknown>((resolve, reject) => {
    const child = spawn(
      options.executable ||
        (process.platform === "win32" ? "python" : "python3"),
      ["-I", "-S", script],
      {
        cwd: dirname(process.execPath),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let settled = false,
      size = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(value);
    };
    const cancel = () =>
      finish(Error("Python 분석을 취소했습니다. / Python analysis cancelled."));
    const timer = setTimeout(
      () => finish(Error("Python 분석 시간 초과 / Python analysis timed out")),
      options.timeoutMs ?? 5000,
    );
    options.signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () =>
      finish(
        Error(
          "Python을 실행할 수 없습니다. Python 3 설치·실행 경로를 확인하세요. / Python unavailable; check Python 3 and its executable path.",
        ),
      ),
    );
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024)
        finish(
          Error(
            "Python 분석 응답 한도 초과 / Python analysis response limit exceeded",
          ),
        );
      else if (!settled) chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0)
          throw Error(
            "Python 분석기 종료 / Python reader exited without a result.",
          );
        const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof response.error === "string")
          throw Error(response.error.slice(0, 1000));
        if (!response.result) throw Error("Python result unavailable.");
        finish(undefined, response.result);
      } catch (error) {
        finish(error instanceof Error ? error : Error(String(error)));
      }
    });
    child.stdin.end(
      JSON.stringify({ source: file.content, path: file.path, ...action }),
    );
  });
  if (action.action === "patch") {
    const patch = result as Patch;
    if (
      patch.path !== file.path ||
      patch.original !== file.content ||
      patch.ruleId !== action.ruleId ||
      patch.semanticChecked !== false ||
      typeof patch.newText !== "string" ||
      patch.newText.length > 30000 ||
      !Number.isInteger(patch.start) ||
      !Number.isInteger(patch.end) ||
      patch.start < 0 ||
      patch.end <= patch.start ||
      patch.end > file.content.length ||
      file.content.slice(patch.start, patch.end) !== patch.oldText ||
      patch.newText === patch.oldText ||
      patch.updated !==
        file.content.slice(0, patch.start) +
          patch.newText +
          file.content.slice(patch.end) ||
      typeof patch.description?.ko !== "string" ||
      typeof patch.description?.en !== "string"
    )
      throw Error(
        "Python 변경 범위를 확인할 수 없습니다. / Invalid Python patch result.",
      );
    return patch;
  }
  return validateAnalysis(result, file);
}

export function validateAnalysis(
  value: unknown,
  file: SourceFile,
  syntax: "python" | "go" | "java" | "csharp" = "python",
): FileAnalysis {
  const a = value as FileAnalysis;
  const fail = () => {
    throw Error(
      `${syntax} 분석 결과를 확인할 수 없습니다. / Invalid ${syntax} analysis result.`,
    );
  };
  if (
    !a ||
    a.path !== file.path ||
    a.kind !== "script" ||
    typeof a.syntaxValid !== "boolean" ||
    !a[syntax] ||
    typeof a[syntax].version !== "string" ||
    typeof a[syntax].truncated !== "boolean" ||
    (syntax === "csharp" && typeof a.csharp?.languageVersion !== "string") ||
    !Array.isArray(a.rules) ||
    a.rules.length > 300 ||
    !Array.isArray(a.functions) ||
    a.functions.length > 100 ||
    !Array.isArray(a.steps) ||
    !Array.isArray(a.issues) ||
    !Array.isArray(a.imports) ||
    !Number.isInteger(a.explained) ||
    !Number.isInteger(a.total)
  )
    fail();
  const anchor = (n: Anchor) => {
    if (
      ![n.start, n.end, n.line, n.endLine].every(Number.isInteger) ||
      n.start < 0 ||
      n.end < n.start ||
      n.end > file.content.length ||
      n.line < 1 ||
      n.endLine < n.line
    )
      fail();
  };
  const words = (w: { ko: string; en: string }) => {
    if (!w || typeof w.ko !== "string" || typeof w.en !== "string") fail();
  };
  const pending: Step[] = [...a.steps];
  for (const fn of a.functions) {
    anchor(fn);
    words(fn.label);
    if (fn.note) words(fn.note);
    if (
      typeof fn.name !== "string" ||
      !Array.isArray(fn.steps) ||
      !Array.isArray(fn.params) ||
      fn.simulatable !== false
    )
      fail();
    pending.push(...fn.steps);
  }
  let count = 0;
  while (pending.length) {
    const step = pending.pop()!;
    if (++count > 1500 || !Array.isArray(step.children)) fail();
    anchor(step);
    words(step.text);
    pending.push(...step.children);
    if (step.otherwise) pending.push(...step.otherwise);
    if (step.finalizer) pending.push(step.finalizer);
    for (const branch of step.branches || []) {
      words(branch.label);
      pending.push(...branch.steps);
    }
  }
  for (const rule of a.rules) {
    anchor(rule);
    words(rule.label);
    if (
      rule.syntax !== syntax ||
      rule.id !== `${syntax}:${rule.start}` ||
      !["string", "number", "boolean"].includes(rule.type) ||
      !["string", "boolean"].includes(typeof rule.value) ||
      rule.raw !== file.content.slice(rule.start, rule.end)
    )
      fail();
  }
  return a;
}
