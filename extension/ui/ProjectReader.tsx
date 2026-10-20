import { useEffect, useRef, useState } from "react";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import {
  specForTargets,
  observeSpec,
  type LivingSpec,
} from "../../src/workspace/spec";
import {
  readingChangeContext,
  type CodeBlock,
} from "../../src/workspace/codeReading";
import { CodeReading } from "./CodeReading";
import { jobIsActive } from "../../src/workspace/job";
import { request, host } from "./bridge";
import "./projectReader.css";

export function ProjectReader({
  state,
  onAdvanced,
}: {
  state: DesignWorkspaceState;
  onAdvanced: () => void;
}) {
  const saved = (host.getState() ?? {}) as Record<string, unknown>;
  const [part, setPart] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedBlock, setSelectedBlock] = useState<{
    path: string;
    sourceHash: string;
    startLine: number;
  } | null>(null);
  const wantedInput = useRef<HTMLTextAreaElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    saved.projectKey === state.projectKey &&
    saved.readerDrafts &&
    typeof saved.readerDrafts === "object"
      ? Object.fromEntries(
          Object.entries(saved.readerDrafts).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {},
  );
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [acceptUnknown, setAcceptUnknown] = useState(false);
  const [acceptScope, setAcceptScope] = useState(false);
  const [acceptTests, setAcceptTests] = useState(false);
  const compareAttempt = useRef("");
  const story = state.story,
    graph = state.graph,
    job = state.job;
  const current = !!story && story.revision === graph?.revision && !state.stale;
  const selected = part === null ? null : story?.parts[part];
  const files =
    story?.files.filter(
      (file) => !selected || selected.paths.includes(file.path),
    ) ?? [];
  const file = files.find((file) => file.path === selectedFile);
  const reading =
    state.fileReading?.path === file?.path ? state.fileReading : undefined;
  const readingCurrent =
    !!reading && reading.revision === graph?.revision && !state.stale;
  const block =
    reading &&
    selectedBlock?.path === reading.path &&
    selectedBlock.sourceHash === reading.sourceHash
      ? reading.blocks.find(
          (block) => block.startLine === selectedBlock.startLine,
        )
      : undefined;
  const title =
    block?.title ?? file?.title ?? selected?.title ?? "프로젝트 전체";
  const draftKey =
    (block && reading
      ? `${reading.path}#${reading.sourceHash}:${block.startLine}`
      : file?.path) ??
    (selected ? selected.paths.slice().sort().join("|") : "system");
  const wanted = drafts[draftKey] ?? "";
  const setWanted = (text: string) =>
    setDrafts((current) => ({ ...current, [draftKey]: text }));
  const busy =
    working ||
    jobIsActive(job) ||
    !!state.storyProgress ||
    !!state.fileReadingProgress ||
    !!state.changeStoryBusy;
  const active =
    !!job &&
    [
      "preparing",
      "running",
      "approval",
      "checking",
      "repairing",
      "cancelling",
    ].includes(job.phase);
  const changes =
    state.changeStory?.reviewId === job?.reviewId
      ? state.changeStory
      : undefined;
  useEffect(() => {
    setPart(null);
    setSelectedFile(null);
    setSelectedBlock(null);
  }, [story?.revision]);
  const execute = async (work: () => Promise<unknown>) => {
    setError("");
    setWorking(true);
    try {
      await work();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setWorking(false);
    }
  };
  useEffect(() => {
    host.setState({
      ...((host.getState() ?? {}) as object),
      projectKey: state.projectKey,
      readerDrafts: drafts,
    });
  }, [drafts, state.projectKey]);
  useEffect(() => {
    setReviewed(false);
    setAcceptUnknown(false);
    setAcceptScope(false);
    setAcceptTests(false);
  }, [job?.reviewId]);
  useEffect(() => {
    if (
      job?.phase === "review" &&
      job.reviewId &&
      !changes &&
      !state.changeStoryBusy &&
      compareAttempt.current !== job.reviewId
    ) {
      compareAttempt.current = job.reviewId;
      void execute(() => request("explainChanges", { reviewId: job.reviewId }));
    }
  }, [job?.phase, job?.reviewId, changes, state.changeStoryBusy]);
  const read = () =>
    execute(() =>
      request("explainProject", {
        projectKey: state.projectKey,
        revision: graph?.revision,
      }),
    );
  const readFile = (path: string) =>
    execute(() =>
      request("readFile", {
        projectKey: state.projectKey,
        revision: graph?.revision,
        path,
      }),
    );
  const editBlock = (block: CodeBlock, suggested?: string) => {
    if (!reading || !readingCurrent) return;
    setSelectedBlock({
      path: reading.path,
      sourceHash: reading.sourceHash,
      startLine: block.startLine,
    });
    if (suggested) {
      const key = `${reading.path}#${reading.sourceHash}:${block.startLine}`;
      setDrafts((current) => ({ ...current, [key]: suggested }));
    }
    requestAnimationFrame(() => {
      wantedInput.current?.scrollIntoView({ block: "center" });
      wantedInput.current?.focus();
    });
  };
  const implement = () =>
    execute(async () => {
      if (!graph || !state.execution || !current)
        throw Error("현재 코드를 먼저 읽어 주세요.");
      if (block && !readingCurrent)
        throw Error("선택한 코드의 설명을 새로 읽은 뒤 수정해 주세요.");
      const paths = file ? [file.path] : selected?.paths;
      const targetIds = paths
        ? graph.nodes
            .filter(
              (node) =>
                node.kind === "file" &&
                node.sources.some((source) => paths.includes(source.path)),
            )
            .map((node) => node.id)
        : ["system"];
      if (!targetIds.length || targetIds.length > 100)
        throw Error("수정할 부분을 더 작게 선택해 주세요.");
      let spec = specForTargets(state.specs, graph, targetIds);
      if (
        spec.revision > 0 &&
        observeSpec(spec, graph).status !== "unchanged"
      ) {
        spec = await request<LivingSpec>("acceptBaseline", {
          specId: spec.id,
          expectedRevision: spec.revision,
          expectedGraphRevision: graph.revision,
          targetIds,
        });
      }
      await request("implement", {
        projectKey: state.projectKey,
        targetIds,
        specId: spec.revision > 0 ? spec.id : undefined,
        expectedRevision: spec.revision,
        content: {
          ...spec.content,
          title: title.slice(0, 160),
          purpose:
            block && reading
              ? `${file?.summary ?? ""}\n${readingChangeContext(reading, block)}`
              : (file?.summary ?? selected?.summary ?? story?.summary ?? ""),
          desired: wanted,
          acceptance: [wanted.slice(0, 2000)],
        },
        execution: {
          context: state.execution.context,
          checks: state.checks,
          profileRevision: state.execution.profile.revision,
          allowExternal: true,
        },
        ...(block && reading
          ? {
              readingAnchor: {
                path: reading.path,
                revision: reading.revision,
                sourceHash: reading.sourceHash,
                startLine: block.startLine,
                endLine: block.endLine,
              },
            }
          : {}),
      });
    });
  const apply = () =>
    execute(async () => {
      if (!job?.assessment || !reviewed || !acceptUnknown || !changes)
        throw Error("변경 내용을 먼저 확인해 주세요.");
      await request("reviewJob", {
        jobId: job.id,
        reviewId: job.reviewId,
        approvedScopePaths: acceptScope
          ? job.assessment.files
              .filter((file) => file.outsideScope)
              .map((file) => file.path)
          : [],
        reviewedVerificationPaths: acceptTests
          ? job.assessment.files
              .filter((file) => file.verification)
              .map((file) => file.path)
          : [],
        acceptUnverified: acceptUnknown,
        criteria: job.assessment.criteria.map((criterion) => ({
          id: criterion.id,
          outcome: "unverified",
          note: "한국어 변경 내용을 확인했습니다. 실제 동작의 모든 경우를 직접 확인한 것은 아닙니다.",
          checkNames: [],
        })),
      });
      await request("applyJob", { reviewId: job.reviewId });
      setWanted("");
    });
  const outside =
    job?.assessment?.files.filter((file) => file.outsideScope) ?? [];
  const testChanges =
    job?.assessment?.files.filter((file) => file.verification) ?? [];
  const checksPassed =
    !!job?.checks.length &&
    job.checks.every((check) => check.status === "passed");
  const problem = error || state.storyError || state.error;
  return (
    <main className="project-reader">
      <header className="pr-header">
        <div>
          <span className="pr-brand">풀어봄</span>
          <span className="pr-project">
            {state.projectName || "내 프로젝트"}
          </span>
        </div>
        <button onClick={onAdvanced}>구조와 고급 도구</button>
        <button
          className="pr-link"
          disabled={busy}
          onClick={() => void execute(() => request("refresh"))}
        >
          새로 읽기
        </button>
      </header>
      <nav className="pr-journey" aria-label="사용 순서">
        <span>1 이해하기</span>
        <span>2 원하는 모습 적기</span>
        <span>3 비교하고 반영하기</span>
      </nav>
      {!state.trusted && (
        <p className="pr-notice">
          현재는 읽기 전용 상태입니다. VS Code에서 이 프로젝트를 신뢰한 뒤 AI
          연결과 수정을 사용할 수 있습니다.
        </p>
      )}
      {problem && (
        <div className="pr-error" role="alert">
          {readableError(problem)}
          {readableError(problem) !== problem && (
            <details>
              <summary>문제의 자세한 내용</summary>
              <pre>{problem}</pre>
            </details>
          )}
        </div>
      )}
      {!story && !state.storyProgress && (
        <section className="pr-intro">
          <span className="pr-eyebrow">
            코드를 몰라도, 내 프로그램을 이해하도록
          </span>
          <h1>
            이 프로젝트는
            <br />
            어떻게 움직일까요?
          </h1>
          <p>
            각 코드의 역할과 읽는 순서,
            <br />
            바꿀 수 있는 부분을 쉬운 말로 살펴보세요.
          </p>
          <button
            className="pr-primary"
            disabled={!state.trusted || !graph || busy || state.busy}
            onClick={() => void read()}
          >
            내 코드를 쉬운 말로 읽기
          </button>
          <p className="pr-caption">
            연결된 Codex 계정으로 프로젝트의 코드와 문서를 읽습니다. 첫 읽기는
            파일 수에 따라 시간이 걸립니다.
          </p>
        </section>
      )}
      {state.storyProgress && (
        <section className="pr-progress" role="status">
          <strong>{state.storyProgress.message}</strong>
          <progress
            max={state.storyProgress.total || 1}
            value={state.storyProgress.completed}
          />
          <button onClick={() => void request("cancelExplanation")}>
            읽기 멈추기
          </button>
        </section>
      )}
      {story && (
        <>
          <section className="pr-overview">
            <span className="pr-eyebrow">한눈에 이해하기</span>
            <h1>{story.title}</h1>
            <p className="pr-lead">{story.summary}</p>
            <p className="pr-caption">
              {story.sourceFileCount}개 파일의 본문을 읽어 작성 · AI 해석 · 실행
              결과와 다를 수 있어요
            </p>
            {!current && (
              <div className="pr-notice">
                코드가 바뀌어 이전 설명을 보고 있습니다.{" "}
                <button disabled={busy} onClick={() => void read()}>
                  바뀐 내용 읽기
                </button>
              </div>
            )}
            <details>
              <summary>전체 동작 흐름 보기</summary>
              <ol className="pr-flow">
                {story.flow.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ol>
            </details>
          </section>
          <section className="pr-explore">
            <div className="pr-section-title">
              <h2>궁금한 내용을 골라 읽어보세요</h2>
              {selected && (
                <button
                  className="pr-link"
                  onClick={() => {
                    setPart(null);
                    setSelectedFile(null);
                    setSelectedBlock(null);
                  }}
                >
                  전체로 돌아가기
                </button>
              )}
            </div>
            <div className="pr-part-tabs">
              {story.parts.map((item, i) => (
                <button
                  key={item.title + i}
                  className={part === i ? "pr-part selected" : "pr-part"}
                  aria-pressed={part === i}
                  onClick={() => {
                    setPart(part === i ? null : i);
                    setSelectedFile(null);
                    setSelectedBlock(null);
                  }}
                >
                  <strong>{item.title}</strong>
                </button>
              ))}
            </div>
            <label className="pr-search-label" htmlFor="pr-search">
              읽고 싶은 내용 찾기
            </label>
            <input
              id="pr-search"
              className="pr-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="예: 배송비, 로그인, 저장"
              type="search"
            />
            <div className="pr-file-list" aria-label="코드별 설명">
              {files
                .filter((item) =>
                  `${item.title} ${item.summary} ${item.path}`
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase().trim()),
                )
                .map((item) => (
                  <button
                    key={item.path}
                    className="pr-file-choice"
                    aria-pressed={item.path === file?.path}
                    disabled={busy}
                    onClick={() => {
                      setSelectedFile(item.path);
                      setSelectedBlock(null);
                      if (
                        current &&
                        !(
                          state.fileReading?.path === item.path &&
                          state.fileReading.revision === graph?.revision
                        )
                      )
                        void readFile(item.path);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.summary}</span>
                    <small>{item.path}</small>
                  </button>
                ))}
              {!files.some((item) =>
                `${item.title} ${item.summary} ${item.path}`
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase().trim()),
              ) && (
                <p role="status">
                  일치하는 설명이 없습니다. 다른 말로 찾아보세요.
                </p>
              )}
            </div>
            {file && (
              <section
                className="pr-file-detail"
                aria-label={`${file.title}의 코드 해석`}
              >
                <header>
                  <h2>{file.title}</h2>
                  <p>{file.summary}</p>
                </header>
                {state.fileReadingProgress?.path === file.path && (
                  <div className="pr-progress" role="status">
                    <strong>{state.fileReadingProgress.message}</strong>
                    <progress
                      max={state.fileReadingProgress.total || 1}
                      value={state.fileReadingProgress.completed}
                    />
                    <button onClick={() => void request("cancelExplanation")}>
                      읽기 멈추기
                    </button>
                  </div>
                )}
                {state.fileReadingError?.path === file.path && (
                  <p className="pr-error" role="alert">
                    {readableError(state.fileReadingError.message)}
                  </p>
                )}
                {reading ? (
                  <CodeReading
                    key={`${reading.path}:${reading.sourceHash}`}
                    reading={reading}
                    current={readingCurrent}
                    disabled={busy}
                    onEdit={editBlock}
                  />
                ) : (
                  !state.fileReadingProgress && (
                    <p>
                      이 코드의 모든 부분을 읽어 역할·동작·수정 방법을
                      연결합니다.
                    </p>
                  )
                )}
                {(!readingCurrent ||
                  state.fileReadingError?.path === file.path) &&
                  !state.fileReadingProgress && (
                    <button
                      disabled={busy || !current || !state.trusted}
                      onClick={() => void readFile(file.path)}
                    >
                      코드 내용 차근차근 읽기
                    </button>
                  )}
              </section>
            )}
            {!!story.unknowns.length && (
              <details className="pr-unknown">
                <summary>
                  아직 확실하지 않은 내용 {story.unknowns.length}개
                </summary>
                <ul>
                  {story.unknowns.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <section className="pr-edit">
            <span className="pr-eyebrow">원하는 모습 적기</span>
            <h2>{title}에서 무엇을 바꿀까요?</h2>
            {block && (
              <p className="pr-caption">
                위에서 읽은 ‘{block.title}’의 코드와 설명이 요청에 함께
                연결됩니다.{" "}
                <button
                  className="pr-link"
                  disabled={active}
                  onClick={() => setSelectedBlock(null)}
                >
                  이 파일 전체로 바꾸기
                </button>
              </p>
            )}
            <label htmlFor="pr-wanted">
              원하는 결과를 평소 쓰는 말로 적어 주세요. 준비된 요청도 자유롭게
              고칠 수 있어요.
            </label>
            <textarea
              id="pr-wanted"
              ref={wantedInput}
              value={wanted}
              maxLength={12000}
              disabled={active}
              onChange={(event) => setWanted(event.target.value)}
              placeholder="예: 읽기만 가능한 사람은 수정할 수 없게 하고, 이유를 화면에 알려 줘. 권한을 확인하는 규칙은 한곳에서 관리해 줘."
              rows={4}
            />
            <div className="pr-edit-footer">
              <p>
                원본은 그대로 둔 채 변경안을 만듭니다. 준비된 검사{" "}
                {state.checks?.length ?? 0}개도 실행합니다.
              </p>
              <button
                className="pr-primary"
                disabled={
                  !current ||
                  (!!block && !readingCurrent) ||
                  !state.trusted ||
                  busy ||
                  !wanted.trim() ||
                  !state.checks?.length
                }
                onClick={() => void implement()}
              >
                변경안 만들기
              </button>
            </div>
            {!state.checks?.length && (
              <p className="pr-notice">
                이 프로젝트에는 실행 가능한 검사 명령이 없어 코드 반영을 준비할
                수 없습니다. 설명과 탐색은 사용할 수 있습니다.
              </p>
            )}
            <details>
              <summary>실행할 검사와 연결 정보</summary>
              <p>
                Codex 계정으로 필요한 코드가 전달됩니다.{" "}
                {state.execution?.context.model || "Codex 기본 모델"}
              </p>
              <ul>
                {state.checks?.map((name) => (
                  <li key={name}>
                    <strong>{name}</strong>:{" "}
                    {state.execution?.context.scripts[name]}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </>
      )}
      {job && (
        <section className="pr-job" aria-label="변경 작업">
          <span className="pr-eyebrow">비교하고 반영하기</span>
          <h2>{phaseLabel(job.phase)}</h2>
          <p>
            {
              state.specs.specs.find((spec) => spec.id === job.specId)?.content
                .desired
            }
          </p>
          {active && (
            <p role="status">
              변경안을 만들고 확인하고 있습니다. 이 화면을 닫아도 작업 기록이
              남습니다.
            </p>
          )}
          {job.approvals.map((approval) => (
            <div key={approval.id} className="pr-notice">
              <p>
                {approval.kind === "file"
                  ? "작업 복사본의 코드를 수정하려고 합니다."
                  : "변경안을 확인하는 명령을 실행하려고 합니다."}
              </p>
              <p>{approval.reason}</p>
              <details>
                <summary>요청 내용 보기</summary>
                <pre>{approval.command || approval.cwd}</pre>
              </details>
              <button
                disabled={working}
                onClick={() =>
                  void execute(() =>
                    request("decideJob", {
                      jobId: job.id,
                      id: approval.id,
                      decision: "accept",
                    }),
                  )
                }
              >
                이번 요청 허용
              </button>{" "}
              <button
                disabled={working}
                onClick={() =>
                  void execute(() =>
                    request("decideJob", {
                      jobId: job.id,
                      id: approval.id,
                      decision: "decline",
                    }),
                  )
                }
              >
                허용하지 않기
              </button>
            </div>
          ))}
          {active && (
            <button
              disabled={working}
              onClick={() =>
                void execute(() => request("cancelJob", { jobId: job.id }))
              }
            >
              작업 멈추기
            </button>
          )}
          {state.changeStoryBusy && (
            <p role="status">실제 바뀐 코드를 한국어로 비교하고 있습니다…</p>
          )}
          {job.phase === "review" && !changes && !state.changeStoryBusy && (
            <button
              disabled={working}
              onClick={() =>
                void execute(() =>
                  request("explainChanges", { reviewId: job.reviewId }),
                )
              }
            >
              변경 전후를 한국어로 읽기
            </button>
          )}
          {changes && (
            <div className="pr-comparisons">
              {changes.changes.map((row, index) => (
                <article key={row.path}>
                  <h3>{row.title}</h3>
                  <div className="pr-before-after">
                    <div>
                      <span>변경 전</span>
                      <p>{row.before}</p>
                    </div>
                    <div>
                      <span>변경 후</span>
                      <p>{row.after}</p>
                    </div>
                  </div>
                  {row.caution && <p className="pr-caption">{row.caution}</p>}
                  <details>
                    <summary>코드 근거 보기</summary>
                    <small>{row.path}</small>
                    <pre>{row.beforeQuote}</pre>
                    <pre>{row.afterQuote}</pre>
                    <button
                      onClick={() =>
                        void execute(() =>
                          request("jobDiff", {
                            reviewId: job.reviewId,
                            index: job.files.findIndex(
                              (file) => file.path === row.path,
                            ),
                          }),
                        )
                      }
                    >
                      실제 코드 비교 열기
                    </button>
                  </details>
                </article>
              ))}
            </div>
          )}
          {!!job.checks.length && (
            <div className="pr-checks">
              <h3>검사 결과</h3>
              {job.checks.map((check) => (
                <details key={check.name}>
                  <summary>
                    {check.status === "passed" ? "✓ 통과" : "! 확인 필요"} ·{" "}
                    {check.name}
                  </summary>
                  <pre>{check.output}</pre>
                </details>
              ))}
              <p className="pr-caption">
                검사 통과는 모든 상황에서 원하는 동작을 보장한다는 뜻은
                아닙니다.
              </p>
            </div>
          )}
          {job.phase === "review" && changes && (
            <div className="pr-confirm">
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                위의 변경 전후를 읽었습니다.
              </label>
              {!!outside.length && (
                <label>
                  <input
                    type="checkbox"
                    checked={acceptScope}
                    onChange={(e) => setAcceptScope(e.target.checked)}
                  />{" "}
                  연결된 다른 부분 {outside.length}개도 함께 바꾸는 것을
                  확인했습니다.
                  <small>{outside.map((file) => file.path).join(", ")}</small>
                </label>
              )}
              {!!testChanges.length && (
                <label>
                  <input
                    type="checkbox"
                    checked={acceptTests}
                    onChange={(e) => setAcceptTests(e.target.checked)}
                  />{" "}
                  검사 방법의 변경 {testChanges.length}개를 확인했습니다.
                  <small>
                    {testChanges.map((file) => file.path).join(", ")}
                  </small>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={acceptUnknown}
                  onChange={(e) => setAcceptUnknown(e.target.checked)}
                />{" "}
                자동 검사 외에 실제 화면의 모든 경우를 확인한 것은 아니라는 점을
                이해했습니다.
              </label>
              <button
                className="pr-primary"
                disabled={
                  working ||
                  !checksPassed ||
                  !reviewed ||
                  !acceptUnknown ||
                  (!!outside.length && !acceptScope) ||
                  (!!testChanges.length && !acceptTests)
                }
                onClick={() => void apply()}
              >
                내 프로젝트에 반영하기
              </button>
              {!checksPassed && (
                <p className="pr-error">
                  검사가 통과하지 않아 반영할 수 없습니다.
                </p>
              )}
            </div>
          )}
          {job.phase === "applied" && (
            <div className="pr-success">
              <p>실제 프로젝트 코드에 반영했습니다.</p>
              <button disabled={busy} onClick={() => void read()}>
                바뀐 프로젝트 읽기
              </button>{" "}
              <button
                disabled={working}
                onClick={() =>
                  void execute(() =>
                    request("undoJob", { reviewId: job.reviewId }),
                  )
                }
              >
                이번 변경 되돌리기
              </button>
            </div>
          )}
          {job.phase === "undone" && (
            <p className="pr-success">이번 변경을 되돌렸습니다.</p>
          )}
          <details>
            <summary>작업 기록 자세히</summary>
            <pre>{job.message}</pre>
            <ul>
              {job.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <footer>
        <details>
          <summary>연결과 더 많은 도구</summary>
          <p>
            {state.connection?.message ||
              "설명이나 변경안을 만들 때 Codex 연결을 확인합니다."}
          </p>
          <button
            disabled={busy || !state.execution || !state.trusted}
            onClick={() =>
              void execute(() =>
                request("checkConnection", state.execution!.context),
              )
            }
          >
            AI 연결 확인
          </button>{" "}
          <button onClick={() => void request("executionSettings")}>
            연결 설정
          </button>
          {!!state.notices.length && (
            <ul>
              {state.notices.map((notice, index) => (
                <li key={index}>{notice}</li>
              ))}
            </ul>
          )}
          {!!state.jobHistory?.length && (
            <details>
              <summary>이전 변경 작업</summary>
              {state.jobHistory.map((entry) => (
                <button
                  key={entry.id}
                  disabled={active}
                  onClick={() =>
                    void execute(() =>
                      request("restoreJob", { workspaceId: entry.workspaceId }),
                    )
                  }
                >
                  {new Date(entry.startedAt).toLocaleString("ko-KR")} ·{" "}
                  {phaseLabel(entry.phase)}
                </button>
              ))}
            </details>
          )}
        </details>
      </footer>
    </main>
  );
}
function readableError(value: string) {
  if (
    /invalid_type|JSON|ZodError|Unexpected token|expected.*received/i.test(
      value,
    )
  )
    return "AI가 설명을 완성된 형태로 보내지 못했어요. 다시 읽어 주세요.";
  if (/ENOENT|spawn|not found|not recognized/i.test(value))
    return "필요한 실행 프로그램을 찾지 못했어요. 아래 연결 설정에서 설치된 프로그램을 확인해 주세요.";
  if (/timeout|timed out|제한 시간|응답 시간/i.test(value))
    return "요청 시간이 길어져 멈췄어요. 다시 요청하면 완료된 설명은 재사용합니다.";
  if (!/[가-힣]/.test(value))
    return "이번 요청을 마치지 못했어요. 자세한 내용을 확인하고 다시 시도해 주세요.";
  return value.replace(/^Error: /, "");
}
function phaseLabel(phase: string) {
  return (
    (
      {
        preparing: "변경 준비 중",
        running: "원하는 모습으로 수정 중",
        approval: "실행 확인이 필요해요",
        checking: "변경안 검사 중",
        repairing: "발견된 문제 수정 중",
        review: "무엇이 달라지는지 확인하세요",
        applying: "프로젝트에 반영 중",
        applied: "반영했습니다",
        undone: "되돌렸습니다",
        failed: "작업을 마치지 못했어요",
        cancelled: "작업을 멈췄습니다",
        cancelling: "멈추는 중",
        interrupted: "작업 연결이 끊겼어요",
        recovery: "반영 상태를 확인해야 해요",
      } as Record<string, string>
    )[phase] || phase
  );
}
