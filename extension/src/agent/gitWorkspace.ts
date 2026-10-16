import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { relativePath } from "../../../src/workspace/model";

const exec = promisify(execFile);
const maxBytes = 32 * 1024 * 1024;
const excluded =
  /(^|\/)(?:\.pureobom|\.env(?:\.[^/]*)?|\.npmrc|\.netrc|\.pypirc|\.aws|\.ssh|[^/]*\.(?:pem|key|p12|pfx))($|\/)/i;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export type JobWorkspace = {
  id: string;
  source: string;
  path: string;
  directory: string;
  baseCommit: string;
  snapshot: string;
  ref: string;
  hashes: Record<string, string>;
  excluded: string[];
};
export type FileProposal = {
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  before: string | null;
  after: string | null;
};
export type ChangeReview = {
  id: string;
  workspaceId: string;
  files: FileProposal[];
};

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = await exec(
    "git",
    [
      "-c",
      "core.quotepath=false",
      "-c",
      "core.hooksPath=",
      "-C",
      root,
      ...args,
    ],
    {
      windowsHide: true,
      shell: false,
      maxBuffer: maxBytes,
      timeout: 30000,
      env: { ...process.env, ...env },
    },
  );
  return result.stdout;
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
async function safePath(root: string, path: string) {
  relativePath.parse(path);
  const absolute = resolve(root, path);
  if (!inside(root, absolute)) throw Error(`프로젝트 밖 경로: ${path}`);
  let current = root;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error(`심볼릭 링크 경로는 변경할 수 없습니다: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return absolute;
}
async function regularBytes(
  root: string,
  path: string,
  textOnly = true,
): Promise<Buffer | null> {
  const absolute = await safePath(root, path);
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) throw Error(`일반 파일이 아닙니다: ${path}`);
    if (info.size > 2 * 1024 * 1024)
      throw Error(`파일이 2MB 한도를 초과합니다: ${path}`);
    const bytes = await readFile(absolute);
    if (textOnly && bytes.includes(0))
      throw Error(`바이너리 파일 변경은 지원하지 않습니다: ${path}`);
    if (textOnly && !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes))
      throw Error(`UTF-8 파일이 아닙니다: ${path}`);
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function indexEntries(
  root: string,
  entries: string,
  env: NodeJS.ProcessEnv,
) {
  await new Promise<void>((resolveDone, reject) => {
    const child = spawn(
      "git",
      ["-C", root, "update-index", "-z", "--index-info"],
      {
        env: { ...process.env, ...env },
        windowsHide: true,
        shell: false,
        stdio: "pipe",
      },
    );
    let error = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Git 스냅샷 작성 시간이 초과됐습니다."));
    }, 30000);
    child.stderr.on("data", (data) => {
      error = (error + data.toString()).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdin.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveDone();
      else reject(Error(error || `Git index exit ${code}`));
    });
    child.stdin.end(entries);
  });
}

/** Snapshot dirty files through a private index; never stage or commit the user's index. */
export async function createJobWorkspace(
  source: string,
  storage: string,
): Promise<JobWorkspace> {
  const root = await realpath(source);
  const top = await realpath(
    (await git(root, ["rev-parse", "--show-toplevel"])).trim(),
  );
  if (root !== top)
    throw Error("Git 저장소의 최상위 폴더에서 구현 작업을 시작해 주세요.");
  const baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
  const id = randomUUID(),
    directory = resolve(storage, id),
    path = resolve(directory, "worktree");
  if (inside(root, directory))
    throw Error("구현 작업 공간은 원본 저장소 밖에 있어야 합니다.");
  await mkdir(directory, { recursive: true });
  const privateIndex = resolve(directory, "snapshot.index");
  const env = { GIT_INDEX_FILE: privateIndex };
  const candidates = [
    ...new Set(
      (
        await git(root, [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ])
      )
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  if (candidates.length > 5000)
    throw Error("구현 작업의 파일 수가 5,000개를 초과합니다.");
  const hashes: Record<string, string> = {},
    excludedPaths: string[] = [];
  const contents = new Map<string, Buffer>();
  let entries = "";
  let bytes = 0;
  for (const candidate of candidates) {
    if (excluded.test(candidate)) {
      excludedPaths.push(candidate);
      continue;
    }
    const content = await regularBytes(root, candidate, false);
    if (!content) continue;
    bytes += content.length;
    if (bytes > maxBytes) throw Error("구현 작업의 원본이 32MB를 초과합니다.");
    hashes[candidate] = hash(content);
    contents.set(candidate, content);
    // hash-object bypasses clean filters and line-ending conversion.
    const blobPath = resolve(directory, "snapshot-blob");
    await writeFile(blobPath, content);
    const blob = (
      await git(root, ["hash-object", "-w", "--no-filters", blobPath])
    ).trim();
    const executable =
      process.platform !== "win32" &&
      ((await lstat(resolve(root, candidate))).mode & 0o111) !== 0;
    entries += `${executable ? "100755" : "100644"} ${blob}\t${candidate}\0`;
  }
  if (!Object.keys(hashes).length)
    throw Error("구현할 텍스트 파일이 없습니다.");
  await git(root, ["read-tree", "--empty"], env);
  await indexEntries(root, entries, env);
  const tree = (await git(root, ["write-tree"], env)).trim();
  const snapshot = (
    await git(
      root,
      [
        "-c",
        "user.name=Pureobom",
        "-c",
        "user.email=local@pureobom.invalid",
        "commit-tree",
        tree,
        "-p",
        baseCommit,
        "-m",
        "Pureobom isolated implementation snapshot",
      ],
      env,
    )
  ).trim();
  const ref = `refs/pureobom/jobs/${id}`;
  await git(root, ["update-ref", ref, snapshot]);
  await git(root, [
    "worktree",
    "add",
    "--detach",
    "--no-checkout",
    path,
    snapshot,
  ]);
  await git(path, ["read-tree", snapshot]);
  for (const [name, content] of contents) {
    const destination = await safePath(path, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, {
      mode: (await lstat(resolve(root, name))).mode,
    });
  }
  const workspace = {
    id,
    source: root,
    path,
    directory,
    baseCommit,
    snapshot,
    ref,
    hashes,
    excluded: excludedPaths,
  };
  // Revalidate after Git filters/checkout and concurrent filesystem changes.
  for (const [name, digest] of Object.entries(hashes)) {
    const [original, copied] = await Promise.all([
      regularBytes(root, name, false),
      regularBytes(path, name, false),
    ]);
    if (
      !original ||
      hash(original) !== digest ||
      !copied ||
      hash(copied) !== digest
    )
      throw Error(
        `작업 복사 중 파일이 바뀌었거나 Git 변환이 적용됐습니다: ${name}`,
      );
  }
  await writeFile(
    resolve(directory, "workspace.json"),
    JSON.stringify(workspace, null, 2) + "\n",
    { flag: "wx" },
  );
  return workspace;
}

export async function reviewJobWorkspace(
  workspace: JobWorkspace,
): Promise<ChangeReview> {
  // Use the immutable snapshot rather than HEAD; agent commits cannot hide changes.
  const changed = (
    await git(workspace.path, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      workspace.snapshot,
      "--",
    ])
  ).split("\0");
  const untracked = (
    await git(workspace.path, [
      "ls-files",
      "-z",
      "--others",
      "--exclude-standard",
    ])
  ).split("\0");
  const paths = [...new Set([...changed, ...untracked].filter(Boolean))].sort();
  if (paths.length > 200)
    throw Error("변경 파일이 200개를 초과합니다. 작업을 나눠 주세요.");
  const files: FileProposal[] = [];
  for (const path of paths) {
    if (excluded.test(path) || /(^|\/)\.git($|\/)/i.test(path))
      throw Error(`허용되지 않은 변경 파일: ${path}`);
    const after = await regularBytes(workspace.path, path);
    // Before content comes from snapshot, not the potentially edited source checkout.
    const before = workspace.hashes[path]
      ? Buffer.from(
          await git(workspace.path, ["show", `${workspace.snapshot}:${path}`]),
          "utf8",
        )
      : null;
    if (before && hash(before) !== workspace.hashes[path])
      throw Error(`원본 스냅샷을 확인할 수 없습니다: ${path}`);
    if (
      (before && after && hash(before) === hash(after)) ||
      (!before && !after)
    )
      continue;
    files.push({
      path,
      beforeHash: before ? hash(before) : null,
      afterHash: after ? hash(after) : null,
      before: before?.toString("utf8") ?? null,
      after: after?.toString("utf8") ?? null,
    });
  }
  const id = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { id, workspaceId: workspace.id, files };
}

async function assertUnchanged(
  root: string,
  files: FileProposal[],
  side: "before" | "after",
) {
  for (const file of files) {
    const bytes = await regularBytes(root, file.path);
    if (
      (bytes ? hash(bytes) : null) !==
      file[(side + "Hash") as "beforeHash" | "afterHash"]
    )
      throw Error(`파일이 바뀌어 반영을 중단했습니다: ${file.path}`);
  }
}
async function writeContent(
  root: string,
  file: FileProposal,
  side: "before" | "after",
) {
  const path = await safePath(root, file.path),
    content = file[side];
  if (content === null) {
    await unlink(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.pureobom-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Caller must also reject dirty editor buffers and check current spec revision.
 * A durable journal is written before mutation. Failed partial writes are rolled back. */
export async function applyJobReview(
  workspace: JobWorkspace,
  review: ChangeReview,
  hook?: (index: number) => Promise<void>,
) {
  if (review.workspaceId !== workspace.id)
    throw Error("다른 작업의 변경입니다.");
  const current = await reviewJobWorkspace(workspace);
  if (current.id !== review.id)
    throw Error("검토한 변경이 바뀌었습니다. 다시 검토해 주세요.");
  const journal = resolve(workspace.directory, "apply.json");
  try {
    await lstat(journal);
    throw Error(
      "이미 반영 기록이 있습니다. 복구 또는 실행 취소를 먼저 확인해 주세요.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Any snapshot input drift can invalidate the generated changes, not just changed files.
  const inventory = [
    ...new Set(
      (
        await git(workspace.source, [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ])
      )
        .split("\0")
        .filter((path) => path && !excluded.test(path)),
    ),
  ];
  for (const path of inventory) {
    if (
      !(path in workspace.hashes) &&
      (await regularBytes(workspace.source, path, false))
    )
      throw Error(`구현 도중 원본에 파일이 추가됐습니다: ${path}`);
  }
  for (const [path, digest] of Object.entries(workspace.hashes)) {
    const content = await regularBytes(workspace.source, path, false);
    if (!content || hash(content) !== digest)
      throw Error(`구현 도중 원본이 바뀌었습니다: ${path}`);
  }
  await assertUnchanged(workspace.source, review.files, "before");
  const record = {
    schemaVersion: 1,
    review,
    state: "applying",
    written: [] as string[],
    error: "",
  };
  const persist = () =>
    writeFile(journal, JSON.stringify(record, null, 2) + "\n");
  await persist();
  const written: FileProposal[] = [];
  try {
    for (let i = 0; i < review.files.length; i++) {
      await hook?.(i);
      const file = review.files[i];
      await assertUnchanged(workspace.source, [file], "before");
      await writeContent(workspace.source, file, "after");
      written.push(file);
      record.written.push(file.path);
      await persist();
    }
    record.state = "applied";
    await persist();
  } catch (error) {
    const conflicts: string[] = [];
    for (const file of written.reverse()) {
      try {
        await assertUnchanged(workspace.source, [file], "after");
        await writeContent(workspace.source, file, "before");
      } catch {
        conflicts.push(file.path);
      }
    }
    record.state = conflicts.length ? "recovery-required" : "rolled-back";
    record.error = `${error instanceof Error ? error.message : String(error)}${conflicts.length ? ` 복구 충돌: ${conflicts.join(", ")}` : " 원본을 복구했습니다."}`;
    await persist();
    throw Error(record.error);
  }
}

export async function undoJobReview(
  workspace: JobWorkspace,
  review: ChangeReview,
) {
  const path = resolve(workspace.directory, "apply.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  if (record.state !== "applied" || record.review?.id !== review.id)
    throw Error("실행 취소할 반영 기록이 없습니다.");
  await assertUnchanged(workspace.source, review.files, "after");
  // Journal the reverse operation as well, so a crash cannot masquerade as success.
  record.state = "undoing";
  await writeFile(path, JSON.stringify(record, null, 2));
  for (const file of review.files) {
    await assertUnchanged(workspace.source, [file], "after");
    await writeContent(workspace.source, file, "before");
  }
  record.state = "undone";
  await writeFile(path, JSON.stringify(record, null, 2));
}

export async function readJobJournals(storage: string) {
  try {
    const folders = await readdir(storage, { withFileTypes: true });
    return Promise.all(
      folders
        .filter(
          (item) => item.isDirectory() && /^[a-f0-9-]{36}$/.test(item.name),
        )
        .map(async (item) => {
          const directory = resolve(storage, item.name);
          try {
            return {
              directory,
              workspace: JSON.parse(
                await readFile(resolve(directory, "workspace.json"), "utf8"),
              ),
              apply: JSON.parse(
                await readFile(resolve(directory, "apply.json"), "utf8"),
              ),
            };
          } catch {
            return { directory };
          }
        }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
