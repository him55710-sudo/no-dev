import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChangeRequest } from "../../../src/workspace/spec";
import {
  jobIsActive,
  type ImplementationJob,
  type VerificationName,
} from "../../../src/workspace/job";
import { CodexAppServer } from "./appServer";
import {
  createJobWorkspace,
  reviewJobWorkspace,
  applyJobReview,
  undoJobReview,
  type JobWorkspace,
  type ChangeReview,
} from "./gitWorkspace";
import { availableChecks, verifyWorkspace } from "./verify";

export class ImplementationJobs {
  state?: ImplementationJob;
  private workspace?: JobWorkspace;
  private review?: ChangeReview;
  private abort?: AbortController;
  private server?: CodexAppServer;
  private executing = false;
  constructor(
    private storage: string,
    private changed: (job: ImplementationJob) => void,
  ) {}
  private emit() {
    if (this.state) this.changed(structuredClone(this.state));
  }
  start(
    root: string,
    request: ChangeRequest,
    options: {
      executable: string;
      model?: string;
      checks: VerificationName[];
      allowExternal: boolean;
    },
  ) {
    if (!options.allowExternal)
      throw Error("Codex에 설계와 프로젝트 코드를 전달하는 선택이 필요합니다.");
    if (!options.checks.length)
      throw Error("구현 후 실행할 검사 명령을 선택해 주세요.");
    if (this.executing || jobIsActive(this.state))
      throw Error("이미 구현 작업이 실행 중입니다.");
    this.executing = true;
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
    options: { executable: string; model?: string; checks: VerificationName[] },
    signal: AbortSignal,
  ) {
    const state = this.state!;
    try {
      const verification = await availableChecks(root);
      const workspace = (this.workspace = await createJobWorkspace(
        root,
        this.storage,
      ));
      signal.throwIfAborted();
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
            this.emit();
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
            ),
          );
          this.emit();
        }
        if (state.checks.every((check) => check.status === "passed")) break;
      }
      signal.throwIfAborted();
      this.review = await reviewJobWorkspace(workspace);
      state.reviewId = this.review.id;
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
      await writeFile(
        resolve(workspace.directory, "job.json"),
        JSON.stringify({ request, state, review: this.review }, null, 2) + "\n",
      );
      this.emit();
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
      this.executing = false;
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
    this.state.phase = "applying";
    this.emit();
    try {
      await applyJobReview(this.workspace, this.review);
      this.state.phase = "applied";
      this.state.message = "원본 프로젝트에 반영했습니다.";
    } catch (error) {
      this.state.phase = "failed";
      this.state.message = String(error);
      throw error;
    } finally {
      this.emit();
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
      await undoJobReview(this.workspace, this.review);
      this.state.phase = "undone";
      this.state.message = "이번 작업의 변경을 되돌렸습니다.";
    } catch (error) {
      this.state.phase = "failed";
      this.state.message = String(error);
      throw error;
    } finally {
      this.emit();
    }
  }
  dispose() {
    this.abort?.abort();
    void this.server?.close().catch(() => {});
  }
}
