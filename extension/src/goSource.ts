import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, access, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileAnalysis, Patch, SourceFile } from "../../src/core/types";
import { validateAnalysis } from "./pythonSource";

export type GoOptions = {
  executable?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  buildTimeoutMs?: number;
};
// Ignore project/toolchain environment hooks and never fetch modules or toolchains.
function environment(cache: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    GOTOOLCHAIN: "local",
    GOENV: "off",
    GOWORK: "off",
    GO111MODULE: "off",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTELEMETRY: "off",
    GOFLAGS: "",
    CGO_ENABLED: "0",
    GOCACHE: join(cache, "build-cache"),
    GOPATH: join(cache, "go-path"),
  };
}
async function invoke(
  executable: string,
  args: string[],
  input: string,
  cache: string,
  signal: AbortSignal | undefined,
  timeout: number,
  maxBytes = 2 * 1024 * 1024,
): Promise<string> {
  if (signal?.aborted) throw Error("Go 작업 취소 / Go work cancelled");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: dirname(process.execPath),
      env: environment(cache),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false,
      size = 0;
    const chunks: Buffer[] = [];
    let stderr = "";
    const stop = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return;
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
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill();
        }
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) {
        stop();
        reject(error);
      } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const cancel = () => finish(Error("Go 작업 취소 / Go work cancelled"));
    const timer = setTimeout(
      () => finish(Error("Go 도구 시간 초과 / Go tool timed out")),
      timeout,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () =>
      finish(
        Error(
          "Go 도구를 실행할 수 없습니다. 설치·실행 경로를 확인하세요. / Go unavailable; check the installed tool and executable path.",
        ),
      ),
    );
    child.stdin.on("error", () => {});
    child.stderr.on("data", (b: Buffer) => {
      if (stderr.length < 2000)
        stderr += b.toString("utf8").slice(0, 2000 - stderr.length);
    });
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > maxBytes) finish(Error("Go response limit exceeded"));
      else if (!settled) chunks.push(b);
    });
    child.on("close", (code) => {
      if (settled) return;
      finish(
        code === 0
          ? undefined
          : Error(
              `Go 도구 실패 / Go tool failed (${code}): ${stderr.slice(0, 1000)}`,
            ),
      );
    });
    child.stdin.end(input);
  });
}

export async function goSource(
  file: SourceFile,
  script: string,
  cache: string,
  action:
    | { action: "analyze" }
    | { action: "patch"; ruleId: string; value: string },
  options: GoOptions = {},
): Promise<FileAnalysis | Patch> {
  if (Buffer.byteLength(file.content, "utf8") > 128 * 1024)
    throw Error("Go 설명은 128KiB까지입니다. / Go analysis limit: 128KiB.");
  const executable = options.executable || "go";
  const version = (
    await invoke(
      executable,
      ["version"],
      "",
      cache,
      options.signal,
      options.timeoutMs ?? 5000,
      4096,
    )
  ).trim();
  if (!/^go version go\d+\.\d+(?:[^\r\n]*)$/.test(version))
    throw Error("Go version unavailable");
  const key = createHash("sha256")
    .update(await readFile(script))
    .update(version)
    .update(executable)
    .update(process.platform + process.arch)
    .digest("hex");
  const directory = join(cache, key);
  await mkdir(directory, { recursive: true });
  const binary = join(
    directory,
    process.platform === "win32" ? "reader.exe" : "reader",
  );
  try {
    await access(binary);
  } catch {
    const pending = join(
      directory,
      `${randomUUID()}${process.platform === "win32" ? ".exe" : ""}`,
    );
    try {
      await invoke(
        executable,
        ["build", "-trimpath", "-o", pending, script],
        "",
        cache,
        options.signal,
        options.buildTimeoutMs ?? 60000,
        32768,
      );
      // A concurrent request may have built the identical helper while we compiled.
      try {
        await rename(pending, binary);
      } catch (error) {
        if (
          !["EEXIST", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
        await access(binary);
      }
    } finally {
      try {
        await unlink(pending);
      } catch (error) {
        if (
          !["ENOENT", "EBUSY", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
      }
    }
  }
  const raw = await invoke(
    binary,
    [],
    JSON.stringify({ source: file.content, path: file.path, ...action }),
    cache,
    options.signal,
    options.timeoutMs ?? 5000,
  );
  let response: { result?: unknown; error?: string };
  try {
    response = JSON.parse(raw);
  } catch {
    throw Error("Go analysis response unavailable");
  }
  if (typeof response.error === "string")
    throw Error(response.error.slice(0, 1000));
  if (action.action === "analyze")
    return validateAnalysis(response.result, file, "go");
  const p = response.result as Patch;
  if (
    !p ||
    p.path !== file.path ||
    p.ruleId !== action.ruleId ||
    p.original !== file.content ||
    p.semanticChecked !== false ||
    !Number.isInteger(p.start) ||
    !Number.isInteger(p.end) ||
    p.start < 0 ||
    p.end <= p.start ||
    p.end > file.content.length ||
    typeof p.newText !== "string" ||
    p.newText.length > 30000 ||
    p.newText === p.oldText ||
    file.content.slice(p.start, p.end) !== p.oldText ||
    p.updated !==
      file.content.slice(0, p.start) + p.newText + file.content.slice(p.end) ||
    typeof p.description?.ko !== "string" ||
    typeof p.description?.en !== "string"
  )
    throw Error(
      "Go 변경 범위를 확인할 수 없습니다. / Invalid Go patch result.",
    );
  return p;
}
