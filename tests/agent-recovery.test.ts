import { beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createJobWorkspace,
  reviewJobWorkspace,
  applyJobReview,
  undoJobReview,
  loadJobWorkspace,
  readApplyJournal,
  inspectRecovery,
  recoverJobReview,
} from "../extension/src/agent/gitWorkspace";
import { writeRecord, projectLease } from "../extension/src/agent/records";
import { ImplementationJobs } from "../extension/src/agent/jobs";
import type { ChangeRequest, LivingSpec } from "../src/workspace/spec";
const exec = promisify(execFile);
let bundle: string;
const parent = resolve("test-results/agent-recovery");
beforeAll(async () => {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, "runner-"));
  bundle = resolve(directory, "workspace.cjs");
  await build({
    entryPoints: ["extension/src/agent/gitWorkspace.ts"],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
});
async function git(root: string, ...args: string[]) {
  return (await exec("git", ["-C", root, ...args], { windowsHide: true }))
    .stdout;
}
async function fixture() {
  const directory = await mkdtemp(resolve(parent, "run-")),
    source = resolve(directory, "source"),
    storage = resolve(directory, "jobs");
  await mkdir(source);
  await git(source, "init");
  await git(source, "config", "user.name", "Fixture");
  await git(source, "config", "user.email", "fixture@example.invalid");
  await git(source, "config", "core.autocrlf", "false");
  await writeFile(
    resolve(source, "a.ts"),
    "// user draft\r\nexport const a = true;\r\n",
  );
  await writeFile(resolve(source, "b.ts"), "export const b = true;\n");
  await git(source, "add", ".");
  await git(source, "commit", "-m", "fixture");
  const workspace = await createJobWorkspace(source, storage);
  await writeFile(resolve(workspace.path, "a.ts"), "export const a = false;\n");
  await writeFile(resolve(workspace.path, "b.ts"), "export const b = false;\n");
  const review = await reviewJobWorkspace(workspace);
  return { source, storage, workspace, review };
}
async function persistedJob(
  f: Awaited<ReturnType<typeof fixture>>,
  phase: "review" | "running" = "review",
) {
  const content = {
    title: "Permission",
    purpose: "",
    desired: "Deny viewer edits",
    policies: "",
    inputsOutputs: "",
    failures: "",
    invariants: ["Keep reads"],
    acceptance: ["Viewer denied"],
  };
  const request: ChangeRequest = {
    id: "request",
    specId: "policy",
    specRevision: 1,
    graphRevision: "a".repeat(64),
    content,
    desired: content.desired,
    invariants: content.invariants,
    acceptance: content.acceptance,
    sources: [],
    scopePaths: ["a.ts", "b.ts"],
  };
  const spec: LivingSpec = {
    id: "policy",
    targetIds: ["policy"],
    revision: 1,
    content,
    baseline: {
      graphRevision: request.graphRevision,
      observed: "",
      sources: [],
    },
    updatedAt: new Date().toISOString(),
  };
  await writeRecord(resolve(f.workspace.directory, "job.json"), {
    schemaVersion: 1,
    source: f.workspace.source,
    request,
    specSnapshot: spec,
    review: f.review,
    state: {
      id: f.workspace.id,
      specId: request.specId,
      specRevision: 1,
      phase,
      startedAt: spec.updatedAt,
      worktree: f.workspace.path,
      message: "Persistence fixture; no inference performed",
      checks: [
        {
          name: "test",
          status: "passed",
          output: "Fixture only",
          elapsedMs: 1,
        },
      ],
      files: f.review.files.map((file) => ({
        path: file.path,
        kind: "modified",
      })),
      reviewId: f.review.id,
      approvals:
        phase === "running"
          ? [{ id: "obsolete-approval", kind: "command" }]
          : [],
    },
  });
  return spec;
}

describe("durable implementation recovery", { timeout: 60000 }, () => {
  it("recovers after the writing process exits mid-apply, including an outdated progress list", async () => {
    const f = await fixture();
    const script = `const api = require(process.argv[1]); const fs = require('node:fs');
      const w = JSON.parse(process.argv[2]); const r = JSON.parse(process.argv[3]);
      api.applyJobReview(w, r, async index => { if (index === 1) {
        const p = require('node:path').join(w.directory, 'apply.json');
        const journal = JSON.parse(fs.readFileSync(p)); journal.written = [];
        fs.writeFileSync(p, JSON.stringify(journal)); process.exit(79);
      }}).catch(error => { console.error(error); process.exit(1); });`;
    await expect(
      exec(
        process.execPath,
        [
          "-e",
          script,
          bundle,
          JSON.stringify(f.workspace),
          JSON.stringify(f.review),
        ],
        { windowsHide: true },
      ),
    ).rejects.toMatchObject({ code: 79 });
    const loaded = await loadJobWorkspace(f.storage, f.workspace.id, f.source);
    expect((await readApplyJournal(loaded))?.state).toBe("applying");
    await expect(createJobWorkspace(f.source, f.storage)).rejects.toThrow(
      /미완료 반영 기록/,
    );
    expect(await inspectRecovery(loaded, f.review)).toEqual([
      { path: "a.ts", state: "after" },
      { path: "b.ts", state: "before" },
    ]);
    await recoverJobReview(loaded, f.review.id);
    expect((await readApplyJournal(loaded))?.state).toBe("undone");
    expect(await git(f.source, "status", "--porcelain")).toBe("");
    expect(await readFile(resolve(f.source, "a.ts"), "utf8")).toContain("\r\n");
  });
  it("reconciles a partial undo but refuses to overwrite any subsequent user edit", async () => {
    const f = await fixture();
    await applyJobReview(f.workspace, f.review);
    await expect(
      undoJobReview(f.workspace, f.review, async (index) => {
        if (index === 1) throw Error("Disk disconnected");
      }),
    ).rejects.toThrow(/되돌리기/);
    const loaded = await loadJobWorkspace(f.storage, f.workspace.id, f.source);
    const restoredA = await readFile(resolve(f.source, "a.ts"), "utf8");
    await writeFile(resolve(f.source, "b.ts"), "// subsequent user edit\n");
    await expect(recoverJobReview(loaded, f.review.id)).rejects.toThrow(
      /이후 수정한 파일/,
    );
    expect(await readFile(resolve(f.source, "a.ts"), "utf8")).toBe(restoredA);
    expect(await readFile(resolve(f.source, "b.ts"), "utf8")).toBe(
      "// subsequent user edit\n",
    );
    await writeFile(resolve(f.source, "b.ts"), f.review.files[1].after!);
    await recoverJobReview(loaded, f.review.id);
    expect(await git(f.source, "status", "--porcelain")).toBe("");
  });
  it("restores review, applies, restarts again, and undoes without losing the saved design", async () => {
    const f = await fixture(),
      spec = await persistedJob(f);
    const first = new ImplementationJobs(f.storage, () => {});
    expect((await first.history(f.source)).entries).toHaveLength(1);
    await first.restore(f.source, f.workspace.id);
    expect(first.state?.phase).toBe("review");
    expect(first.savedSpec).toBe(JSON.stringify(spec));
    expect(first.file(0).before).toContain("user draft");
    await first.apply(f.review.id);
    first.dispose();
    const second = new ImplementationJobs(f.storage, () => {});
    await second.restore(f.source, f.workspace.id);
    expect(second.state?.phase).toBe("applied");
    await second.undo(f.review.id);
    expect(await git(f.source, "status", "--porcelain")).toBe("");
    second.dispose();
  });
  it("invalidates old approvals and checks when the agent connection is lost", async () => {
    const f = await fixture();
    await persistedJob(f, "running");
    const jobs = new ImplementationJobs(f.storage, () => {});
    await jobs.restore(f.source, f.workspace.id);
    expect(jobs.state?.phase).toBe("interrupted");
    expect(jobs.state?.approvals).toEqual([]);
    expect(jobs.state?.checks).toEqual([]);
    expect(() => jobs.decide("obsolete-approval", "accept")).toThrow();
    await expect(jobs.apply(f.review.id)).rejects.toThrow();
    expect(await git(f.source, "status", "--porcelain")).toBe("");
    jobs.dispose();
  });
  it("invalidates a completed review if its files change after restart", async () => {
    const f = await fixture();
    await persistedJob(f);
    await writeFile(resolve(f.workspace.path, "a.ts"), "// unverified edit\n");
    const jobs = new ImplementationJobs(f.storage, () => {});
    await jobs.restore(f.source, f.workspace.id);
    expect(jobs.state?.phase).toBe("interrupted");
    expect(jobs.state?.checks).toEqual([]);
    await expect(jobs.apply(f.review.id)).rejects.toThrow();
    expect(await git(f.source, "status", "--porcelain")).toBe("");
    jobs.dispose();
  });
  it("persists a real failed launch and restores it without launching another process", async () => {
    const f = await fixture();
    await persistedJob(f);
    const record = JSON.parse(
      await readFile(resolve(f.workspace.directory, "job.json"), "utf8"),
    );
    const jobs = new ImplementationJobs(f.storage, () => {});
    jobs.start(f.source, record.request, {
      executable: resolve(parent, "deliberately-missing-executable"),
      checks: ["test"],
      allowExternal: true,
      specSnapshot: record.specSnapshot,
    });
    await vi.waitFor(() => expect(jobs.isRunning).toBe(false), {
      timeout: 30000,
      interval: 50,
    });
    expect(jobs.state?.phase).toBe("failed");
    const id = jobs.state!.id;
    await jobs.flush();
    jobs.dispose();
    const restored = new ImplementationJobs(f.storage, () => {});
    await restored.restore(f.source, id);
    expect(restored.state?.phase).toBe("failed");
    expect(restored.state?.message).toMatch(/ENOENT|종료|spawn/);
    expect(await git(f.source, "status", "--porcelain")).toBe("");
    restored.dispose();
  });
  it("rejects corrupt records, forged source paths, and snapshot hashes before restoring", async () => {
    const f = await fixture();
    await persistedJob(f);
    const path = resolve(f.workspace.directory, "workspace.json");
    await writeRecord(path, { ...f.workspace, source: f.workspace.path });
    await expect(
      loadJobWorkspace(f.storage, f.workspace.id, f.source),
    ).rejects.toThrow(/이 프로젝트/);
    await writeRecord(path, {
      ...f.workspace,
      hashes: { ...f.workspace.hashes, "a.ts": "0".repeat(64) },
    });
    await expect(
      loadJobWorkspace(f.storage, f.workspace.id, f.source),
    ).rejects.toThrow(/스냅샷 파일/);
    await writeRecord(path, f.workspace);
    const record = {
      schemaVersion: 1,
      review: f.review,
      state: "applying",
      written: [],
      error: "",
    };
    await writeRecord(resolve(f.workspace.directory, "apply.json"), {
      ...record,
      review: {
        ...f.review,
        files: [{ ...f.review.files[0], path: "../outside.ts" }],
      },
    });
    await expect(readApplyJournal(f.workspace)).rejects.toThrow();
    expect(await git(f.source, "status", "--porcelain")).toBe("");
  });
  it("excludes a second writer and releases the OS lease when the owner exits", async () => {
    const f = await fixture();
    const release = await projectLease(f.workspace.source);
    await expect(applyJobReview(f.workspace, f.review)).rejects.toThrow(
      /다른 작업/,
    );
    await release();
    await applyJobReview(f.workspace, f.review);
    await undoJobReview(f.workspace, f.review);
    expect(await git(f.source, "status", "--porcelain")).toBe("");
  });
});
