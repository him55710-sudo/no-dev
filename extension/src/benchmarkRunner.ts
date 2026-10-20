import { spawn } from "node:child_process";
import { join } from "node:path";
import { readBenchmark, type BenchmarkResult } from "../../src/core/benchmark";

export type CommandPlan = {
  argv: string[];
  cwd: string;
  env: Record<string, string | null>;
};
export function runBenchmark(
  python: string,
  script: string,
  plan: CommandPlan,
  signal: AbortSignal,
  progress: (completed: number) => void,
): Promise<BenchmarkResult> {
  const input = JSON.stringify(plan);
  if (Buffer.byteLength(input) + 1 > 65536)
    return Promise.reject(Error("Measurement plan exceeds 64 KiB"));
  if (signal.aborted)
    return Promise.reject(
      Error("측정이 취소됐습니다. / Measurement cancelled."),
    );
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-I", "-S", script], {
      cwd: plan.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let buffer = "",
      bytes = 0,
      stderr = "",
      result: BenchmarkResult | undefined,
      error: Error | undefined,
      ended = false,
      stopSent = false,
      nextIndex = 0,
      completed = -1;
    let deadline: ReturnType<typeof setTimeout> | undefined,
      escalation: ReturnType<typeof setTimeout> | undefined;
    function stop(reason: Error) {
      error ||= reason;
      if (ended || stopSent || !child.pid) return;
      stopSent = true;
      if (process.platform === "win32") {
        const killer = spawn(
          join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore", shell: false },
        );
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* already exited */
        }
        escalation ||= setTimeout(() => {
          if (!ended)
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {
              /* already exited */
            }
        }, 3000);
      }
    }
    const abort = () =>
      stop(Error("측정이 취소됐습니다. / Measurement cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const resetDeadline = () => {
      clearTimeout(deadline);
      deadline = setTimeout(
        () =>
          stop(
            Error(
              "한 실행이 30초를 넘었습니다. / One command exceeded 30 seconds.",
            ),
          ),
        30000,
      );
    };
    resetDeadline();
    child.on("error", (e) => {
      error = Error(
        `Python 3를 실행할 수 없습니다. 설정 pureobom.benchmarkPython에서 실행 파일을 확인하세요. / Cannot start Python 3; check the pureobom.benchmarkPython setting. ${e.message}`,
      );
    });
    child.stdin.on("error", (e) => {
      error ||= e;
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (part: string) => {
      stderr = (stderr + part).slice(-2500);
    });
    child.stdout.on("data", (part: string) => {
      bytes += Buffer.byteLength(part);
      buffer += part;
      if (bytes > 65536) {
        stop(Error("Measurement worker response too large"));
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (
            event.type === "start" &&
            event.index === nextIndex &&
            nextIndex < 8 &&
            completed === nextIndex - 1
          ) {
            nextIndex++;
            resetDeadline();
          } else if (
            event.type === "progress" &&
            event.completed === nextIndex - 1 &&
            completed === event.completed - 1 &&
            event.total === 7
          ) {
            completed = event.completed;
            progress(completed);
          } else if (event.type === "result" && completed === 7 && !result)
            result = readBenchmark(event.result);
          else if (event.type === "error")
            stop(Error(String(event.message).slice(0, 2500)));
          else throw Error("Unexpected measurement event");
        } catch (e) {
          stop(e instanceof Error ? e : Error(String(e)));
        }
      }
    });
    child.on("close", (code) => {
      ended = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (code !== 0 || !result)
        reject(
          Error(
            `측정 도구를 실행하지 못했습니다. Python 3 설정을 확인하세요. / Check the Python 3 executable. ${stderr}`,
          ),
        );
      else resolve(result);
    });
    child.stdin.end(input + "\n");
  });
}
