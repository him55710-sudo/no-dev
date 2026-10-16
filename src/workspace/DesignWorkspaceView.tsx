import { useEffect, useMemo, useState } from "react";
import {
  ancestors,
  descendantIds,
  structureChildren,
  type StructureGraph,
  type StructureNode,
} from "./model";
import {
  specForTargets,
  observeSpec,
  implementationScope,
  type LivingSpec,
  type SpecContent,
  type BaselineRequest,
} from "./spec";
import { BaselineReview } from "./BaselineReview";
import { FeatureEditor } from "./FeatureEditor";
import { useDesignDrafts, type DraftActions } from "./useDesignDrafts";
import { draftMatches } from "./drafts";
import { DraftNotice } from "./DraftNotice";
import {
  featureNodeId,
  type Feature,
  type FeatureRequest,
  type RemoveFeatureRequest,
} from "./features";
import type { DesignWorkspaceState } from "./state";
import { StructureCanvas } from "./StructureCanvas";
import { jobIsActive } from "./job";
import { executionKey, type ExecutionUse } from "./execution";
import {
  ImplementationOptions,
  type ExecutionActions,
} from "./ImplementationOptions";
import { JobTray, phaseNames, type JobAction } from "./JobTray";
import "@xyflow/react/dist/style.css";
import "./design.css";

export type DesignActions = DraftActions &
  ExecutionActions & {
    refresh: () => Promise<unknown>;
    source: (id: string, index: number) => Promise<unknown>;
    save: (
      targets: string[],
      content: SpecContent,
      revision: number,
      specId?: string,
      draftRevision?: number,
    ) => Promise<LivingSpec>;
    implement?: (
      targets: string[],
      content: SpecContent,
      revision: number,
      execution: ExecutionUse,
      specId?: string,
      draftRevision?: number,
    ) => Promise<unknown>;
    acceptBaseline?: (request: BaselineRequest) => Promise<unknown>;
    saveFeature?: (request: FeatureRequest) => Promise<Feature>;
    removeFeature?: (request: RemoveFeatureRequest) => Promise<unknown>;
    jobAction?: (
      action: JobAction,
      payload?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
const typeNames: Record<string, string> = {
  system: "프로젝트",
  group: "모듈",
  feature: "업무 기능",
  file: "파일",
  symbol: "선언",
  rule: "규칙",
};

function StructureTree({
  graph,
  selectedId,
  onSelect,
  onEnter,
}: {
  graph: StructureGraph;
  selectedId: string;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(new Set(["system"]));
  const children = useMemo(() => {
    const result = new Map<string, StructureNode[]>();
    for (const node of graph.nodes) {
      const key = node.parentId ?? "";
      result.set(key, [...(result.get(key) ?? []), node]);
    }
    for (const node of graph.nodes)
      if (node.members) result.set(node.id, structureChildren(graph, node.id));
    result.set("system", structureChildren(graph, "system"));
    return result;
  }, [graph]);
  const render = (parent: string, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((node) => {
      const hasChildren = children.has(node.id),
        open = expanded.has(node.id);
      return (
        <li key={node.id}>
          <div
            className={`design-tree-row ${selectedId === node.id ? "selected" : ""}`}
            style={{ paddingLeft: 10 + depth * 12 }}
          >
            {hasChildren ? (
              <button
                className="tree-toggle"
                aria-label={`${node.label} ${open ? "접기" : "펼치기"}`}
                aria-expanded={open}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (open) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
              >
                {open ? "⌄" : "›"}
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <button
              className="tree-item"
              title={node.label}
              aria-current={selectedId === node.id ? "true" : undefined}
              onClick={() => onSelect(node.id)}
              onDoubleClick={() => onEnter(node.id)}
            >
              <span className={`tree-dot kind-${node.kind}`} />
              {node.label}
            </button>
          </div>
          {open && hasChildren ? <ul>{render(node.id, depth + 1)}</ul> : null}
        </li>
      );
    });
  return (
    <nav aria-label="프로젝트 구조">
      <ul className="design-tree">{render("", 0)}</ul>
    </nav>
  );
}

function SpecEditor({
  spec,
  graph,
  content,
  dirty,
  saving,
  readOnly,
  onChange,
  onSave,
  onSource,
  implementation,
  acceptBaseline,
}: {
  spec: LivingSpec;
  graph: StructureGraph;
  content: SpecContent;
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  onChange: (content: SpecContent) => void;
  onSave: () => void;
  onSource: (id: string, index: number) => void;
  implementation?: React.ReactNode;
  acceptBaseline?: (request: BaselineRequest) => Promise<unknown>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const observation = observeSpec(spec, graph);
  const fields: [
    keyof Pick<
      SpecContent,
      "purpose" | "desired" | "policies" | "inputsOutputs" | "failures"
    >,
    string,
    string,
  ][] = [
    ["purpose", "역할과 목적", "이 기능이 필요한 이유를 적어 주세요."],
    [
      "desired",
      "원하는 동작",
      "어떤 동작으로 바꾸려는지 구체적으로 적어 주세요.",
    ],
    ["policies", "정책과 조건", "권한, 분기, 상태 변화, 제한"],
    [
      "inputsOutputs",
      "입출력과 데이터",
      "받는 정보, 반환하는 결과, 저장되는 데이터",
    ],
    ["failures", "예외와 실패 처리", "실패할 때 사용자가 확인해야 할 동작"],
  ];
  return (
    <div className="spec-editor">
      <div className="spec-heading">
        <span className="eyebrow">LIVING SPEC</span>
        <span className="spec-version">
          {spec.revision ? `저장 v${spec.revision}` : "새 설계"}
          {dirty ? " · 작성 중" : ""}
        </span>
      </div>
      <label className="spec-title-label">
        설계 이름
        <input
          value={content.title}
          maxLength={160}
          disabled={saving}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
        />
      </label>
      <section
        className={`observed-block ${observation.status !== "unchanged" ? "needs-review" : ""}`}
      >
        <span className="eyebrow">현재 구현의 기준선</span>
        <p>{spec.baseline.observed || "아직 구현 근거가 없습니다."}</p>
        {observation.status !== "unchanged" ? (
          <div role="status">
            <strong>설계와 구현의 재검토가 필요해요</strong>
            {observation.details.map((detail, i) => (
              <p key={i}>{detail}</p>
            ))}
            <p>
              아래 목표는 유지됩니다. 코드 변화만으로 동작의 정합성을 판정하지
              않습니다.
            </p>
          </div>
        ) : null}
        <div className="source-pills">
          {spec.targetIds.map((id) => {
            const node = graph.nodes.find((n) => n.id === id);
            return node?.sources.map((ref, index) => (
              <button
                key={`${id}:${index}`}
                onClick={() => onSource(id, index)}
              >
                {ref.path.split("/").at(-1)}:{ref.line} ↗
              </button>
            ));
          })}
        </div>
        {acceptBaseline && spec.revision > 0 ? (
          <>
            <button
              disabled={dirty || saving || readOnly}
              onClick={() => setReviewing(true)}
            >
              기준 코드 비교·다시 연결
            </button>
            {dirty ? (
              <p>작성 중인 설계를 먼저 저장한 뒤 기준 코드를 비교해 주세요.</p>
            ) : null}
            {reviewing ? (
              <BaselineReview
                key={spec.id}
                spec={spec}
                graph={graph}
                disabled={dirty || saving || readOnly}
                accept={acceptBaseline}
                close={() => setReviewing(false)}
                source={onSource}
              />
            ) : null}
          </>
        ) : null}
        {spec.baselineHistory?.length ? (
          <details className="baseline-history">
            <summary>이전 기준 {spec.baselineHistory.length}개</summary>
            {spec.baselineHistory
              .slice()
              .reverse()
              .map((entry) => (
                <details key={entry.revision}>
                  <summary>
                    설계 v{entry.revision} ·{" "}
                    {new Date(entry.replacedAt).toLocaleString()}
                  </summary>
                  <p>{entry.baseline.observed}</p>
                  {entry.baseline.sources.map((ref, i) => (
                    <p key={i}>
                      {ref.path}:{ref.line} · {ref.symbol}
                      <small>코드 해시 {ref.contentHash.slice(0, 12)}</small>
                    </p>
                  ))}
                </details>
              ))}
          </details>
        ) : null}
      </section>
      {fields.map(([key, label, placeholder]) => (
        <label
          className={`spec-field ${key === "desired" ? "desired-field" : ""}`}
          key={key}
        >
          {label}
          <textarea
            value={content[key]}
            placeholder={placeholder}
            rows={key === "desired" ? 4 : 2}
            maxLength={12000}
            disabled={saving}
            onChange={(e) => onChange({ ...content, [key]: e.target.value })}
          />
        </label>
      ))}
      {(
        [
          ["invariants", "유지해야 하는 동작"],
          ["acceptance", "완료 기준"],
        ] as const
      ).map(([key, label]) => (
        <label className="spec-field" key={key}>
          {label}
          <span className="field-hint">한 줄에 한 가지씩</span>
          <textarea
            value={content[key].join("\n")}
            rows={3}
            disabled={saving}
            onChange={(e) =>
              onChange({ ...content, [key]: e.target.value.split("\n") })
            }
          />
        </label>
      ))}
      <footer className="spec-actions">
        <button
          className="primary"
          onClick={onSave}
          disabled={saving || readOnly || !content.title.trim()}
        >
          {saving ? "저장 중…" : "설계만 저장"}
        </button>
        <p>설계만 저장하면 구현을 실행하지 않습니다.</p>
        {implementation}
      </footer>
    </div>
  );
}

export function DesignWorkspaceView({
  state,
  actions,
}: {
  state: DesignWorkspaceState;
  actions: DesignActions;
}) {
  const [selection, updateSelection] = useState(state.selectedId);
  const [savedSpecId, setSavedSpecId] = useState<string>();
  const setSelection = (id: string) => {
    updateSelection(id);
    setSavedSpecId(undefined);
  };
  const [connections, setConnections] = useState<string[]>([]);
  const [scope, updateScope] = useState("system");
  const [scopeTrail, setScopeTrail] = useState(["system"]);
  const [editingFeature, setEditingFeature] = useState<string>();
  const [search, setSearch] = useState("");
  const [included, setIncluded] = useState<string[]>([]);
  const drafts = useDesignDrafts(state.drafts ?? [], state.projectKey, actions);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    setSelection(state.selectedId);
  }, [state.selectedId]);
  const graph = state.graph;
  const setScope = (id: string) => {
    updateScope(id);
    setScopeTrail((old) =>
      old.includes(id)
        ? old.slice(0, old.indexOf(id) + 1)
        : graph &&
            structureChildren(graph, scope).some((node) => node.id === id)
          ? [...old, id]
          : graph
            ? ancestors(graph, id).map((node) => node.id)
            : ["system"],
    );
  };
  const selected = graph?.nodes.find((node) => node.id === selection);
  const edge = graph?.edges.find((item) => item.id === selection);
  const selectedId = selected?.id ?? edge?.id ?? "system";
  const scopeId = graph?.nodes.some((node) => node.id === scope)
    ? scope
    : "system";
  const targetIds = included.length ? included : selected ? [selected.id] : [];
  const targetsKey = targetIds.slice().sort().join("|");
  const currentSpec = useMemo(() => {
    if (!graph) return undefined;
    const pinned = state.specs.specs.find((item) => item.id === savedSpecId);
    if (pinned) return pinned;
    if (!targetIds.length) return undefined;
    try {
      return specForTargets(state.specs, graph, targetIds);
    } catch {
      return undefined;
    }
  }, [graph, state.specs, targetsKey, savedSpecId]);
  const draft = drafts.entries.get(savedSpecId ?? currentSpec?.id ?? "");
  const spec = draft?.base ?? currentSpec;
  const content = draft?.content ?? spec?.content;
  const draftConflict =
    !!draft && (!currentSpec || !draftMatches(draft, currentSpec));
  const memberships = useMemo(
    () =>
      graph && selected
        ? graph.nodes.filter(
            (node) =>
              node.kind === "feature" &&
              descendantIds(graph, [node.id]).has(selected.id),
          )
        : [],
    [graph, selected],
  );
  const breadcrumbs = graph
    ? scopeTrail.at(-1) === scopeId &&
      scopeTrail.every((id) => graph.nodes.some((node) => node.id === id))
      ? scopeTrail.map((id) => graph.nodes.find((node) => node.id === id)!)
      : ancestors(graph, scopeId)
    : [];
  const related = useMemo(
    () =>
      graph && spec ? implementationScope(graph, spec.targetIds) : undefined,
    [graph, spec],
  );
  const perform = (work: () => Promise<unknown>) => {
    setFeedback("");
    void work().catch((e) =>
      setFeedback(e instanceof Error ? e.message : String(e)),
    );
  };
  const enter = (id: string) => {
    setSelection(id);
    if (graph && structureChildren(graph, id).length) setScope(id);
  };
  const source = (id: string, index: number) =>
    perform(() => actions.source(id, index));
  const save = (execution?: ExecutionUse) => {
    const implement = !!execution;
    if (!spec || !content || draftConflict) return;
    setSaving(true);
    setFeedback("");
    const cleaned = {
      ...content,
      invariants: content.invariants.map((v) => v.trim()).filter(Boolean),
      acceptance: content.acceptance.map((v) => v.trim()).filter(Boolean),
    };
    const request = drafts
      .flush(spec.id)
      .then((draftRevision) =>
        execution && actions.implement
          ? actions.implement(
              spec.targetIds,
              cleaned,
              spec.revision,
              execution,
              spec.revision ? spec.id : undefined,
              draftRevision,
            )
          : actions.save(
              spec.targetIds,
              cleaned,
              spec.revision,
              spec.revision ? spec.id : undefined,
              draftRevision,
            ),
      );
    void request
      .then(() => {
        drafts.forget(spec.id);
        setFeedback(
          implement
            ? "설계를 저장하고 구현 작업을 시작했습니다."
            : "설계를 저장했습니다. 현재 구현과 목표는 별도로 유지됩니다.",
        );
      })
      .catch((e) => setFeedback(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };
  const results =
    graph && search.trim()
      ? graph.nodes
          .filter((node) =>
            `${node.label} ${node.sources[0]?.path ?? ""} ${node.summary}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
          )
          .slice(0, 80)
      : undefined;
  return (
    <main className={`design-workspace ${focus ? "spec-focused" : ""}`}>
      <header className="design-topbar">
        <div className="design-brand">
          <span className="brand-mark">P</span>
          <div>
            <strong>풀어봄</strong>
            <span>시스템 설계 워크스페이스</span>
          </div>
        </div>
        <span className="project-name">{state.projectName || "프로젝트"}</span>
        <span
          className={`analysis-status ${state.stale ? "stale" : ""}`}
          role="status"
        >
          {state.busy
            ? "구조를 읽고 있어요…"
            : state.stale
              ? "변경 감지됨"
              : graph
                ? `${graph.files.length}개 파일 연결됨`
                : "분석 대기"}
        </span>
        <button onClick={() => perform(actions.refresh)} disabled={state.busy}>
          구조 새로 읽기
        </button>
      </header>
      <div className="design-content">
        <aside className="design-sidebar">
          <label className="design-search">
            <span className="sr-only">구조 검색</span>
            <input
              placeholder="기능, 규칙, 파일 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="sidebar-heading">
            {results ? "검색 결과" : "프로젝트 구조"}
            <span>{results ? results.length : (graph?.nodes.length ?? 0)}</span>
          </div>
          {actions.saveFeature ? (
            <button
              className="feature-create"
              disabled={
                !graph ||
                !state.trusted ||
                state.busy ||
                state.stale ||
                jobIsActive(state.job) ||
                state.job?.phase === "recovery"
              }
              onClick={() => setEditingFeature("new")}
            >
              업무 기능 만들기
            </button>
          ) : null}
          {graph ? (
            results ? (
              <ul className="search-results">
                {results.map((node) => (
                  <li key={node.id}>
                    <button
                      onClick={() => {
                        setSelection(node.id);
                        setScope(node.parentId ?? "system");
                      }}
                    >
                      <strong>{node.label}</strong>
                      <span>
                        {typeNames[node.kind]} ·{" "}
                        {node.sources[0]?.path ?? node.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <StructureTree
                graph={graph}
                selectedId={selectedId}
                onSelect={setSelection}
                onEnter={enter}
              />
            )
          ) : (
            <p className="empty-message">
              프로젝트에서 구조를 읽으면 여기에 표시돼요.
            </p>
          )}
          {state.specs.specs.length ? (
            <>
              <div className="sidebar-heading">
                저장된 설계<span>{state.specs.specs.length}</span>
              </div>
              <ul className="saved-specs">
                {state.specs.specs.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => {
                        setIncluded(item.targetIds);
                        setSelection(item.targetIds[0]);
                        setSavedSpecId(item.id);
                      }}
                    >
                      {item.content.title}
                      <span>v{item.revision}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {drafts.entries.size ? (
            <>
              <div className="sidebar-heading">
                작성 중 초안<span>{drafts.entries.size}</span>
              </div>
              <ul className="saved-specs">
                {[...drafts.entries.values()].map((item) => (
                  <li key={item.base.id}>
                    <button
                      onClick={() => {
                        setIncluded(item.base.targetIds);
                        setSelection(item.base.targetIds[0]);
                        setSavedSpecId(item.base.id);
                      }}
                    >
                      {item.content.title || item.base.content.title}
                      <span>
                        {item.status === "saved" ? "보관됨" : "작성 중"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {state.draftError ? (
            <p className="empty-message" role="alert">
              {state.draftError}
            </p>
          ) : null}
          <p className="sidebar-note">
            업무 기능은 사용자가 연결한 코드 묶음입니다. 코드 구조에서 모든
            구현을 경로대로 탐색할 수 있어요.
          </p>
        </aside>
        <section className="design-center" aria-label="시스템 구조 캔버스">
          <nav className="design-breadcrumb" aria-label="현재 탐색 위치">
            {graph
              ? breadcrumbs.map((node, index) => (
                  <span key={node.id}>
                    {index ? " / " : ""}
                    <button
                      onClick={() => {
                        setScope(node.id);
                        setSelection(node.id);
                      }}
                    >
                      {node.id === "system"
                        ? state.projectName || "프로젝트"
                        : node.label}
                    </button>
                  </span>
                ))
              : "프로젝트"}
          </nav>
          <div className="canvas-heading">
            <div>
              <span className="eyebrow">SYSTEM EXPLORER</span>
              <h1>
                {graph?.nodes.find((node) => node.id === scopeId)?.label ??
                  "코드에서 시스템으로"}
              </h1>
              <p>선택해서 설계를 읽고, 두 번 눌러 내부 구조로 들어가세요.</p>
            </div>
          </div>
          <div className="design-canvas">
            {graph ? (
              <StructureCanvas
                graph={graph}
                scopeId={scopeId}
                selectedId={selectedId}
                onSelect={setSelection}
                onEnter={enter}
                onConnection={(ids) => {
                  setConnections(ids);
                  setSelection(ids[0]);
                }}
              />
            ) : (
              <div className="canvas-empty">
                <strong>프로젝트 구조를 준비하고 있어요</strong>
                <p>코드는 실행하거나 외부로 보내지 않습니다.</p>
              </div>
            )}
          </div>
          <div className="canvas-footer">
            <span>노드 이동은 화면 배치만 바꿉니다.</span>
            <span>{graph?.edges.length ?? 0}개 정적 연결</span>
          </div>
        </section>
        <aside className="design-inspector" aria-label="선택한 구조의 설계">
          <header className="inspector-header">
            <span>{edge ? "연결의 근거" : "세부 설계"}</span>
            <button onClick={() => setFocus(!focus)} aria-pressed={focus}>
              {focus ? "구조 함께 보기" : "집중 보기"}
            </button>
          </header>
          {editingFeature && graph && actions.saveFeature ? (
            <FeatureEditor
              key={editingFeature}
              graph={graph}
              feature={state.specs.features?.find(
                (item) => item.id === editingFeature,
              )}
              initialIds={
                included.length ? included : selected ? [selected.id] : []
              }
              disabled={
                !state.trusted ||
                state.busy ||
                state.stale ||
                jobIsActive(state.job) ||
                state.job?.phase === "recovery"
              }
              save={async (request) => {
                const feature = await actions.saveFeature!(request);
                setIncluded([]);
                setSelection(featureNodeId(feature.id));
                setScope("system");
                return feature;
              }}
              remove={
                actions.removeFeature
                  ? async (request) => {
                      await actions.removeFeature!(request);
                      setIncluded([]);
                      setSelection("system");
                      setScope("system");
                    }
                  : undefined
              }
              close={() => setEditingFeature(undefined)}
            />
          ) : null}
          <div hidden={!!editingFeature}>
            {edge && graph ? (
              <div className="edge-inspector">
                {connections.includes(edge.id) && connections.length > 1 ? (
                  <nav aria-label="묶인 연결의 근거">
                    <p>이 선에 포함된 {connections.length}개 연결</p>
                    {connections.map((id) => {
                      const item = graph.edges.find(
                        (candidate) => candidate.id === id,
                      );
                      return item ? (
                        <button
                          key={id}
                          aria-current={edge.id === id ? "true" : undefined}
                          onClick={() => setSelection(id)}
                        >
                          {item.kind} · {item.sources[0]?.path}:
                          {item.sources[0]?.line}
                        </button>
                      ) : null;
                    })}
                  </nav>
                ) : null}
                <span className="eyebrow">{edge.kind.toUpperCase()}</span>
                <h2>
                  {graph.nodes.find((node) => node.id === edge.source)?.label} →{" "}
                  {graph.nodes.find((node) => node.id === edge.target)?.label}
                </h2>
                <p>
                  컴파일러가 정적으로 확인한{" "}
                  {edge.kind === "calls"
                    ? "호출"
                    : edge.kind === "renders"
                      ? "화면 구성"
                      : "모듈"}{" "}
                  연결입니다. 런타임 실행·데이터 계약·실패 처리는 별도 확인이
                  필요합니다.
                </p>
                {edge.sources.map((ref, index) => (
                  <button key={index} onClick={() => source(edge.id, index)}>
                    {ref.path}:{ref.line} 원문 ↗
                  </button>
                ))}
                <button
                  className="primary"
                  onClick={() => {
                    setIncluded([edge.source, edge.target]);
                    setSelection(edge.target);
                  }}
                >
                  두 대상을 함께 설계하기
                </button>
              </div>
            ) : null}
            {selected ? (
              <div className="target-controls">
                <span>
                  {typeNames[selected.kind]} · {selected.label}
                </span>
                <button
                  onClick={() => {
                    setSavedSpecId(undefined);
                    setIncluded((old) =>
                      old.includes(selected.id)
                        ? old.filter((id) => id !== selected.id)
                        : [...old, selected.id],
                    );
                  }}
                >
                  {included.includes(selected.id)
                    ? "대상에서 제외"
                    : "설계에 포함"}
                </button>
              </div>
            ) : null}
            {selected?.kind === "feature" ? (
              <section className="feature-overview">
                <strong>사용자가 정의한 업무 기능</strong>
                <p>{selected.description || "기능 설명을 추가할 수 있어요."}</p>
                {selected.unresolvedMembers?.map((member) => (
                  <p key={member.nodeId} role="status">
                    다시 연결 필요: {member.label}
                  </p>
                ))}
                {actions.saveFeature ? (
                  <button
                    disabled={
                      !state.trusted ||
                      state.busy ||
                      state.stale ||
                      jobIsActive(state.job) ||
                      state.job?.phase === "recovery"
                    }
                    onClick={() =>
                      setEditingFeature(selected.id.slice("feature:".length))
                    }
                  >
                    기능 이름·코드 묶음 편집
                  </button>
                ) : null}
              </section>
            ) : memberships.length ? (
              <nav
                className="feature-overview"
                aria-label="이 코드가 포함된 업무 기능"
              >
                <strong>이 코드가 포함된 업무 기능</strong>
                {memberships.map((feature) => (
                  <button
                    key={feature.id}
                    onClick={() => {
                      setIncluded([]);
                      setScope(feature.id);
                      setSelection(feature.id);
                    }}
                  >
                    {feature.label}
                  </button>
                ))}
              </nav>
            ) : null}
            {included.length ? (
              <div className="included-targets">
                <span>{included.length}개 대상을 함께 설계</span>
                <button
                  onClick={() => {
                    setSavedSpecId(undefined);
                    setIncluded([]);
                  }}
                >
                  선택 해제
                </button>
              </div>
            ) : null}
            {selected && graph ? (
              <details className="related-structure">
                <summary>직접 연결된 구현</summary>
                {graph.edges
                  .filter(
                    (item) =>
                      item.source === selected.id ||
                      item.target === selected.id,
                  )
                  .map((item) => {
                    const id =
                      item.source === selected.id ? item.target : item.source;
                    const node = graph.nodes.find((n) => n.id === id)!;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSelection(node.id);
                          setScope(node.parentId ?? "system");
                        }}
                      >
                        <strong>
                          {item.source === selected.id ? "→ " : "← "}
                          {node.label}
                        </strong>
                        <span>
                          {node.sources[0]?.path} · {item.kind}
                        </span>
                      </button>
                    );
                  })}
                <p>
                  호출·화면 연결로 함께 검토할 파일 {related?.paths.length ?? 0}
                  개
                </p>
                {related?.paths.map((path) => (
                  <small key={path}>{path}</small>
                ))}
              </details>
            ) : null}
            {spec && content && graph ? (
              <>
                {draft ? (
                  <DraftNotice
                    key={spec.id}
                    draft={draft}
                    current={currentSpec}
                    graphRevision={graph.revision}
                    conflict={draftConflict}
                    busy={saving}
                    retry={() => drafts.retry(spec.id)}
                    discard={() => {
                      setSaving(true);
                      perform(async () => {
                        try {
                          await drafts.discard(spec.id);
                          setFeedback(
                            "초안을 버렸습니다. 확정된 설계는 유지됩니다.",
                          );
                        } finally {
                          setSaving(false);
                        }
                      });
                    }}
                    rebase={async (current, revision) => {
                      setSaving(true);
                      try {
                        await drafts.rebase(spec.id, current, revision);
                        setFeedback(
                          "초안의 입력을 유지하고 편집 기준을 갱신했습니다.",
                        );
                      } catch (error) {
                        setFeedback(String(error));
                        throw error;
                      } finally {
                        setSaving(false);
                      }
                    }}
                  />
                ) : null}
                <SpecEditor
                  key={spec.id}
                  spec={spec}
                  graph={graph}
                  content={content}
                  dirty={!!draft}
                  saving={saving}
                  readOnly={
                    !state.trusted || state.stale || state.busy || draftConflict
                  }
                  onChange={(next) => drafts.change(spec, next)}
                  onSave={() => save()}
                  onSource={source}
                  acceptBaseline={
                    actions.acceptBaseline &&
                    !jobIsActive(state.job) &&
                    state.job?.phase !== "recovery"
                      ? async (request) => {
                          await actions.acceptBaseline!(request);
                          updateSelection(request.targetIds[0]);
                          setIncluded(request.targetIds);
                          setSavedSpecId(request.specId);
                          setFeedback(
                            "검토한 코드를 새 기준으로 저장했습니다. 설계 목표는 그대로 유지됩니다.",
                          );
                        }
                      : undefined
                  }
                  implementation={
                    actions.implement ? (
                      <ImplementationOptions
                        key={
                          state.execution
                            ? `${executionKey(state.execution.context)}:${state.execution.profile.revision}`
                            : "loading"
                        }
                        state={state}
                        actions={actions}
                        onImplement={save}
                        disabled={
                          saving ||
                          draftConflict ||
                          !state.trusted ||
                          state.stale ||
                          state.busy ||
                          observeSpec(spec, graph).status !== "unchanged" ||
                          jobIsActive(state.job) ||
                          state.job?.phase === "recovery" ||
                          !content.desired.trim() ||
                          !content.acceptance.some((line) => line.trim())
                        }
                      />
                    ) : undefined
                  }
                />
              </>
            ) : !edge ? (
              <p className="empty-message">
                구조를 선택하면 현재 구현과 원하는 동작을 함께 확인할 수 있어요.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
      {actions.jobAction ? (
        <details className="implementation-history">
          <summary>이전 구현 작업 {state.jobHistory?.length ?? 0}개</summary>
          <button
            disabled={jobIsActive(state.job)}
            onClick={() => perform(() => actions.jobAction!("jobHistory"))}
          >
            작업 기록 새로고침
          </button>
          {state.jobHistory?.map((entry) => (
            <button
              key={entry.workspaceId}
              disabled={jobIsActive(state.job)}
              onClick={() =>
                perform(() =>
                  actions.jobAction!("restoreJob", {
                    workspaceId: entry.workspaceId,
                  }),
                )
              }
            >
              {new Date(entry.startedAt).toLocaleString()} · {entry.specId} ·{" "}
              마지막 기록: {phaseNames[entry.phase]}
            </button>
          ))}
          {state.jobHistoryErrors?.length ? (
            <details>
              <summary>
                불러오지 못한 기록 {state.jobHistoryErrors.length}개
              </summary>
              {state.jobHistoryErrors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </details>
          ) : null}
        </details>
      ) : null}
      {state.job && actions.jobAction ? (
        <JobTray
          key={state.job.id}
          job={state.job}
          action={(action, payload) => actions.jobAction!(action, payload)}
        />
      ) : null}
      <footer className="design-statusbar">
        <span className="status-dot" />
        <span role="status">
          {feedback ||
            state.error ||
            "로컬 정적 분석 · 설계 목표와 구현 근거를 따로 보존합니다."}
        </span>
        <details>
          <summary>
            확인하지 못한 범위{" "}
            {(graph?.notices.length ?? 0) + state.notices.length}
          </summary>
          <div>
            {[
              ...state.notices,
              ...(graph?.notices.map(
                (n) =>
                  `${n.path ?? ""}${n.line ? `:${n.line}` : ""} ${n.message}`,
              ) ?? []),
            ].map((notice, i) => (
              <p key={i}>{notice}</p>
            ))}
            <p>
              폴더 구조와 정적 참조가 업무 기능 경계나 실행 시 동작을 증명하지는
              않습니다.
            </p>
          </div>
        </details>
      </footer>
    </main>
  );
}
