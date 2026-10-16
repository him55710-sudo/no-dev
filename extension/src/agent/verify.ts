import { spawn } from "node:child_process";
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
): Promise<VerificationResult> {
  const start = Date.now(),
    available = await availableChecks(root, true);
  signal.throwIfAborted();
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
    const child = spawn(
      windows ? "cmd.exe" : available.manager,
      windows
        ? ["/d", "/s", "/c", `${available.manager} run ${name}`]
        : ["run", name],
      {
        cwd: root,
        windowsHide: true,
        shell: false,
        detached: !windows,
        env: {
          ...process.env,
          CI: "true",
          FORCE_COLOR: "0",
          pnpm_config_verify_deps_before_run: "false",
        },
        stdio: "pipe",
      },
    );
    let output = "",
      timedOut = false;
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-24000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.stdin.end();
    const stop = () => {
      if (!child.pid || child.exitCode !== null) return;
      if (windows) {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
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
      signal.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
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
    });
    if (signal.aborted) stop();
  });
}
