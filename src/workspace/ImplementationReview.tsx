import { useState } from "react";
import type { ImplementationJob } from "./job";
import { assertReviewReady, type ReviewDecision } from "./review";

export function ImplementationReview({
  job,
  save,
  apply,
  diff,
}: {
  job: ImplementationJob;
  save: (decision: ReviewDecision) => Promise<unknown>;
  apply: () => Promise<unknown>;
  diff: (index: number) => void;
}) {
  const assessment = job.assessment!;
  const [decision, setDecision] = useState<ReviewDecision>(
    () =>
      job.reviewDecision ?? {
        jobId: job.id,
        reviewId: assessment.reviewId,
        approvedScopePaths: [],
        reviewedVerificationPaths: [],
        acceptUnverified: false,
        criteria: assessment.criteria.map((item) => ({
          id: item.id,
          outcome: "unverified",
          note: "",
          checkNames: [],
        })),
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = job.phase === "review";
  const dirty = JSON.stringify(decision) !== JSON.stringify(job.reviewDecision);
  let blocked = "";
  try {
    assertReviewReady(assessment, job.checks, decision);
  } catch (error) {
    blocked = error instanceof Error ? error.message : String(error);
  }
  const updateCriterion = (
    id: string,
    changes: Partial<ReviewDecision["criteria"][number]>,
  ) =>
    setDecision((old) => ({
      ...old,
      criteria: old.criteria.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    }));
  const togglePath = (
    key: "approvedScopePaths" | "reviewedVerificationPaths",
    path: string,
    checked: boolean,
  ) =>
    setDecision((old) => ({
      ...old,
      [key]: checked
        ? [...old[key], path]
        : old[key].filter((value) => value !== path),
    }));
  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="implementation-review"
      aria-label="변경 범위와 완료 기준 검토"
    >
      <h3>변경 범위와 완료 기준</h3>
      <p>
        검사 명령의 성공과 기준별 확인은 별도로 기록합니다. 아래 확인 결과는
        사용자의 검토 기록이며 자동 판정이 아닙니다.
      </p>
      <details
        open={assessment.files.some(
          (file) => file.outsideScope || file.verification,
        )}
      >
        <summary>
          반영할 파일 {assessment.files.length}개 · 범위 밖{" "}
          {assessment.files.filter((file) => file.outsideScope).length}개
        </summary>
        <p>
          처음 수집한 코드 범위와 실제 변경을 비교합니다. 테스트·검사 설정
          표시는 경로에 따른 후보 분류이며, 테스트가 약해졌다는 판정은 아닙니다.
        </p>
        {assessment.files.map((file) => (
          <div className="review-file" key={file.path}>
            <button
              onClick={() =>
                diff(job.files.findIndex((item) => item.path === file.path))
              }
            >
              {file.path} · 변경 보기 ↗
            </button>
            <span>
              {file.outsideScope ? "처음 수집한 범위 밖" : "연결된 코드 범위"}
              {file.verification === "test"
                ? " · 테스트 변경 후보"
                : file.verification
                  ? " · 검사 설정 변경 후보"
                  : ""}
            </span>
            {file.outsideScope ? (
              <label>
                <input
                  type="checkbox"
                  disabled={!editable || busy}
                  checked={decision.approvedScopePaths.includes(file.path)}
                  onChange={(event) =>
                    togglePath(
                      "approvedScopePaths",
                      file.path,
                      event.target.checked,
                    )
                  }
                />
                {file.path} 범위 밖 변경의 반영을 허용합니다.
              </label>
            ) : null}
            {file.verification ? (
              <label>
                <input
                  type="checkbox"
                  disabled={!editable || busy}
                  checked={decision.reviewedVerificationPaths.includes(
                    file.path,
                  )}
                  onChange={(event) =>
                    togglePath(
                      "reviewedVerificationPaths",
                      file.path,
                      event.target.checked,
                    )
                  }
                />
                {file.path} 검사 내용·기대값·대상 변경을 확인했습니다.
              </label>
            ) : null}
          </div>
        ))}
      </details>
      <div className="review-criteria">
        {assessment.criteria.map((criterion) => {
          const item = decision.criteria.find(
            (item) => item.id === criterion.id,
          )!;
          return (
            <fieldset key={criterion.id} disabled={!editable || busy}>
              <legend>
                {criterion.kind === "acceptance" ? "완료 기준" : "유지 조건"} ·{" "}
                {criterion.text}
              </legend>
              <label>
                확인 결과
                <select
                  value={item.outcome}
                  onChange={(event) =>
                    updateCriterion(item.id, {
                      outcome: event.target.value as typeof item.outcome,
                    })
                  }
                >
                  <option value="unverified">아직 확인하지 않음</option>
                  <option value="confirmed">사용자가 직접 확인</option>
                  <option value="failed">실패 확인</option>
                </select>
              </label>
              <label>
                관찰한 결과와 근거
                <textarea
                  maxLength={2000}
                  value={item.note}
                  placeholder="예: test 로그의 viewer 수정 요청 사례에서 403과 데이터 보존을 확인"
                  onChange={(event) =>
                    updateCriterion(item.id, { note: event.target.value })
                  }
                />
              </label>
              {job.checks
                .filter((check) => check.status === "passed")
                .map((check) => (
                  <label className="review-check" key={check.name}>
                    <input
                      type="checkbox"
                      checked={item.checkNames.includes(check.name)}
                      onChange={(event) =>
                        updateCriterion(item.id, {
                          checkNames: event.target.checked
                            ? [...item.checkNames, check.name]
                            : item.checkNames.filter(
                                (name) => name !== check.name,
                              ),
                        })
                      }
                    />
                    {check.name} 실행 로그를 근거로 연결
                  </label>
                ))}
              {item.checkNames.map((name) => (
                <details key={name}>
                  <summary>{name} 실제 실행 결과</summary>
                  <pre>
                    {job.checks.find((check) => check.name === name)?.output}
                  </pre>
                </details>
              ))}
            </fieldset>
          );
        })}
      </div>
      {decision.criteria.some((item) => item.outcome === "unverified") ? (
        <label className="review-uncertainty">
          <input
            type="checkbox"
            disabled={!editable || busy}
            checked={decision.acceptUnverified}
            onChange={(event) =>
              setDecision((old) => ({
                ...old,
                acceptUnverified: event.target.checked,
              }))
            }
          />
          미확인 기준이 남아 있음을 알고 이번 변경을 반영합니다. 해당 기준은
          확인 완료로 바뀌지 않습니다.
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {editable ? (
        <div className="review-actions">
          <button
            disabled={busy || !dirty}
            onClick={() => void perform(() => save(decision))}
          >
            검토 기록 저장
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              dirty ||
              !!blocked ||
              !job.checks.length ||
              job.checks.some((check) => check.status !== "passed")
            }
            onClick={() => void perform(apply)}
          >
            검토한 변경 반영
          </button>
          <p role="status">
            {busy
              ? "검토 요청 처리 중…"
              : dirty
                ? "변경한 검토 기록을 저장해 주세요."
                : blocked || "이 변경에 대한 검토 기록을 저장했습니다."}
          </p>
        </div>
      ) : (
        <p>저장된 검토 기록입니다. 당시 미확인 기준은 그대로 표시합니다.</p>
      )}
    </section>
  );
}
