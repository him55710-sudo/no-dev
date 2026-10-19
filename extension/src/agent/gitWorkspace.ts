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
import { homedir } from "node:os";
import { relativePath } from "../../../src/workspace/model";
import { z } from "zod";
import { digestSchema, writeRecord, readRecord, projectLease } from "./records";

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
const allowedPath = relativePath.refine(
  (path) => !excluded.test(path) && !/(^|\/)\.git($|\/)/i.test(path),
);
const workspaceSchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().refine(isAbsolute),
    path: z.string().refine(isAbsolute),
    directory: z.string().refine(isAbsolute),
    baseCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
    snapshot: z.string().regex(/^[a-f0-9]{40,64}$/),
    ref: z.string(),
    hashes: z
      .record(allowedPath, digestSchema)
      .refine((v) => Object.keys(v).length <= 5000),
    excluded: z.array(relativePath).max(5000),
  })
  .strict();
export const reviewSchema = z
  .object({
    id: digestSchema,
    workspaceId: z.string().uuid(),
    files: z
      .array(
        z
          .object({
            path: allowedPath,
            beforeHash: digestSchema.nullable(),
            afterHash: digestSchema.nullable(),
            before: z
              .string()
              .max(2 * 1024 * 1024)
              .nullable(),
            after: z
              .string()
              .max(2 * 1024 * 1024)
              .nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((review, context) => {
    const paths = new Set<string>();
    let bytes = 0;
    for (const file of review.files) {
      if (paths.has(file.path) || file.beforeHash === file.afterHash)
        context.addIssue({
          code: "custom",
          message: "중복되거나 변경이 없는 파일입니다.",
        });
      paths.add(file.path);
      for (const side of ["before", "after"] as const) {
        const content = file[side];
        const buffer = content === null ? null : Buffer.from(content);
        bytes += buffer?.length ?? 0;
        if (
          (buffer ? hash(buffer) : null) !== file[`${side}Hash`] ||
          (buffer && (buffer.length > 2 * 1024 * 1024 || buffer.includes(0)))
        )
          context.addIssue({
            code: "custom",
            message: "변경 내용과 해시가 일치하지 않습니다.",
          });
      }
    }
    if (
      bytes > maxBytes ||
      Buffer.byteLength(JSON.stringify(review)) > maxBytes ||
      hash(Buffer.from(JSON.stringify(review.files))) !== review.id
    )
      context.addIssue({
        code: "custom",
        message: "변경 기록을 확인할 수 없습니다.",
      });
  });
const journalSchema = z
  .object({
    schemaVersion: z.literal(1),
    review: reviewSchema,
    state: z.enum([
      "applying",
      "applied",
      "undoing",
      "undone",
      "recovering",
      "rolled-back",
      "recovery-required",
    ]),
    written: z.array(relativePath).max(200),
    error: z.string().max(24000),
  })
  .strict();
export type ApplyJournal = z.infer<typeof journalSchema>;

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
  requestedId: string = randomUUID(),
  compact = false,
): Promise<JobWorkspace> {
  z.string().uuid().parse(requestedId);
  const root = await realpath(source);
  await assertNoUnfinishedTransactions(root, storage);
  const top = await realpath(
    (await git(root, ["rev-parse", "--show-toplevel"])).trim(),
  );
  if (root !== top)
    throw Error("Git 저장소의 최상위 폴더에서 구현 작업을 시작해 주세요.");
  const baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
  const id = requestedId,
    directory = resolve(storage, id);
  if (inside(root, directory))
    throw Error("구현 작업 공간은 원본 저장소 밖에 있어야 합니다.");
  await mkdir(directory, { recursive: true });
  const path = compact
    ? await compactWorktreePath(await realpath(storage), id)
    : resolve(directory, "worktree");
  if (inside(root, path))
    throw Error("구현 작업 공간은 원본 저장소 밖에 있어야 합니다.");
  await mkdir(dirname(path), { recursive: true });
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
  await writeRecord(resolve(directory, "workspace.json"), workspace);
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
  return reviewSchema.parse({ id, workspaceId: workspace.id, files });
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
    await assertUnchanged(root, [file], side === "before" ? "after" : "before");
    await unlink(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.pureobom-${randomUUID()}.tmp`;
  try {
    const mode = await lstat(path).then(
      (info) => info.mode,
      (error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    await writeFile(temporary, content, { flag: "wx", mode });
    await assertUnchanged(root, [file], side === "before" ? "after" : "before");
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function originalLease(workspace: JobWorkspace) {
  if ((await realpath(workspace.source)) !== workspace.source)
    throw Error("원본 프로젝트 경로가 바뀌었습니다. 파일을 변경하지 않습니다.");
  return projectLease(workspace.source);
}

/** Caller must also reject dirty editor buffers and check current spec revision.
 * A durable journal is written before mutation. Failed partial writes are rolled back. */
export async function applyJobReview(
  workspace: JobWorkspace,
  review: ChangeReview,
  hook?: (index: number) => Promise<void>,
) {
  const release = await originalLease(workspace);
  try {
    await applyReview(workspace, reviewSchema.parse(review), hook);
  } finally {
    await release();
  }
}
async function applyReview(
  workspace: JobWorkspace,
  review: ChangeReview,
  hook?: (index: number) => Promise<void>,
) {
  await assertNoUnfinishedTransactions(
    workspace.source,
    dirname(workspace.directory),
    workspace.id,
  );
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
  const record: ApplyJournal = {
    schemaVersion: 1,
    review,
    state: "applying",
    written: [] as string[],
    error: "",
  };
  const persist = () => writeRecord(journal, record);
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
    record.error =
      `${error instanceof Error ? error.message : String(error)}${conflicts.length ? ` 복구 충돌: ${conflicts.join(", ")}` : " 원본을 복구했습니다."}`.slice(
        0,
        24000,
      );
    await persist();
    throw Error(record.error);
  }
}

export async function undoJobReview(
  workspace: JobWorkspace,
  review: ChangeReview,
  hook?: (index: number) => Promise<void>,
) {
  const release = await originalLease(workspace);
  try {
    await undoReview(workspace, reviewSchema.parse(review), hook);
  } finally {
    await release();
  }
}
async function undoReview(
  workspace: JobWorkspace,
  review: ChangeReview,
  hook?: (index: number) => Promise<void>,
) {
  const path = resolve(workspace.directory, "apply.json");
  const record = await readApplyJournal(workspace);
  if (!record) throw Error("실행 취소할 반영 기록이 없습니다.");
  if (record.state !== "applied" || record.review?.id !== review.id)
    throw Error("실행 취소할 반영 기록이 없습니다.");
  await assertUnchanged(workspace.source, review.files, "after");
  // Journal the reverse operation as well, so a crash cannot masquerade as success.
  record.state = "undoing";
  await writeRecord(path, record);
  try {
    for (let index = 0; index < review.files.length; index++) {
      await hook?.(index);
      const file = review.files[index];
      await assertUnchanged(workspace.source, [file], "after");
      await writeContent(workspace.source, file, "before");
    }
    record.state = "undone";
    await writeRecord(path, record);
  } catch (error) {
    record.state = "recovery-required";
    record.error =
      `되돌리기를 끝내지 못했습니다. 파일 상태를 확인해 복구해 주세요. ${String(error)}`.slice(
        0,
        24000,
      );
    await writeRecord(path, record);
    throw Error(record.error);
  }
}

export async function readApplyJournal(workspace: JobWorkspace) {
  let record: ApplyJournal;
  try {
    record = await readRecord(
      resolve(workspace.directory, "apply.json"),
      journalSchema,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (
    record.review.workspaceId !== workspace.id ||
    record.review.files.some(
      (file) => file.beforeHash !== (workspace.hashes[file.path] ?? null),
    )
  )
    throw Error("반영 기록이 원본 스냅샷과 일치하지 않습니다.");
  return record;
}

export type RecoveryFile = {
  path: string;
  state: "before" | "after" | "conflict";
};
/** written[] is only a log. A process can die after rename and before journaling. */
export async function inspectRecovery(
  workspace: JobWorkspace,
  review: ChangeReview,
): Promise<RecoveryFile[]> {
  return Promise.all(
    review.files.map(async (file) => {
      try {
        const bytes = await regularBytes(workspace.source, file.path);
        const actual = bytes ? hash(bytes) : null;
        return {
          path: file.path,
          state:
            actual === file.beforeHash
              ? "before"
              : actual === file.afterHash
                ? "after"
                : "conflict",
        };
      } catch {
        return { path: file.path, state: "conflict" };
      }
    }),
  );
}

/** Explicit recovery always restores the pre-application bytes. Never keeps a partial implementation. */
export async function recoverJobReview(
  workspace: JobWorkspace,
  reviewId: string,
) {
  const release = await originalLease(workspace);
  try {
    const record = await readApplyJournal(workspace);
    if (
      !record ||
      record.review.id !== reviewId ||
      !["applying", "undoing", "recovering", "recovery-required"].includes(
        record.state,
      )
    )
      throw Error("복구할 미완료 반영 기록이 없습니다.");
    const states = await inspectRecovery(workspace, record.review);
    const conflicts = states.filter((file) => file.state === "conflict");
    if (conflicts.length)
      throw Error(
        `이후 수정한 파일을 보존하기 위해 복구를 중단했습니다: ${conflicts.map((f) => f.path).join(", ")}`,
      );
    const path = resolve(workspace.directory, "apply.json");
    record.state = "recovering";
    await writeRecord(path, record);
    try {
      for (const file of record.review.files) {
        const [current] = await inspectRecovery(workspace, {
          ...record.review,
          files: [file],
        });
        if (current.state === "before") continue;
        if (current.state !== "after")
          throw Error(`복구 중 파일이 바뀌었습니다: ${file.path}`);
        await writeContent(workspace.source, file, "before");
      }
      record.state = "undone";
      record.error = "반영 전 파일로 복구했습니다.";
    } catch (error) {
      record.state = "recovery-required";
      record.error = String(error).slice(0, 24000);
      throw error;
    } finally {
      await writeRecord(path, record);
    }
  } finally {
    await release();
  }
}

// Keep native dependency executables out of deeply nested VS Code profiles on
// Windows. This is durable user storage, not an OS temporary directory. The
// profile hash and full job UUID keep independent profiles/jobs separate.
async function compactWorktreePath(storage: string, id: string) {
  const home = await realpath(homedir());
  const profile = hash(Buffer.from(storage)).slice(0, 16);
  return safePath(home, `.pureobom/worktrees/${profile}/${id}`);
}

/** Restore only canonical metadata and an independently derived worktree path. */
export async function loadJobWorkspace(
  storage: string,
  id: string,
  source: string,
): Promise<JobWorkspace> {
  z.string().uuid().parse(id);
  const root = await realpath(source),
    base = await realpath(storage),
    directory = resolve(base, id);
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  )
    throw Error("작업 기록 경로가 바뀌었습니다.");
  const workspace = await readRecord(
    resolve(directory, "workspace.json"),
    workspaceSchema,
    16 * 1024 * 1024,
  );
  const legacyPath = resolve(directory, "worktree");
  const validWorktreePath =
    workspace.path === legacyPath ||
    workspace.path === (await compactWorktreePath(base, id));
  if (
    workspace.id !== id ||
    workspace.directory !== directory ||
    !validWorktreePath ||
    workspace.source !== root ||
    inside(root, directory) ||
    inside(root, workspace.path) ||
    workspace.ref !== `refs/pureobom/jobs/${id}`
  )
    throw Error("이 프로젝트의 작업 기록이 아닙니다.");
  if (
    (await realpath(
      (await git(root, ["rev-parse", "--show-toplevel"])).trim(),
    )) !== root
  )
    throw Error("원본 Git 저장소의 위치가 바뀌었습니다.");
  if (
    (await git(root, ["rev-parse", "--verify", workspace.ref])).trim() !==
    workspace.snapshot
  )
    throw Error("작업 스냅샷 참조가 바뀌었습니다.");
  // Validate captured input hashes against immutable Git objects, not record assertions alone.
  const entries = (await git(root, ["ls-tree", "-r", "-z", workspace.snapshot]))
    .split("\0")
    .filter(Boolean);
  if (entries.length !== Object.keys(workspace.hashes).length)
    throw Error("스냅샷 파일 목록이 다릅니다.");
  const objects = entries.map((entry) => ({
    name: entry.slice(entry.indexOf("\t") + 1),
    blob: entry.slice(0, entry.indexOf("\t")).split(" ")[2],
  }));
  const contents = await new Promise<Buffer>((done, reject) => {
    const child = spawn("git", ["-C", root, "cat-file", "--batch"], {
      windowsHide: true,
      stdio: "pipe",
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("스냅샷 검증 시간이 초과됐습니다."));
    }, 30000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes + 1024 * 1024) {
        child.kill();
        reject(Error("스냅샷 크기가 제한을 초과합니다."));
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done(Buffer.concat(chunks));
      else reject(Error("스냅샷 데이터를 읽지 못했습니다."));
    });
    child.stdin.end(objects.map(({ blob }) => blob).join("\n") + "\n");
  });
  let offset = 0;
  for (const object of objects) {
    const end = contents.indexOf(10, offset);
    const [blob, kind, length] = contents
      .subarray(offset, end)
      .toString("ascii")
      .split(" ");
    const bytes = Number(length);
    if (
      end < offset ||
      blob !== object.blob ||
      kind !== "blob" ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > 2 * 1024 * 1024
    )
      throw Error("스냅샷 응답 형식이 올바르지 않습니다.");
    offset = end + 1;
    if (
      hash(contents.subarray(offset, offset + bytes)) !==
        workspace.hashes[object.name] ||
      contents[offset + bytes] !== 10
    )
      throw Error(`스냅샷 파일을 확인할 수 없습니다: ${object.name}`);
    offset += bytes + 1;
  }
  if (offset !== contents.length)
    throw Error("스냅샷 응답 길이가 올바르지 않습니다.");
  try {
    if ((await realpath(workspace.path)) !== workspace.path)
      throw Error("작업 복사본 경로가 바뀌었습니다.");
    const common = async (folder: string) =>
      realpath(
        resolve(
          folder,
          (await git(folder, ["rev-parse", "--git-common-dir"])).trim(),
        ),
      );
    if ((await common(root)) !== (await common(workspace.path)))
      throw Error("작업 복사본의 Git 저장소 연결이 바뀌었습니다.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return workspace;
}

export async function jobDirectories(storage: string) {
  try {
    return (await readdir(storage, { withFileTypes: true }))
      .filter(
        (item) =>
          item.isDirectory() && z.string().uuid().safeParse(item.name).success,
      )
      .map((item) => item.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function assertNoUnfinishedTransactions(
  source: string,
  storage: string,
  exceptId?: string,
) {
  for (const id of await jobDirectories(storage)) {
    if (id === exceptId) continue;
    let other: JobWorkspace;
    try {
      other = await readRecord(
        resolve(storage, id, "workspace.json"),
        workspaceSchema,
        16 * 1024 * 1024,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw Error(
        "읽을 수 없는 작업 기록이 있습니다. 이전 구현 작업에서 확인해 주세요.",
      );
    }
    if (other.source !== source) continue;
    // Use the enumerated directory, never a path asserted by the record.
    const record = await readApplyJournal({
      ...other,
      directory: resolve(storage, id),
    });
    if (
      record &&
      ["applying", "undoing", "recovering", "recovery-required"].includes(
        record.state,
      )
    )
      throw Error(`미완료 반영 기록을 먼저 복구해 주세요: ${id}`);
  }
}
