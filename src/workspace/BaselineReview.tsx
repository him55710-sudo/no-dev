import { useMemo, useState } from "react";
import type { StructureGraph } from "./model";
import { draftSpec, type BaselineRequest, type LivingSpec } from "./spec";

/** A pinned preview: incoming code/spec changes invalidate confirmation. */
export function BaselineReview({
  spec,
  graph,
  disabled,
  accept,
  close,
  source,
}: {
  spec: LivingSpec;
  graph: StructureGraph;
  disabled: boolean;
  accept: (request: BaselineRequest) => Promise<unknown>;
  close: () => void;
  source: (id: string, index: number) => void;
}) {
  const [snapshot] = useState(() => ({ spec, graph }));
  const [targets, setTargets] = useState(() =>
    spec.targetIds.filter((id) => graph.nodes.some((node) => node.id === id)),
  );
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stale =
    snapshot.spec.revision !== spec.revision ||
    snapshot.graph.revision !== graph.revision;
  const preview = useMemo(() => {
    try {
      return { value: draftSpec(snapshot.graph, targets) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [snapshot, targets]);
  const results = snapshot.graph.nodes
    .filter((node) =>
      `${node.label} ${node.sources[0]?.path ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .slice(0, 60);
  const toggle = (id: string) => {
    setTargets((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id],
    );
    setConfirmed(false);
  };
  const before = snapshot.spec.baseline;
  return (
    <section className="baseline-review" aria-label="기준 코드 비교와 재연결">
      <h3>기준 코드 비교</h3>
      <p>
        검토한 현재 코드를 다음 변경의 출발점으로 저장합니다. 원하는 동작과 완료
        기준은 그대로 유지됩니다.
      </p>
      <strong>연결할 대상 {targets.length}개</strong>
      <div className="baseline-targets">
        {targets.map((id) => (
          <button key={id} disabled={busy} onClick={() => toggle(id)}>
            {snapshot.graph.nodes.find((node) => node.id === id)?.label} · 제외
          </button>
        ))}
      </div>
      {snapshot.spec.targetIds.some(
        (id) => !snapshot.graph.nodes.some((node) => node.id === id),
      ) ? (
        <p role="status">
          이전 대상 중 현재 코드에서 찾을 수 없는 항목이 있습니다. 새 대상을
          직접 선택해 주세요.
        </p>
      ) : null}
      <label className="spec-field">
        연결할 코드 검색
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="기능, 파일 또는 선언 이름"
          disabled={busy}
        />
      </label>
      <div
        className="baseline-search"
        role="group"
        aria-label="연결할 대상 선택"
      >
        {results.map((node) => (
          <label key={node.id}>
            <input
              type="checkbox"
              checked={targets.includes(node.id)}
              disabled={
                busy || (!targets.includes(node.id) && targets.length >= 100)
              }
              onChange={() => toggle(node.id)}
            />
            <span>
              {node.label}
              <small>{node.sources[0]?.path ?? node.summary}</small>
            </span>
          </label>
        ))}
        <small>
          최대 60개 결과를 표시합니다. 검색어로 범위를 좁힐 수 있어요.
        </small>
      </div>
      <details>
        <summary>이전 기준 · 설계 v{snapshot.spec.revision}</summary>
        <p>{before.observed}</p>
        {before.sources.map((ref, i) => (
          <p key={i}>
            {ref.path}:{ref.line} · {ref.symbol}
            <small>코드 해시 {ref.contentHash.slice(0, 12)}</small>
          </p>
        ))}
      </details>
      {preview.value ? (
        <div className="baseline-proposal">
          <strong>새 기준의 관측 내용</strong>
          <p>{preview.value.baseline.observed}</p>
          <details open>
            <summary>
              새 구현 근거 {preview.value.baseline.sources.length}개
            </summary>
            {preview.value.baseline.sources.map((ref, i) => {
              const old = before.sources.find(
                (entry) =>
                  entry.path === ref.path && entry.symbol === ref.symbol,
              );
              const node = snapshot.graph.nodes.find((item) =>
                item.sources.some(
                  (entry) =>
                    entry.path === ref.path &&
                    entry.start === ref.start &&
                    entry.end === ref.end,
                ),
              );
              const index =
                node?.sources.findIndex(
                  (entry) =>
                    entry.path === ref.path &&
                    entry.start === ref.start &&
                    entry.end === ref.end,
                ) ?? -1;
              return (
                <p key={i}>
                  <span>
                    {!old
                      ? "새 연결"
                      : old.contentHash !== ref.contentHash
                        ? "코드 변경"
                        : "기존 코드"}{" "}
                    · {ref.path}:{ref.line} · {ref.symbol}
                  </span>
                  <small>코드 해시 {ref.contentHash.slice(0, 12)}</small>
                  {node && index >= 0 ? (
                    <button
                      disabled={stale || busy}
                      onClick={() => source(node.id, index)}
                    >
                      현재 코드 열기 ↗
                    </button>
                  ) : null}
                </p>
              );
            })}
          </details>
          <p>
            이전 기준은 기록에 남습니다. 기준 확정은 목표 충족 판정이 아니며
            구현을 실행하지 않습니다.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || stale}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            연결할 대상과 현재 코드를 검토했습니다.
          </label>
        </div>
      ) : (
        <p role="status">{preview.error}</p>
      )}
      {stale ? (
        <p role="alert">
          비교 중 코드나 설계가 바뀌었습니다. 닫고 다시 비교해 주세요.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="baseline-actions">
        <button
          className="primary"
          disabled={
            disabled ||
            busy ||
            stale ||
            !confirmed ||
            !preview.value?.baseline.sources.length
          }
          onClick={() => {
            setBusy(true);
            setError("");
            void accept({
              specId: snapshot.spec.id,
              expectedRevision: snapshot.spec.revision,
              expectedGraphRevision: snapshot.graph.revision,
              targetIds: targets,
            })
              .then(close)
              .catch((e) =>
                setError(e instanceof Error ? e.message : String(e)),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "확정 중…" : "검토한 코드를 새 기준으로 확정"}
        </button>
        <button disabled={busy} onClick={close}>
          닫기
        </button>
      </div>
    </section>
  );
}
