import { spawnOwnedProcess } from "./ownedProcess";
import { access, readFile } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import type {
  VerificationName,
  VerificationResult,
} from "../../../src/workspace/job";
async function installedManager() {
  const suffixes =
    process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];
  for (const name of ["npm", "pnpm", "yarn", "bun"]) {
    for (const folder of (process.env.PATH ?? process.env.Path ?? "").split(
      delimiter,
    )) {
      if (!folder) continue;
      for (const suffix of suffixes) {
        try {
          await access(resolve(folder, name + suffix));
          return name;
        } catch {
          /* Try the next installed launcher. */
        }
      }
    }
  }
  throw Error("npm, pnpm, yarn 또는 bun 실행 파일이 필요합니다.");
}
export async function availableChecks(
  root: string,
  resolveManager = false,
): Promise<{
  manager: string;
  names: VerificationName[];
  scripts: Record<string, string>;
}> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    );
    const manager =
      /^(pnpm|npm|yarn|bun)@/.exec(manifest.packageManager ?? "")?.[1] ??
      (resolveManager ? await installedManager() : "npm");
    const names = (["test", "typecheck", "check", "build"] as const).filter(
      (name) => typeof manifest.scripts?.[name] === "string",
    );
    return {
      manager,
      names,
      scripts: Object.fromEntries(
        names.map((name) => [name, manifest.scripts[name]]),
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { manager: "npm", names: [], scripts: {} };
    throw error;
  }
}
/** Only fixed package-manager/script choices, never a model-supplied shell string. */
export async function verifyWorkspace(
  root: string,
  name: VerificationName,
  signal: AbortSignal,
  timeoutMs = 180000,
  expectedScript?: string,
  expectedManager?: string,
): Promise<VerificationResult> {
  const start = Date.now(),
    available = await availableChecks(root, true);
  signal.throwIfAborted();
  if (expectedManager !== undefined && available.manager !== expectedManager)
    return {
      name,
      status: "failed",
      output:
        "검사 실행기가 구현 도중 바뀌었습니다. 기존 실행기를 유지하거나 새 설정을 별도로 검토해야 합니다.",
      elapsedMs: Date.now() - start,
    };
  if (
    expectedScript !== undefined &&
    available.scripts[name] !== expectedScript
  )
    return {
      name,
      status: "failed",
      output:
        "선택한 검사 명령이 구현 도중 바뀌었습니다. 기존 명령을 유지하거나 새 명령을 별도로 검토해야 합니다.",
      elapsedMs: Date.now() - start,
    };
  if (!available.names.includes(name))
    return {
      name,
      status: "missing",
      output: `package.json에 ${name} 명령이 없습니다.`,
      elapsedMs: Date.now() - start,
    };
  return new Promise((resolveDone, reject) => {
    // On Windows package-manager launchers are .cmd files. All interpolated tokens
    // are fixed allowlisted names; cwd and source text never enter the shell command.
    const windows = process.platform === "win32";
    const child = spawnOwnedProcess(
      windows ? "cmd.exe" : available.manager,
      windows
        ? ["/d", "/s", "/c", `${available.manager} run ${name}`]
        : ["run", name],
      {
        cwd: root,
        env: {
          ...process.env,
          CI: "true",
          FORCE_COLOR: "0",
          pnpm_config_verify_deps_before_run: "false",
        },
      },
    );
    let output = "",
      timedOut = false,
      settled = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let stopDetails = "종료 요청을 전달했습니다.";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-24000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.stdin.end();
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal.aborted) {
        reject(Error("검증을 취소했습니다."));
        return;
      }
      resolveDone({
        name,
        status: timedOut ? "timeout" : code === 0 ? "passed" : "failed",
        ...(code === null ? {} : { exitCode: code }),
        output,
        elapsedMs: Date.now() - start,
      });
    };
    const stop = () => {
      if (terminationTimer || settled) return;
      terminationTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          Error(
            `검사 프로세스 종료를 확인하지 못했습니다 (PID ${child.pid}, exit ${child.exitCode}). ${stopDetails} 검사 통과로 처리하지 않습니다.`,
          ),
        );
      }, 20000);
      // A parent can exit while descendants still hold its pipes. That must not
      // leave the verification promise pending forever either.
      if (!child.pid || child.exitCode !== null) return;
      if (windows) {
        stopDetails = "작업 프로세스 묶음의 종료를 요청했습니다.";
        child.kill();
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const abort = () => stop();
    signal.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(terminationTimer);
      signal.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      finish(code);
    });
    if (signal.aborted) stop();
  });
}
