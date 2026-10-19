import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { z } from "zod";

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

/** Write-through temporary file + atomic replacement: readers see an entire revision. */
export async function writeRecord(path: string, value: unknown) {
  const content = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(content) > 64 * 1024 * 1024)
    throw Error("작업 기록이 64MB 제한을 초과합니다. 구현 범위를 나눠 주세요.");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function readRecord<T>(
  path: string,
  schema: z.ZodType<T>,
  maxBytes = 64 * 1024 * 1024,
) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw Error("작업 기록이 일반 파일이 아니거나 크기 제한을 초과합니다.");
  return schema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** An OS-owned, process-lifetime lease. No stale lock files or PID-based deletion.
 * Windows pipes and Linux abstract sockets avoid TCP port reservations/collisions.
 * Other platforms retain the conservative loopback fallback.
 * This coordinates this extension's mutations; external editors still use hash guards. */
export async function projectLease(canonicalRoot: string) {
  const key =
    process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
  const port = 32768 + (Number.parseInt(digest(key).slice(0, 8), 16) % 28000);
  const endpoint =
    process.platform === "win32"
      ? { path: "\\\\.\\pipe\\pureobom-project-" + digest(key) }
      : process.platform === "linux"
        ? { path: "\0pureobom-project-" + digest(key) }
        : { host: "127.0.0.1", port };
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((done, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        Error(
          `다른 작업이 이 프로젝트를 사용 중이거나 작업 잠금을 사용할 수 없습니다. 잠시 뒤 다시 확인해 주세요. (${error.code ?? "unknown"})`,
        ),
      ),
    );
    server.listen({ ...endpoint, exclusive: true }, done);
  });
  server.unref();
  return () =>
    new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
}
