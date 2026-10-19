import { useMemo } from "react";
import type { SourceRef, StructureGraph } from "./model";
import { currentObservations, type LivingSpec, type SpecContent } from "./spec";
import {
  compareObservations,
  observationSource,
  type FactChange,
  type ObservedFact,
  type ObservedRelation,
  type ObservationSnapshot,
} from "./observations";

const labels: Record<FactChange["status"], string> = {
  unchanged: "같은 코드 근거",
  changed: "코드 변경",
  moved: "같은 내용 · 위치 변경",
  description: "같은 코드 · 관측 설명 갱신",
  added: "새로 관측",
  unresolved: "연결 확인 필요",
};
const relationLabels = {
  imports: "모듈 연결",
  calls: "호출",
  renders: "화면 구성",
  passes: "함수 전달",
};

function EvidenceLink({
  graph,
  refValue,
  source,
  disabled,
}: {
  graph: StructureGraph;
  refValue: SourceRef;
  source: (id: string, index: number) => void;
  disabled: boolean;
}) {
  const anchor = observationSource(graph, refValue);
  return (
    <span className="observation-anchor">
      <code>
        {refValue.path}:{refValue.line}
      </code>
      {anchor ? (
        <button
          disabled={disabled}
          onClick={() => source(anchor.id, anchor.index)}
        >
          현재 근거 열기 ↗
        </button>
      ) : null}
    </span>
  );
}
function FactText({ fact }: { fact: ObservedFact }) {
  return (
    <>
      <p>{fact.summary || "이 선언의 동작 설명은 아직 제공하지 않습니다."}</p>
      {fact.summaryTruncated ? (
        <small>설명이 길어 앞부분만 보관했습니다.</small>
      ) : null}
      {!fact.supported ? (
        <p className="observation-limitation">
          이 파일의 동작 분석은 지원하지 않습니다. 원문 근거만 연결합니다.
        </p>
      ) : !fact.syntaxValid ? (
        <p className="observation-limitation">
          문법 오류가 있는 파일입니다. 아래 관측을 완전한 동작으로 해석하지
          마세요.
        </p>
      ) : null}
    </>
  );
}
function Coverage({
  snapshot,
  label,
}: {
  snapshot: ObservationSnapshot;
  label: string;
}) {
  const omitted =
    snapshot.totals.facts -
    snapshot.facts.length +
    snapshot.totals.relations -
    snapshot.relations.length;
  return (
    <p className="observation-coverage">
      {label} · 동작·선언 {snapshot.facts.length}/{snapshot.totals.facts}개 ·
      연결 {snapshot.relations.length}/{snapshot.totals.relations}개
      {omitted > 0
        ? " · 일부 항목은 보관 한도로 생략됐습니다. 더 작은 기능을 선택해 비교하세요."
        : ""}
    </p>
  );
}
function RelationText({ relation }: { relation: ObservedRelation }) {
  return (
    <p>
      {relation.from.label} → {relation.to.label} ·{" "}
      {relationLabels[relation.kind]} {relation.count}곳
    </p>
  );
}

/** Read-only evidence comparison. It neither accepts a baseline nor grades free-form intent. */
export function ObservationComparison({
  spec,
  graph,
  content,
  source,
  disabled = false,
}: {
  spec: LivingSpec;
  graph: StructureGraph;
  content: SpecContent;
  source: (id: string, index: number) => void;
  disabled?: boolean;
}) {
  const result = useMemo(() => {
    // Resolve uniquely unchanged evidence without rewriting saved target identities.
    // Ambiguous or missing targets remain visible as unresolved.
    const current = currentObservations(spec, graph);
    return {
      current,
      ...compareObservations(spec.baseline.observations, current),
    };
  }, [graph, spec]);
  const priority = (status: FactChange["status"]) =>
    status === "unchanged" ? 2 : status === "description" ? 1 : 0;
  const ordered = result.facts
    .slice()
    .sort((a, b) => priority(a.status) - priority(b.status));
  const changed = ordered.filter((item) => item.status !== "unchanged").length;
  const changedRelations = result.relations.filter(
    (item) => item.status !== "unchanged",
  ).length;
  return (
    <section
      className="observation-comparison"
      aria-label="설계와 코드 관측 비교"
    >
      <h3>설계와 코드 관측 비교</h3>
      <div className="observation-intent">
        <strong>원하는 동작</strong>
        <p>
          {content.desired.trim() ||
            "원하는 동작을 작성하면 현재 관측과 함께 비교할 수 있습니다."}
        </p>
        <span>목표 충족 여부는 아직 이 비교에서 판정하지 않습니다.</span>
      </div>
      <p>
        정적 분석으로 확인한 조건·설명·호출 관계입니다. 코드가 같거나 검사가
        통과했다는 사실만으로 목표를 달성했다고 표시하지 않습니다.
      </p>
      {result.legacy ? (
        <p role="status">
          이 설계에는 이전의 항목별 관측 기록이 없습니다. 저장된 기준 설명은
          위에 유지하며, 아래에는 현재 관측만 표시합니다.
        </p>
      ) : (
        <Coverage snapshot={spec.baseline.observations!} label="저장한 기준" />
      )}
      <Coverage snapshot={result.current} label="현재 분석" />
      <details>
        <summary>
          동작·선언 {ordered.length}개
          {!result.legacy ? ` · 달라진 관측 ${changed}개` : ""}
        </summary>
        {/* Keep one stable content child in native details while keyed facts move. */}
        <div className="observation-list">
          {ordered.length ? (
            ordered.map((item) => {
              const fact = item.current ?? item.before!;
              return (
                <article
                  className={`observation-item observation-${item.status}`}
                  key={`${item.before?.id ?? "new"}:${fact.id}`}
                >
                  <h4>
                    {fact.label}{" "}
                    <span>
                      {result.legacy ? "현재 관측" : labels[item.status]}
                    </span>
                  </h4>
                  {item.before && item.status !== "unchanged" ? (
                    <div className="observation-before">
                      <strong>저장할 때</strong>
                      <FactText fact={item.before} />
                      <code>
                        {item.before.source.path}:{item.before.source.line}
                      </code>
                    </div>
                  ) : null}
                  {item.current ? (
                    <div className="observation-current">
                      <strong>
                        {item.before && item.status !== "unchanged"
                          ? "현재 코드"
                          : "관측 내용"}
                      </strong>
                      <FactText fact={item.current} />
                      <EvidenceLink
                        graph={graph}
                        refValue={item.current.source}
                        source={source}
                        disabled={disabled}
                      />
                    </div>
                  ) : (
                    <p>
                      현재 비교 범위에서 유일한 근거를 찾지 못했습니다.
                      삭제·이름 변경·범위 변경 또는 분석/보관 누락을 확인해
                      주세요.
                    </p>
                  )}
                </article>
              );
            })
          ) : (
            <p>현재 선택 범위에서 표시할 코드 관측이 없습니다.</p>
          )}
        </div>
      </details>
      <details>
        <summary>
          호출·모듈·화면·함수 전달 {result.relations.length}개
          {!result.legacy ? ` · 변경·확인 필요 ${changedRelations}개` : ""}
        </summary>
        <div className="observation-list">
          {result.relations.map((item, index) => {
            const relation = item.current ?? item.before!;
            return (
              <article
                className="observation-item"
                key={`${relation.from.id}:${relation.to.id}:${relation.kind}:${index}`}
              >
                <strong>
                  {result.legacy
                    ? "현재 연결"
                    : item.status === "unresolved"
                      ? "현재 관측되지 않은 연결"
                      : item.status === "unverified"
                        ? "연결 상세 비교 근거 부족"
                        : labels[item.status]}
                </strong>
                {item.status === "unverified" ? (
                  <p>
                    이전 또는 현재 관측에 인수·주변 구문 지문이 없습니다. 호출
                    횟수가 같아도 상세 내용이 같은지는 판정하지 않습니다.
                  </p>
                ) : null}
                {item.status === "changed" &&
                item.before?.count === item.current?.count ? (
                  <p>
                    연결 횟수는 같지만 전달식 또는 주변 구문의 코드 근거가
                    달라졌습니다.
                  </p>
                ) : null}
                {item.before && item.status !== "unchanged" ? (
                  <div className="observation-before">
                    <small>저장할 때</small>
                    <RelationText relation={item.before} />
                    <code>
                      {item.before.source.path}:{item.before.source.line}
                    </code>
                  </div>
                ) : null}
                {item.current ? (
                  <>
                    <RelationText relation={item.current} />
                    <EvidenceLink
                      graph={graph}
                      refValue={item.current.source}
                      source={source}
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <p>
                    정적 연결을 찾지 못했습니다. 실제 실행 경로가 제거됐다는
                    판정은 아닙니다.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </details>
      <details>
        <summary>
          확인할 완료 기준{" "}
          {content.acceptance.filter((value) => value.trim()).length}개 · 유지
          조건 {content.invariants.filter((value) => value.trim()).length}개
        </summary>
        <p>
          아래 항목은 이 코드 비교만으로 충족 여부가 확인되지 않습니다. 구현
          작업의 변경 검토에서 실제 결과와 검사 근거를 항목별로 기록하세요.
        </p>
        <ul>
          {content.acceptance
            .filter((value) => value.trim())
            .map((text, index) => (
              <li key={`acceptance:${index}`}>
                <strong>완료 기준</strong> {text}
              </li>
            ))}
          {content.invariants
            .filter((value) => value.trim())
            .map((text, index) => (
              <li key={`invariant:${index}`}>
                <strong>유지 조건</strong> {text}
              </li>
            ))}
        </ul>
      </details>
      {result.current.notices.length || result.current.totals.notices ? (
        <details>
          <summary>현재 관측의 제한 {result.current.totals.notices}개</summary>
          {result.current.notices.map((notice, index) => (
            <p key={index}>{notice}</p>
          ))}
          {result.current.notices.length < result.current.totals.notices ? (
            <p>
              일부 안내를 생략했습니다. 전체 분석 안내와 원문을 함께 확인하세요.
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
