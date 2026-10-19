import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  changeRequestSchema,
  livingSpecSchema,
  type ChangeRequest,
  type LivingSpec,
} from "../../../src/workspace/spec";
import {
  jobIsActive,
  jobSchema,
  type JobHistoryEntry,
  type ImplementationJob,
  type VerificationName,
} from "../../../src/workspace/job";
import { CodexAppServer } from "./appServer";
import {
  createJobWorkspace,
  reviewJobWorkspace,
  applyJobReview,
  undoJobReview,
  recoverJobReview,
  readApplyJournal,
  inspectRecovery,
  loadJobWorkspace,
  jobDirectories,
  reviewSchema,
  type JobWorkspace,
  type ChangeReview,
} from "./gitWorkspace";
import { availableChecks, verifyWorkspace } from "./verify";
import type { ExecutionContext } from "../../../src/workspace/execution";
import { readRecord, writeRecord } from "./records";
import {
  assessReview,
  assertReviewReady,
  validateReviewDecision,
} from "../../../src/workspace/review";

export const jobRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().max(4096),
    request: changeRequestSchema,
    state: jobSchema,
    specSnapshot: livingSpecSchema.optional(),
    review: reviewSchema.optional(),
  })
  .strict();

export class ImplementationJobs {
  state?: ImplementationJob;
  private workspace?: JobWorkspace;
  private review?: ChangeReview;
  private abort?: AbortController;
  private server?: CodexAppServer;
  private executing = false;
  private source?: string;
  private request?: ChangeRequest;
  private specSnapshot?: LivingSpec;
  private recordDirectory?: string;
  private pending: Promise<void> = Promise.resolve();
  private storageError?: Error;
  private disposed = false;
  get isRunning() {
    return this.executing || jobIsActive(this.state);
  }
  get savedSpec() {
    return this.specSnapshot ? JSON.stringify(this.specSnapshot) : undefined;
  }
  constructor(
    private storage: string,
    private changed: (job: ImplementationJob) => void,
  ) {}
  private emit(persist = true, publish = true) {
    if (this.state) this.state.message = this.state.message.slice(0, 32000);
    if (publish && this.state && !this.disposed)
      this.changed(structuredClone(this.state));
    if (
      !persist ||
      !this.state ||
      !this.recordDirectory ||
      !this.source ||
      !this.request
    )
      return;
    const path = resolve(this.recordDirectory, "job.json");
    const record = structuredClone({
      schemaVersion: 1,
      source: this.source,
      request: this.request,
      state: this.state,
      specSnapshot: this.specSnapshot,
      review: this.review,
    });
    this.pending = this.pending
      .then(async () => {
        await writeRecord(path, jobRecordSchema.parse(record));
      })
      .catch((error) => {
        this.storageError =
          error instanceof Error ? error : Error(String(error));
        this.abort?.abort();
        if (this.state) {
          this.state.message = `작업 기록을 저장하지 못했습니다. ${this.storageError.message}`;
          if (!this.disposed) this.changed(structuredClone(this.state));
        }
      });
  }
  async flush() {
    await this.pending;
    if (this.storageError) throw this.storageError;
  }
  start(
    root: string,
    request: ChangeRequest,
    options: {
      executable: string;
      model?: string;
      checks: VerificationName[];
      allowExternal: boolean;
      specSnapshot?: LivingSpec;
      verification?: Pick<ExecutionContext, "manager" | "scripts">;
    },
  ) {
    if (!options.allowExternal)
      throw Error("Codex에 설계와 프로젝트 코드를 전달하는 선택이 필요합니다.");
    if (!options.checks.length)
      throw Error("구현 후 실행할 검사 명령을 선택해 주세요.");
    if (this.executing || jobIsActive(this.state))
      throw Error("이미 구현 작업이 실행 중입니다.");
    if (this.state?.phase === "recovery")
      throw Error("미완료 파일 변경을 먼저 복구해 주세요.");
    this.request = changeRequestSchema.parse(request);
    this.specSnapshot = options.specSnapshot
      ? livingSpecSchema.parse(options.specSnapshot)
      : undefined;
    this.executing = true;
    this.source = undefined;
    this.recordDirectory = undefined;
    this.storageError = undefined;
    this.workspace = undefined;
    this.review = undefined;
    this.abort = new AbortController();
    this.state = {
      id: randomUUID(),
      specId: request.specId,
      specRevision: request.specRevision,
      phase: "preparing",
      startedAt: new Date().toISOString(),
      message: "현재 파일을 별도 Git 작업 공간에 복사합니다.",
      checks: [],
      files: [],
      approvals: [],
    };
    this.emit();
    void this.execute(root, request, options, this.abort.signal);
    return this.state;
  }
  private async execute(
    root: string,
    request: ChangeRequest,
    options: {
      executable: string;
      model?: string;
      checks: VerificationName[];
      verification?: Pick<ExecutionContext, "manager" | "scripts">;
    },
    signal: AbortSignal,
  ) {
    const state = this.state!;
    try {
      this.source = await realpath(root);
      await mkdir(this.storage, { recursive: true });
      this.storage = await realpath(this.storage);
      this.recordDirectory = resolve(this.storage, state.id);
      await mkdir(this.recordDirectory);
      this.emit();
      await this.flush();
      const verification =
        options.verification ?? (await availableChecks(root, true));
      const workspace = (this.workspace = await createJobWorkspace(
        root,
        this.storage,
        state.id,
        process.platform === "win32",
      ));
      signal.throwIfAborted();
      const copiedChecks = await availableChecks(workspace.path, true);
      if (
        copiedChecks.manager !== verification.manager ||
        options.checks.some(
          (name) =>
            verification.scripts[name] === undefined ||
            copiedChecks.scripts[name] !== verification.scripts[name],
        )
      )
        throw Error(
          "선택한 검사 설정이 준비 도중 바뀌었습니다. 구현 설정을 다시 확인해 주세요.",
        );
      for (const ref of request.sources)
        if (workspace.hashes[ref.path] !== ref.fileHash)
          throw Error(`분석 후 원본이 바뀌었습니다: ${ref.path}`);
      state.worktree = workspace.path;
      const prompt = [
        "Implement this confirmed design across the real UI, API, shared policies and relevant tests in the provided worktree.",
        "Keep unrelated behavior unchanged. Inspect the existing code before changing it. Use the acceptance criteria as regression cases. Do not simply alter test expectations to make failures disappear.",
        "The following JSON is the user's design and source-backed context. The scope is a starting point; follow real dependencies and include necessary tests. Report any unresolved acceptance criteria honestly.",
        JSON.stringify(request, null, 2),
        `Verification scripts selected by the user: ${options.checks.join(", ")}. Run and repair these checks. Do not deploy, push or merge.`,
      ].join("\n\n");
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted();
        state.phase = attempt ? "repairing" : "running";
        state.approvals = [];
        this.emit();
        await this.flush();
        const server = (this.server = new CodexAppServer({
          executable: options.executable,
          cwd: workspace.path,
        }));
        server.onEvent(({ method, params }) => {
          if (signal.aborted) return;
          if (
            method === "item/agentMessage/delta" &&
            typeof params.delta === "string"
          ) {
            state.message = (state.message + params.delta).slice(-8000);
            this.emit(false);
          }
        });
        server.onApproval((approval) => {
          if (signal.aborted) {
            server.decide(approval.id, "cancel");
            return;
          }
          const details = approval.details;
          state.phase = "approval";
          state.approvals.push({
            id: approval.id,
            kind: approval.kind,
            command:
              typeof details.command === "string" ? details.command : undefined,
            reason:
              typeof details.reason === "string" ? details.reason : undefined,
            cwd:
              typeof details.cwd === "string"
                ? details.cwd
                : typeof details.grantRoot === "string"
                  ? details.grantRoot
                  : undefined,
          });
          this.emit();
        });
        state.provider = (await server.start()).userAgent;
        const account = await server.account();
        if (!account.signedIn && account.requiresOpenaiAuth)
          throw Error("Codex CLI에서 먼저 로그인해 주세요.");
        const instruction = attempt
          ? `${prompt}\n\nThe independent verification below failed. Repair the implementation and necessary dependencies, preserve acceptance criteria, and rerun checks.\n${JSON.stringify(state.checks)}`
          : prompt;
        state.message = attempt
          ? "실제 검사 실패를 전달해 수정을 요청합니다.\n"
          : "Codex가 설계를 구현하고 있습니다.\n";
        this.emit();
        await server.run({ prompt: instruction, model: options.model, signal });
        this.server = undefined;
        signal.throwIfAborted();
        state.phase = "checking";
        state.approvals = [];
        state.checks = [];
        this.emit();
        for (const name of options.checks) {
          state.checks.push(
            await verifyWorkspace(
              workspace.path,
              name,
              signal,
              180000,
              verification.scripts[name],
              verification.manager,
            ),
          );
          this.emit();
        }
        if (state.checks.every((check) => check.status === "passed")) break;
      }
      signal.throwIfAborted();
      this.review = await reviewJobWorkspace(workspace);
      state.reviewId = this.review.id;
      state.assessment = assessReview(request, this.review);
      state.reviewDecision = undefined;
      state.files = this.review.files.map((file) => ({
        path: file.path,
        kind:
          file.before === null
            ? "added"
            : file.after === null
              ? "deleted"
              : "modified",
      }));
      if (!state.files.length)
        throw Error(
          "에이전트가 파일 변경을 만들지 않았습니다. 목표 충족을 확인하지 못했습니다.",
        );
      state.phase = "review";
      state.message += state.checks.every((check) => check.status === "passed")
        ? "\n선택한 명령이 통과했습니다. 변경 내용과 완료 기준을 검토해 주세요."
        : "\n검사가 통과하지 못했습니다. 변경을 검토할 수 있지만 원본에 반영할 수 없습니다.";
      this.emit();
      await this.flush();
    } catch (error) {
      state.phase = signal.aborted ? "cancelled" : "failed";
      state.message = error instanceof Error ? error.message : String(error);
      state.approvals = [];
      this.emit();
    } finally {
      await this.server?.close().catch((error) => {
        state.phase = "failed";
        state.message = String(error);
        this.emit();
      });
      this.server = undefined;
      await this.pending;
      this.executing = false;
      this.emit(false);
    }
  }
  decide(id: string, decision: "accept" | "decline" | "cancel") {
    if (!this.server || !this.state?.approvals.some((item) => item.id === id))
      throw Error("현재 승인 요청이 아닙니다.");
    this.server.decide(id, decision);
    this.state.approvals = this.state.approvals.filter(
      (item) => item.id !== id,
    );
    if (!this.state.approvals.length) this.state.phase = "running";
    this.emit();
  }
  cancel() {
    if (!jobIsActive(this.state) || this.state?.phase === "applying") return;
    this.state!.phase = "cancelling";
    this.emit();
    this.abort?.abort();
  }
  file(index: number) {
    const file = this.review?.files[index];
    if (!file) throw Error("검토할 변경 파일이 없습니다.");
    return file;
  }
  async reviewDecision(raw: unknown) {
    if (
      !this.workspace ||
      !this.review ||
      !this.request ||
      this.state?.phase !== "review"
    )
      throw Error("현재 검토할 작업이 아닙니다.");
    const { workspace, review, request, state } = this;
    if ((await reviewJobWorkspace(workspace)).id !== review.id)
      throw Error(
        "검사 이후 작업 복사본이 바뀌었습니다. 이전 검사와 검토로 반영할 수 없습니다.",
      );
    if (
      this.workspace !== workspace ||
      this.state !== state ||
      state.phase !== "review"
    )
      throw Error("검토 중 선택한 작업이 바뀌었습니다.");
    const assessment = assessReview(request, review);
    state.assessment = assessment;
    const previous = state.reviewDecision;
    state.reviewDecision = validateReviewDecision(
      assessment,
      state.checks,
      raw,
    );
    this.emit(true, false);
    try {
      await this.flush();
    } catch (error) {
      state.reviewDecision = previous;
      this.emit(false);
      throw error;
    }
    this.emit(false);
  }
  async apply(reviewId: string) {
    if (
      !this.workspace ||
      !this.review ||
      this.review.id !== reviewId ||
      this.state?.phase !== "review"
    )
      throw Error("현재 검토한 변경이 아닙니다.");
    if (
      !this.state.checks.length ||
      this.state.checks.some((check) => check.status !== "passed")
    )
      throw Error("검사가 통과한 뒤 반영할 수 있습니다.");
    if (!this.request) throw Error("검토할 설계 요청이 없습니다.");
    assertReviewReady(
      assessReview(this.request, this.review),
      this.state.checks,
      this.state.reviewDecision,
    );
    this.state.phase = "applying";
    this.emit();
    try {
      await this.flush();
      await applyJobReview(this.workspace, this.review);
      await this.reconcileJournal();
      this.state.message = "원본 프로젝트에 반영했습니다.";
    } catch (error) {
      await this.reconcileJournal();
      this.state.message = String(error);
      throw error;
    } finally {
      this.emit();
      await this.flush();
    }
  }
  async undo(reviewId: string) {
    if (
      !this.workspace ||
      !this.review ||
      this.review.id !== reviewId ||
      this.state?.phase !== "applied"
    )
      throw Error("실행 취소할 작업이 아닙니다.");
    this.state.phase = "applying";
    this.emit();
    try {
      await this.flush();
      await undoJobReview(this.workspace, this.review);
      await this.reconcileJournal();
      this.state.message = "이번 작업의 변경을 되돌렸습니다.";
    } catch (error) {
      await this.reconcileJournal();
      this.state.message = String(error);
      throw error;
    } finally {
      this.emit();
      await this.flush();
    }
  }
  private async reconcileJournal() {
    if (!this.workspace || !this.state) return;
    const journal = await readApplyJournal(this.workspace);
    if (!journal) {
      this.state.phase = "failed";
      return;
    }
    this.review = journal.review;
    this.state.reviewId = journal.review.id;
    if (this.request)
      this.state.assessment = assessReview(this.request, journal.review);
    this.state.files = journal.review.files.map((file) => ({
      path: file.path,
      kind:
        file.before === null
          ? "added"
          : file.after === null
            ? "deleted"
            : "modified",
    }));
    const files = await inspectRecovery(this.workspace, journal.review);
    if (journal.state === "applied") {
      this.state.phase = "applied";
      this.state.recovery = files;
    } else if (journal.state === "undone" || journal.state === "rolled-back") {
      this.state.phase = "undone";
      this.state.recovery = files;
    } else {
      this.state.phase = "recovery";
      this.state.recovery = files;
    }
  }
  async history(
    root: string,
  ): Promise<{ entries: JobHistoryEntry[]; errors: string[] }> {
    const source = await realpath(root),
      entries: JobHistoryEntry[] = [],
      errors: string[] = [];
    for (const id of await jobDirectories(this.storage)) {
      try {
        const record = await readRecord(
          resolve(this.storage, id, "job.json"),
          jobRecordSchema,
        );
        if (record.source !== source) continue;
        if (record.state.id !== id) throw Error("작업 ID가 폴더와 다릅니다.");
        entries.push({
          id: record.state.id,
          workspaceId: id,
          startedAt: record.state.startedAt,
          specId: record.state.specId,
          phase: record.state.phase,
        });
      } catch (error) {
        errors.push(`${id}: ${String(error).slice(0, 250)}`);
      }
    }
    entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { entries, errors };
  }
  async restore(root: string, id: string) {
    if (this.isRunning)
      throw Error("진행 중인 작업이 끝난 뒤 기록을 열어 주세요.");
    await this.flush();
    z.string().uuid().parse(id);
    const source = await realpath(root);
    const directory = resolve(await realpath(this.storage), id);
    if ((await realpath(directory)) !== directory)
      throw Error("작업 기록 경로가 바뀌었습니다.");
    const record = await readRecord(
      resolve(directory, "job.json"),
      jobRecordSchema,
    );
    if (
      record.source !== source ||
      record.state.id !== id ||
      record.state.specId !== record.request.specId ||
      record.state.specRevision !== record.request.specRevision ||
      (record.review && record.review.workspaceId !== id)
    )
      throw Error("작업 기록이 서로 일치하지 않습니다.");
    if (
      record.specSnapshot &&
      (record.specSnapshot.id !== record.request.specId ||
        record.specSnapshot.revision !== record.request.specRevision ||
        JSON.stringify(record.specSnapshot.content) !==
          JSON.stringify(record.request.content))
    )
      throw Error("저장한 설계와 구현 요청이 다릅니다.");
    let workspace: JobWorkspace;
    try {
      workspace = await loadJobWorkspace(this.storage, id, source);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        record.state.worktree ||
        record.review
      )
        throw error;
      this.source = source;
      this.recordDirectory = directory;
      this.request = record.request;
      this.specSnapshot = record.specSnapshot;
      this.workspace = undefined;
      this.review = undefined;
      this.state = record.state;
      this.state.approvals = [];
      if (jobIsActive(this.state)) {
        this.state.phase = "interrupted";
        this.state.message =
          "작업 공간 준비가 끝나기 전에 연결이 끊겼습니다. 원본에 반영한 기록은 없습니다.";
      }
      this.emit(false);
      return this.state;
    }
    // Validate the transaction before replacing the selected in-memory job.
    const journal = await readApplyJournal(workspace);
    let reviewMatches = true;
    if (!journal && record.state.phase === "review")
      reviewMatches =
        !!record.review &&
        record.review.id === record.state.reviewId &&
        (await reviewJobWorkspace(workspace)).id === record.review.id;
    this.source = source;
    this.workspace = workspace;
    this.request = record.request;
    this.specSnapshot = record.specSnapshot;
    this.recordDirectory = workspace.directory;
    this.state = record.state;
    this.state.worktree = workspace.path;
    this.review = record.review;
    if (this.review) {
      this.state.assessment = assessReview(record.request, this.review);
      if (this.state.reviewDecision) {
        try {
          validateReviewDecision(
            this.state.assessment,
            this.state.checks,
            this.state.reviewDecision,
          );
        } catch {
          this.state.reviewDecision = undefined;
        }
      }
    } else {
      this.state.assessment = undefined;
      this.state.reviewDecision = undefined;
    }
    if (this.review)
      this.state.files = this.review.files.map((file) => ({
        path: file.path,
        kind:
          file.before === null
            ? "added"
            : file.after === null
              ? "deleted"
              : "modified",
      }));
    this.state.approvals = [];
    if (jobIsActive(this.state) && this.state.phase !== "applying") {
      this.state.phase = "interrupted";
      this.state.checks = [];
      this.state.reviewDecision = undefined;
      this.state.message =
        "이전 실행 연결을 확인할 수 없습니다. 승인과 구현을 자동으로 재개하지 않습니다. 작업 복사본과 변경을 확인해 주세요.";
      // Old request IDs cannot authorize a new process. Interrupted code is never applyable.
    }
    if (journal) {
      await this.reconcileJournal();
      this.state.message =
        this.state.phase === "recovery"
          ? "중간에 끊긴 파일 변경이 있습니다. 실제 파일 상태를 확인한 뒤 반영 전 상태로 복구할 수 있습니다."
          : "저장된 반영 기록과 현재 파일 상태를 다시 확인했습니다.";
    } else if (this.state.phase === "applying") {
      this.state.phase = "interrupted";
      this.state.message =
        "반영이 시작됐는지 확인할 기록이 없습니다. 원본을 자동으로 변경하지 않습니다.";
    } else if (this.state.phase === "review") {
      if (!reviewMatches) {
        this.state.phase = "interrupted";
        this.state.checks = [];
        this.state.reviewDecision = undefined;
        this.state.message =
          "검토 이후 작업 복사본이 바뀌었습니다. 기존 검사 결과로 반영할 수 없습니다.";
      }
    }
    this.emit(false);
    return this.state;
  }
  async recover(reviewId: string) {
    if (
      !this.workspace ||
      this.state?.phase !== "recovery" ||
      this.state.reviewId !== reviewId
    )
      throw Error("현재 복구할 작업이 아닙니다.");
    this.state.phase = "applying";
    this.emit();
    try {
      await this.flush();
      await recoverJobReview(this.workspace, reviewId);
      this.state.message =
        "반영 전 파일로 복구했습니다. 기존 사용자 변경은 보존했습니다.";
    } finally {
      await this.reconcileJournal();
      this.emit();
      await this.flush();
    }
  }
  dispose() {
    this.disposed = true;
    this.abort?.abort();
    void this.server?.close().catch(() => {});
  }
}
