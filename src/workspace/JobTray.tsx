import { jobIsActive, type ImplementationJob } from "./job";
import { useState } from "react";
import { ImplementationReview } from "./ImplementationReview";
import { VerificationEvidence } from "./VerificationEvidence";
export const phaseNames: Record<ImplementationJob["phase"], string> = {
  preparing: "작업 공간 준비",
  running: "구현 중",
  approval: "실행 선택 필요",
  checking: "검사 중",
  repairing: "실패 원인 수정 중",
  review: "변경 검토",
  applying: "반영 중",
  applied: "원본 반영됨",
  undone: "변경 되돌림",
  cancelling: "취소 중",
  cancelled: "취소됨",
  failed: "작업 중단",
  interrupted: "이전 실행 연결 확인 필요",
  recovery: "파일 복구 필요",
};
export type JobAction =
  | "cancelJob"
  | "decideJob"
  | "jobDiff"
  | "applyJob"
  | "reviewJob"
  | "undoJob"
  | "recoverJob"
  | "restoreJob"
  | "resumeJob"
  | "jobHistory";
export function JobTray({
  job,
  action: dispatch,
  continuation,
}: {
  job: ImplementationJob;
  continuation?: React.ReactNode;
  action: (
    name: JobAction,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const action = (name: JobAction, payload?: Record<string, unknown>) => {
    setError("");
    void dispatch(name, payload).catch((error) => setError(String(error)));
  };
  return (
    <section
      className={`implementation-job${expanded ? " expanded" : ""}`}
      aria-label="구현 작업"
    >
      <header>
        <strong>{phaseNames[job.phase]}</strong>
        <span>설계 v{job.specRevision}</span>
        {job.assessment ? (
          <button
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "검토 화면 줄이기" : "검토 크게 보기"}
          </button>
        ) : null}
        {jobIsActive(job) && !["applying", "cancelling"].includes(job.phase) ? (
          <button onClick={() => action("cancelJob", { jobId: job.id })}>
            작업 취소
          </button>
        ) : null}
        {job.phase === "applied" ? (
          <button onClick={() => action("undoJob", { reviewId: job.reviewId })}>
            이번 변경 되돌리기
          </button>
        ) : null}
        {job.phase === "recovery" ? (
          <button
            disabled={job.recovery?.some((file) => file.state === "conflict")}
            onClick={() => action("recoverJob", { reviewId: job.reviewId })}
          >
            반영 전 파일로 복구
          </button>
        ) : null}
      </header>
      {job.continuedFrom ? (
        <p>
          중단된 변경을 이어서 진행하는 작업입니다.{" "}
          <button
            disabled={jobIsActive(job)}
            onClick={() =>
              action("restoreJob", { workspaceId: job.continuedFrom })
            }
          >
            이전 작업 보기
          </button>
        </p>
      ) : null}
      {continuation ? (
        <details>
          <summary>중단된 변경 이어하기</summary>
          <p>
            현재 남은 변경을 새 작업 복사본에 가져와 같은 설계로 이어갑니다.
            이전 작업은 보존하며 새 모델 세션에서 선택한 검사를 모두 다시
            실행합니다.
          </p>
          {continuation}
        </details>
      ) : null}
      {jobIsActive(job) ? (
        <p>
          창을 닫아도 작업은 계속됩니다. 같은 프로젝트를 다시 열면 연결됩니다.
          중지하려면 작업 취소를 선택하세요.
        </p>
      ) : null}
      {job.approvals.map((approval) => (
        <div className="job-approval" key={approval.id}>
          <strong>
            {approval.kind === "command" ? "명령 실행 요청" : "파일 변경 요청"}
          </strong>
          {approval.command ? <pre>{approval.command}</pre> : null}
          <p>{approval.reason}</p>
          <small>{approval.cwd}</small>
          <button
            onClick={() =>
              action("decideJob", {
                jobId: job.id,
                id: approval.id,
                decision: "accept",
              })
            }
          >
            이번 요청 허용
          </button>
          <button
            onClick={() =>
              action("decideJob", {
                jobId: job.id,
                id: approval.id,
                decision: "decline",
              })
            }
          >
            거절
          </button>
        </div>
      ))}
      <div className="job-columns">
        {job.recovery?.length ? (
          <details open>
            <summary>현재 파일 상태</summary>
            {job.recovery.map((file) => (
              <p key={file.path}>
                {file.path} ·{" "}
                {file.state === "before"
                  ? "변경 전"
                  : file.state === "after"
                    ? "변경 후"
                    : "다른 편집과 충돌 · 보존됨"}
              </p>
            ))}
          </details>
        ) : null}
        <details open={job.phase === "failed" || job.phase === "cancelled"}>
          <summary>진행 내용</summary>
          <pre>{job.message}</pre>
          {job.worktree ? <small>작업 복사본: {job.worktree}</small> : null}
        </details>
        {job.checks.length ? (
          <details open>
            <summary>
              실제 검사{" "}
              {job.checks.filter((check) => check.status === "passed").length}/
              {job.checks.length} 통과
            </summary>
            {job.checks.map((check, i) => (
              <VerificationEvidence key={`${check.name}:${i}`} check={check} />
            ))}
          </details>
        ) : null}
        {job.verificationAttempts?.length ? (
          <details>
            <summary>
              검사 실행 이력 · {job.verificationAttempts.length}회
            </summary>
            <p>
              자동 수정 전후의 기록입니다. 이전 검사는 현재 변경의 반영 근거로
              사용하지 않습니다.
            </p>
            {job.verificationAttempts.map((attempt) => (
              <section
                key={attempt.attempt}
                aria-label={`${attempt.attempt}차 검사`}
              >
                <h4>
                  {attempt.attempt}차 검사 ·{" "}
                  {
                    attempt.checks.filter((check) => check.status === "passed")
                      .length
                  }
                  /{attempt.checks.length} 통과 ·{" "}
                  {attempt.completed
                    ? "선택한 명령 실행 완료"
                    : "일부 실행 또는 중단"}
                </h4>
                {attempt.checks.map((check, index) => (
                  <VerificationEvidence
                    key={`${check.name}:${index}`}
                    check={check}
                  />
                ))}
              </section>
            ))}
          </details>
        ) : null}
        {job.previousChecks?.length ? (
          <details>
            <summary>
              이전 검사 기록 · 현재 변경의 통과 근거로 사용하지 않음
            </summary>
            {job.previousChecks.map((check, index) => (
              <VerificationEvidence
                key={`${check.name}:${index}`}
                check={check}
              />
            ))}
          </details>
        ) : null}
        {job.files.length ? (
          <details open>
            <summary>변경 파일 {job.files.length}개</summary>
            {job.files.map((file, index) => (
              <button
                key={file.path}
                onClick={() =>
                  action("jobDiff", { reviewId: job.reviewId, index })
                }
              >
                {file.kind} · {file.path} ↗
              </button>
            ))}
          </details>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {job.assessment ? (
        <ImplementationReview
          key={`${job.id}:${job.assessment.reviewId}:${JSON.stringify(job.reviewDecision)}`}
          job={job}
          save={(decision) => dispatch("reviewJob", decision)}
          apply={() => dispatch("applyJob", { reviewId: job.reviewId })}
          diff={(index) => action("jobDiff", { reviewId: job.reviewId, index })}
        />
      ) : null}
    </section>
  );
}
