import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, access, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { FileAnalysis, Patch, SourceFile } from "../../src/core/types";
import { validateAnalysis } from "./pythonSource";

export type JavaOptions = {
  javaHome?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  buildTimeoutMs?: number;
};
function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Exclude JAVA_TOOL_OPTIONS, JDK_JAVA_OPTIONS, _JAVA_OPTIONS, CLASSPATH,
  // compiler plugins and project launcher hooks. Only fixed arguments run.
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
  return env;
}
async function invoke(
  executable: string,
  args: string[],
  input: string,
  signal: AbortSignal | undefined,
  timeout: number,
  maxBytes = 2 * 1024 * 1024,
): Promise<string> {
  if (signal?.aborted) throw Error("Java 작업 취소 / Java work cancelled");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: dirname(process.execPath),
      env: environment(),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false,
      size = 0,
      stderr = "";
    const chunks: Buffer[] = [];
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
    const cancel = () => finish(Error("Java 작업 취소 / Java work cancelled"));
    const timer = setTimeout(
      () => finish(Error("Java 도구 시간 초과 / Java tool timed out")),
      timeout,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () =>
      finish(
        Error(
          "JDK를 실행할 수 없습니다. JDK 21+ 설치·경로를 확인하세요. / JDK unavailable; check a JDK 21+ installation and path.",
        ),
      ),
    );
    child.stdin.on("error", () => {});
    child.stderr.on("data", (b: Buffer) => {
      if (stderr.length < 4096)
        stderr += b.toString("utf8").slice(0, 4096 - stderr.length);
    });
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > maxBytes) finish(Error("Java response limit exceeded"));
      else if (!settled) chunks.push(b);
    });
    child.on("close", (code) => {
      if (!settled)
        finish(
          code === 0
            ? undefined
            : Error(
                `Java 도구 실패 / Java tool failed (${code}): ${stderr.slice(0, 1000)}`,
              ),
        );
    });
    child.stdin.end(input);
  });
}
const malformedUnicode =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export async function javaSource(
  file: SourceFile,
  script: string,
  cache: string,
  action:
    | { action: "analyze" }
    | { action: "patch"; ruleId: string; value: string },
  options: JavaOptions = {},
): Promise<FileAnalysis | Patch> {
  if (Buffer.byteLength(file.content, "utf8") > 128 * 1024)
    throw Error("Java 설명은 128KiB까지입니다. / Java analysis limit: 128KiB.");
  if (
    malformedUnicode.test(file.content) ||
    (action.action === "patch" && malformedUnicode.test(action.value))
  )
    throw Error("Java input contains an unpaired Unicode surrogate");
  const home = options.javaHome || process.env.JAVA_HOME || "";
  if (home && !isAbsolute(home))
    throw Error(
      "JDK 홈은 절대 경로여야 합니다. / JDK home must be an absolute directory path.",
    );
  const suffix = process.platform === "win32" ? ".exe" : "";
  const java = home ? join(home, "bin", "java" + suffix) : "java";
  const javac = home ? join(home, "bin", "javac" + suffix) : "javac";
  const timeout = options.timeoutMs ?? 5000;
  const version = await invoke(
    java,
    ["--version"],
    "",
    options.signal,
    timeout,
    8192,
  );
  const compiler = await invoke(
    javac,
    ["--version"],
    "",
    options.signal,
    timeout,
    8192,
  );
  const runtimeVersion = version.match(
    /^(?:openjdk|java) (\d+(?:\.\d+)*)(?:[+\s-]|$)/,
  )?.[1];
  const compilerVersion = compiler.match(
    /^javac (\d+(?:\.\d+)*)(?:[+\s-]|$)/,
  )?.[1];
  if (
    !runtimeVersion ||
    Number(runtimeVersion.split(".")[0]) < 21 ||
    runtimeVersion !== compilerVersion
  )
    throw Error(
      "같은 JDK 21+의 java·javac가 필요합니다. / Matching java and javac from JDK 21+ are required.",
    );
  const key = createHash("sha256")
    .update(await readFile(script))
    .update(version)
    .update(compiler)
    .update(java)
    .update(javac)
    .update(process.platform + process.arch)
    .digest("hex");
  const directory = join(cache, key),
    main = join(directory, "PureobomJavaSource.class");
  await mkdir(cache, { recursive: true });
  try {
    await access(main);
  } catch {
    const pending = join(cache, key + "-" + randomUUID());
    await mkdir(pending);
    try {
      await invoke(
        javac,
        [
          "-J-Xmx256m",
          "-J-Dfile.encoding=UTF-8",
          "-proc:none",
          "-implicit:none",
          "-encoding",
          "UTF-8",
          "--release",
          "21",
          "-classpath",
          pending,
          "-sourcepath",
          pending,
          "-d",
          pending,
          script,
        ],
        "",
        options.signal,
        options.buildTimeoutMs ?? 60000,
        32768,
      );
      await access(join(pending, "PureobomJavaSource.class"));
      try {
        await rename(pending, directory);
      } catch (error) {
        if (
          !["EEXIST", "EPERM", "ENOTEMPTY"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
        await access(main);
      }
    } finally {
      if (!resolve(pending).startsWith(resolve(cache) + sep))
        throw Error("Invalid Java cache cleanup path");
      await rm(pending, { recursive: true, force: true });
    }
  }
  const request = [
    action.action,
    file.path,
    file.content,
    action.action === "patch" ? action.ruleId : "",
    action.action === "patch" ? action.value : "",
  ]
    .map((s) => Buffer.from(s, "utf8").toString("base64"))
    .join("\n");
  if (request.length > 200000) throw Error("Java request limit exceeded");
  const raw = await invoke(
    java,
    [
      "-Xmx192m",
      "-Xss1m",
      "-Dfile.encoding=UTF-8",
      "-Dstdout.encoding=UTF-8",
      "-Dstderr.encoding=UTF-8",
      "--class-path",
      directory,
      "PureobomJavaSource",
    ],
    request,
    options.signal,
    timeout,
  );
  let response: { error?: string; result?: unknown };
  try {
    response = JSON.parse(raw);
  } catch {
    throw Error("Java analysis response unavailable");
  }
  if (typeof response.error === "string")
    throw Error(response.error.slice(0, 1000));
  if (action.action === "analyze")
    return validateAnalysis(response.result, file, "java");
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
      "Java 변경 범위를 확인할 수 없습니다. / Invalid Java patch result.",
    );
  return p;
}
