import { useMemo, useState } from "react";
import {
  canBeFeatureMember,
  resolveFeatureMembers,
  type Feature,
  type FeatureRequest,
  type RemoveFeatureRequest,
} from "./features";
import type { StructureGraph } from "./model";

export function FeatureEditor({
  graph,
  feature,
  initialIds,
  disabled,
  save,
  remove,
  close,
}: {
  graph: StructureGraph;
  feature?: Feature;
  initialIds: string[];
  disabled: boolean;
  save: (request: FeatureRequest) => Promise<unknown>;
  remove?: (request: RemoveFeatureRequest) => Promise<unknown>;
  close: () => void;
}) {
  const [snapshot] = useState(() => ({ graph, feature }));
  const [title, setTitle] = useState(feature?.title ?? "");
  const [description, setDescription] = useState(feature?.description ?? "");
  const [ids, setIds] = useState(() =>
    feature
      ? feature.members.map(
          (member) =>
            resolveFeatureMembers({ ...feature, members: [member] }, graph)
              .nodes[0]?.id ?? member.nodeId,
        )
      : initialIds.filter((id) =>
          graph.nodes.some(
            (node) => node.id === id && canBeFeatureMember(node),
          ),
        ),
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const stale =
    graph.revision !== snapshot.graph.revision ||
    feature?.revision !== snapshot.feature?.revision;
  const results = useMemo(
    () =>
      snapshot.graph.nodes
        .filter(
          (node) =>
            canBeFeatureMember(node) &&
            `${node.label} ${node.sources[0]?.path ?? ""}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        )
        .slice(0, 60),
    [snapshot, query],
  );
  const toggle = (id: string) =>
    setIds((old) =>
      old.includes(id) ? old.filter((item) => item !== id) : [...old, id],
    );
  const perform = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    void work()
      .then(close)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="feature-editor" aria-label="업무 기능 묶음 편집">
      <h2>{feature ? "업무 기능 편집" : "업무 기능 만들기"}</h2>
      <p>
        여러 폴더의 화면·API·규칙을 한 기능으로 묶습니다. 같은 코드를 여러
        기능에 포함할 수 있습니다. 코드 파일을 이동하거나 구현을 실행하지
        않습니다.
      </p>
      <label className="spec-field">
        기능 이름
        <input
          maxLength={160}
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="spec-field">
        기능 설명 · 사용자 작성
        <textarea
          maxLength={12000}
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <strong>연결할 코드 {ids.length}개</strong>
      <div className="feature-members">
        {ids.map((id) => {
          const node = snapshot.graph.nodes.find((item) => item.id === id);
          const old = snapshot.feature?.members.find(
            (item) => item.nodeId === id,
          );
          return (
            <div key={id}>
              <span>
                {node?.label ?? old?.label ?? id}
                <small>
                  {node?.sources[0]?.path ??
                    (node
                      ? node.summary
                      : "현재 연결을 찾지 못했습니다. 저장해도 기존 참조를 유지합니다.")}
                </small>
              </span>
              <button
                disabled={busy}
                onClick={() => toggle(id)}
                aria-label={`${node?.label ?? old?.label ?? id} 기능에서 제외`}
              >
                제외
              </button>
            </div>
          );
        })}
      </div>
      <label className="spec-field">
        코드 대상 검색
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          placeholder="화면, API, 함수, 파일 검색"
        />
      </label>
      <div
        className="baseline-search"
        role="group"
        aria-label="업무 기능에 포함할 코드"
      >
        {results.map((node) => (
          <label key={node.id}>
            <input
              type="checkbox"
              checked={ids.includes(node.id)}
              disabled={busy || (!ids.includes(node.id) && ids.length >= 100)}
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
      {stale ? (
        <p role="alert">
          코드나 기능 묶음이 바뀌었습니다. 닫고 다시 편집해 주세요.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="baseline-actions">
        <button
          className="primary"
          disabled={busy || disabled || stale || !title.trim() || !ids.length}
          onClick={() =>
            perform(() =>
              save({
                id: snapshot.feature?.id,
                expectedRevision: snapshot.feature?.revision ?? 0,
                expectedGraphRevision: snapshot.graph.revision,
                title,
                description,
                memberIds: ids,
              }),
            )
          }
        >
          {busy ? "저장 중…" : "기능 묶음 저장"}
        </button>
        <button disabled={busy} onClick={close}>
          닫기
        </button>
      </div>
      {snapshot.feature && remove ? (
        <details>
          <summary>기능 묶음 해제</summary>
          <p>
            묶음만 제거합니다. 원본 코드와 저장된 설계는 남으며, 해당 설계는
            다시 연결이 필요한 상태가 됩니다.
          </p>
          <button
            disabled={busy || disabled || stale}
            onClick={() =>
              perform(() =>
                remove({
                  id: snapshot.feature!.id,
                  expectedRevision: snapshot.feature!.revision,
                  expectedGraphRevision: snapshot.graph.revision,
                }),
              )
            }
          >
            이 기능 묶음 해제
          </button>
        </details>
      ) : null}
    </section>
  );
}
