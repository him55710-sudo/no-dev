import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  mkdir,
  access,
  rename,
  rm,
  readdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { FileAnalysis, Patch, SourceFile } from "../../src/core/types";
import { validateAnalysis } from "./pythonSource";

export type CSharpOptions = {
  dotnet?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  buildTimeoutMs?: number;
};
function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Exclude startup hooks, additional deps, profiler and build hooks.
  // No MSBuild, restore, source generators or user project is invoked.
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
  env.DOTNET_CLI_TELEMETRY_OPTOUT = "1";
  env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1";
  env.DOTNET_NOLOGO = "1";
  env.DOTNET_MULTILEVEL_LOOKUP = "0";
  env.DOTNET_EnableDiagnostics = "0";
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
  if (signal?.aborted) throw Error("C# 작업 취소 / C# work cancelled");
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
    const cancel = () => finish(Error("C# 작업 취소 / C# work cancelled"));
    const timer = setTimeout(
      () => finish(Error("C# 도구 시간 초과 / C# tool timed out")),
      timeout,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () =>
      finish(
        Error(
          "C# 도구를 실행할 수 없습니다. .NET SDK 8+ 설치·경로를 확인하세요. / .NET SDK 8+ unavailable; check installation and executable path.",
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
      if (size > maxBytes) finish(Error("C# response limit exceeded"));
      else if (!settled) chunks.push(b);
    });
    child.on("close", (code) => {
      if (!settled)
        finish(
          code === 0
            ? undefined
            : Error(
                `C# 도구 실패 / C# tool failed (${code}): ${stderr.slice(0, 1000)} ${Buffer.concat(chunks).toString("utf8").slice(0, 6000)}`,
              ),
        );
    });
    child.stdin.end(input);
  });
}
const malformedUnicode =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const stableVersion = /^\d+\.\d+\.\d+$/;
function descending(a: string, b: string) {
  const av = a.split(".").map(Number),
    bv = b.split(".").map(Number);
  return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
}
export async function csharpSource(
  file: SourceFile,
  script: string,
  cache: string,
  action:
    | { action: "analyze" }
    | { action: "patch"; ruleId: string; value: string },
  options: CSharpOptions = {},
): Promise<FileAnalysis | Patch> {
  if (Buffer.byteLength(file.content, "utf8") > 128 * 1024)
    throw Error("C# 설명은 128KiB까지입니다. / C# analysis limit: 128KiB.");
  if (
    malformedUnicode.test(file.content) ||
    (action.action === "patch" && malformedUnicode.test(action.value))
  )
    throw Error("C# input contains an unpaired Unicode surrogate");
  const executable = options.dotnet || "dotnet";
  if (executable !== "dotnet" && !isAbsolute(executable))
    throw Error(
      ".NET 실행기는 절대 경로여야 합니다. / Use an absolute dotnet executable path.",
    );
  const timeout = options.timeoutMs ?? 5000;
  const sdks = await invoke(
    executable,
    ["--list-sdks"],
    "",
    options.signal,
    timeout,
    32768,
  );
  const candidates = [...sdks.matchAll(/^(\d+\.\d+\.\d+) \[(.+)\]\s*$/gm)]
    .filter((m) => Number(m[1].split(".")[0]) >= 8)
    .sort((a, b) => descending(a[1], b[1]));
  const sdk = candidates[0];
  if (!sdk || !isAbsolute(sdk[2]))
    throw Error(
      ".NET SDK 8+가 필요합니다. 런타임만으로는 분석할 수 없습니다. / Install .NET SDK 8+; a runtime alone is insufficient.",
    );
  const sdkPath = join(sdk[2], sdk[1]),
    major = sdk[1].split(".")[0];
  const roslyn = join(sdkPath, "Roslyn", "bincore");
  const packRoot = join(dirname(sdk[2]), "packs", "Microsoft.NETCore.App.Ref");
  const pack = (await readdir(packRoot))
    .filter((v) => stableVersion.test(v) && v.split(".")[0] === major)
    .sort(descending)[0];
  if (!pack) throw Error(".NET SDK reference pack unavailable");
  const references = join(packRoot, pack, "ref", `net${major}.0`);
  const runtimes = await invoke(
    executable,
    ["--list-runtimes"],
    "",
    options.signal,
    timeout,
    32768,
  );
  const runtime = [
    ...runtimes.matchAll(
      /^Microsoft\.NETCore\.App (\d+\.\d+\.\d+) \[.+\]\s*$/gm,
    ),
  ]
    .map((m) => m[1])
    .filter((v) => v.split(".")[0] === major)
    .sort(descending)[0];
  if (!runtime) throw Error("Matching .NET SDK runtime unavailable");
  const key = createHash("sha256")
    .update(await readFile(script))
    .update(sdkPath)
    .update(executable)
    .update(pack)
    .update(runtime)
    .update(process.platform + process.arch)
    .digest("hex");
  const directory = join(cache, key),
    main = join(directory, "PureobomCSharpSource.dll");
  await mkdir(cache, { recursive: true });
  try {
    await access(main);
  } catch {
    const pending = join(cache, key + "-" + randomUUID());
    await mkdir(pending);
    try {
      const refFiles = (await readdir(references))
        .filter((f) => f.endsWith(".dll"))
        .sort()
        .map((f) => join(references, f));
      const libraries = [
        "Microsoft.CodeAnalysis.dll",
        "Microsoft.CodeAnalysis.CSharp.dll",
      ];
      const quote = (value: string) => {
        if (/["\r\n]/.test(value)) throw Error("Invalid C# tool path");
        return `"${value}"`;
      };
      const args = [
        "/noconfig",
        "/nologo",
        "/nostdlib+",
        "/target:exe",
        "/deterministic+",
        "/nullable:enable",
        "/langversion:12",
        `/out:${quote(join(pending, "PureobomCSharpSource.dll"))}`,
        ...refFiles.map((f) => `/reference:${quote(f)}`),
        ...libraries.map((f) => `/reference:${quote(join(roslyn, f))}`),
        quote(resolve(script)),
      ];
      await writeFile(join(pending, "compile.rsp"), args.join("\n"));
      await invoke(
        executable,
        [
          "exec",
          join(roslyn, "csc.dll"),
          "@" + resolve(pending, "compile.rsp"),
        ],
        "",
        options.signal,
        options.buildTimeoutMs ?? 60000,
        32768,
      );
      // Compiler stdout includes diagnostics on failure, so invocation preserves it below.
      for (const library of libraries)
        await copyFile(join(roslyn, library), join(pending, library));
      await writeFile(
        join(pending, "PureobomCSharpSource.runtimeconfig.json"),
        JSON.stringify({
          runtimeOptions: {
            tfm: `net${major}.0`,
            framework: { name: "Microsoft.NETCore.App", version: runtime },
            rollForward: "LatestPatch",
          },
        }),
      );
      await access(join(pending, "PureobomCSharpSource.dll"));
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
        throw Error("Invalid C# cache cleanup path");
      await rm(pending, { recursive: true, force: true });
    }
  }
  const request = JSON.stringify({
    path: file.path,
    content: file.content,
    ...action,
  });
  const raw = await invoke(
    executable,
    ["exec", main],
    request,
    options.signal,
    timeout,
  );
  let response: { error?: string; result?: unknown };
  try {
    response = JSON.parse(raw);
  } catch {
    throw Error("C# analysis response unavailable");
  }
  if (typeof response.error === "string")
    throw Error(response.error.slice(0, 1000));
  if (action.action === "analyze")
    return validateAnalysis(response.result, file, "csharp");
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
      "C# 변경 범위를 확인할 수 없습니다. / Invalid C# patch result.",
    );
  return p;
}
