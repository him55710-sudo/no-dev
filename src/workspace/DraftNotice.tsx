import { useState } from "react";
import type { DesignDraft } from "./drafts";
import type { LivingSpec, SpecContent } from "./spec";

const fields: [keyof SpecContent, string][] = [
  ["title", "설계 이름"],
  ["purpose", "역할과 목적"],
  ["desired", "원하는 동작"],
  ["policies", "정책과 조건"],
  ["inputsOutputs", "입출력과 데이터"],
  ["failures", "예외와 실패 처리"],
  ["invariants", "유지해야 하는 동작"],
  ["acceptance", "완료 기준"],
];
const text = (value: string | string[]) =>
  (Array.isArray(value) ? value.join("\n") : value) || "미작성";
export function DraftNotice({
  draft,
  current,
  graphRevision,
  conflict,
  busy,
  discard,
  retry,
  rebase,
}: {
  draft: DesignDraft & {
    status: "saving" | "saved" | "error" | "memory";
    error?: string;
  };
  current?: LivingSpec;
  graphRevision: string;
  conflict: boolean;
  busy: boolean;
  discard: () => void;
  retry: () => void;
  rebase: (current: LivingSpec, graphRevision: string) => Promise<void>;
}) {
  const [comparison, setComparison] = useState<{
    current: LivingSpec;
    graphRevision: string;
  }>();
  const [reviewed, setReviewed] = useState(false);
  return (
    <section className="draft-notice" aria-label="설계 초안">
      <strong role="status">
        {draft.status === "saved"
          ? "초안을 이 기기에 보관했습니다"
          : draft.status === "saving"
            ? "초안을 보관하고 있어요…"
            : draft.status === "error"
              ? "초안을 보관하지 못했습니다"
              : "이 화면에서 작성 중"}
      </strong>
      <p>
        확정된 설계와 별도로 보관합니다. 자동 보관은 구현을 실행하지 않습니다.
      </p>
      {draft.error ? <p role="alert">{draft.error}</p> : null}
      {conflict ? (
        <p role="alert">
          작성할 때의 기준과 최신 설계가 달라졌습니다. 입력 내용은 유지했습니다.
          비교한 뒤 이어 써 주세요.
        </p>
      ) : null}
      <div className="draft-buttons">
        {draft.status === "error" ? (
          <button disabled={busy} onClick={retry}>
            초안 보관 재시도
          </button>
        ) : null}
        {conflict && current ? (
          <button
            disabled={busy}
            onClick={() => {
              setComparison({ current, graphRevision });
              setReviewed(false);
            }}
          >
            최신 설계와 초안 비교
          </button>
        ) : null}
        <button disabled={busy} onClick={discard}>
          초안 버리기
        </button>
      </div>
      {conflict && !current ? (
        <p>
          원래 설계나 코드 연결을 찾지 못했습니다. 아래 입력은 복사하거나 계속
          편집할 수 있습니다.
        </p>
      ) : null}
      {comparison ? (
        <div className="draft-comparison">
          <h3>보관한 초안과 최신 설계</h3>
          <p>
            아래 최신 기준으로 이어 쓰면 입력한 목표는 유지하고 초안의 편집
            기준만 바꿉니다. 확정된 설계와 코드는 변경하지 않습니다.
          </p>
          <details>
            <summary>편집 기준 코드 비교</summary>
            <p>작성 당시: {draft.base.baseline.observed}</p>
            <p>최신 기준: {comparison.current.baseline.observed}</p>
          </details>
          {fields.map(([key, label]) => (
            <details key={key} open={key === "desired"}>
              <summary>{label}</summary>
              <dl>
                <dt>작성 시작 시</dt>
                <dd>{text(draft.base.content[key])}</dd>
                <dt>최신 설계</dt>
                <dd>{text(comparison.current.content[key])}</dd>
                <dt>내 초안</dt>
                <dd>{text(draft.content[key])}</dd>
              </dl>
            </details>
          ))}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            최신 설계를 확인했고 내 초안을 이어 씁니다.
          </label>
          <button
            disabled={busy || !reviewed}
            onClick={() => {
              void rebase(comparison.current, comparison.graphRevision)
                .then(() => setComparison(undefined))
                .catch(() => {});
            }}
          >
            이 기준으로 초안 이어 쓰기
          </button>
          <button disabled={busy} onClick={() => setComparison(undefined)}>
            비교 닫기
          </button>
        </div>
      ) : null}
    </section>
  );
}
