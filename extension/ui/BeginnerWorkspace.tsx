import { useEffect, useRef, useState } from "react";
import type { ViewState, PatchSummary } from "../src/protocol";
import type { AssistantResult } from "../src/localAssistantController";
import type { LocalModel } from "../src/ollama";
import type { Rule } from "../../src/core/types";
import type { ScenarioReport } from "../../src/core/scenarioModel";
import { ScenarioLab } from "../../src/components/ScenarioLab";
import {
  approvalExampleGuide,
  beginnerEditInstruction,
  beginnerExplanationInstruction,
  plainError,
} from "../../src/core/beginnerGuide";
import { request } from "./bridge";
import "./beginner.css";

type Props = {
  state: ViewState;
  advanced: (tab?: "story" | "rules" | "checks" | "map" | "local") => void;
};

export function BeginnerWorkspace({ state, advanced }: Props) {
  const [example, setExample] = useState(false);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<ReturnType<typeof plainError>>();
  const [notice, setNotice] = useState("");
  const [instruction, setInstruction] = useState("");
  const [generated, setGenerated] = useState<{
    context: string;
    draft: number;
    task: string;
    result: AssistantResult;
  }>();
  const [accepted, setAccepted] = useState(false);
  const [rule, setRule] = useState<Rule>();
  const [value, setValue] = useState("");
  const [patch, setPatch] = useState<{
    context: string;
    draft: number;
    result: PatchSummary;
  }>();
  const current = useRef(state.contextId);
  current.current = state.contextId;
  const draft = useRef(0),
    operation = useRef(false),
    mounted = useRef(true);
  const resultRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const explanation =
    generated?.context === state.contextId && generated.task === "explain"
      ? generated.result
      : undefined;
  const proposal =
    generated?.context === state.contextId &&
    generated.task === "edit" &&
    generated.draft === draft.current
      ? generated.result
      : undefined;
  const change =
    patch?.context === state.contextId && patch.draft === draft.current
      ? patch.result
      : undefined;
  const a = state.analysis;
  const editable =
    a?.rules
      .filter((r) => r.scope === "file" && r.type !== "operator")
      .slice(0, 8) ?? [];
  const selectedRule = rule && a?.rules.find((r) => r.id === rule.id);
  const scenarioFn = a?.functions.find((f) => f.simulatable);
  const unavailable = !!busy || state.busy || !a || !state.trusted;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void request("localCancel").catch(() => {});
    };
  }, []);
  useEffect(() => {
    draft.current++;
    setGenerated(undefined);
    setPatch(undefined);
    setRule(undefined);
    setAccepted(false);
    setError(undefined);
  }, [state.contextId]);
  useEffect(() => {
    if (generated || patch) resultRef.current?.focus();
  }, [generated, patch]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const resetDraft = () => {
    draft.current++;
    setPatch(undefined);
    setGenerated((old) => (old?.task === "explain" ? old : undefined));
    setAccepted(false);
    setNotice("");
    setError(undefined);
  };
  async function run(label: string, work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(label);
    setError(undefined);
    setNotice("");
    const context = current.current;
    try {
      await work();
    } catch (e) {
      if (mounted.current && current.current === context)
        setError(plainError(e));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function chooseModel() {
    if (model) return model;
    const connected = await request<{ models: LocalModel[] }>("localModels");
    if (!mounted.current) return "";
    setModels(connected.models);
    if (!connected.models.length) throw Error("사용할 로컬 모델이 없습니다.");
    // Use the smallest installed model for the initial response; settings remain available.
    const chosen = [...connected.models].sort((x, y) => x.size - y.size)[0]
      .name;
    setModel(chosen);
    return chosen;
  }
  async function generate(task: "explain" | "edit") {
    const context = current.current,
      revision = draft.current;
    setGenerated(undefined);
    setPatch(undefined);
    setAccepted(false);
    const selected = await chooseModel();
    if (
      !mounted.current ||
      !selected ||
      context !== current.current ||
      revision !== draft.current
    )
      return;
    const result = await request<AssistantResult>(
      "localGenerate",
      {
        model: selected,
        presentation: "beginner",
        lang: "ko",
        task,
        instruction:
          task === "explain"
            ? beginnerExplanationInstruction
            : beginnerEditInstruction(instruction),
      },
      context,
    );
    if (
      mounted.current &&
      context === current.current &&
      revision === draft.current
    )
      setGenerated({ context, draft: revision, task, result });
  }
  const fallback = !a
    ? "설명할 내용을 열면 여기에서 쉽게 읽을 수 있어요."
    : a.kind === "json"
      ? "프로그램이 참고하는 설정과 값이 들어 있어요. 실제로 어디에 쓰이는지는 사용하는 부분도 함께 확인해야 해요."
      : a.functions.length
        ? `이 부분에는 ${a.functions.length}개의 동작이 있어요. 아래에서 쉬운 설명을 요청하면 하는 일과 조건을 한국어로 정리해 드려요.`
        : "현재 내용에서 구조와 값을 읽었어요. 전체 의미는 쉬운 설명을 요청해 확인할 수 있어요.";

  return (
    <main className="beginner-workspace">
      <header className="beginner-header">
        <div className="beginner-brand">
          <span aria-hidden="true">풀</span>
          <strong>풀어봄</strong>
        </div>
        <button className="beginner-link" onClick={() => advanced()}>
          상세 도구
        </button>
      </header>
      <div className="beginner-context">
        <span>
          {example ? "보내주신 예제 · 직접 검토한 설명" : "지금 열어 둔 내용"}
        </span>
        <button className="beginner-link" onClick={() => setExample(!example)}>
          {example ? "내 내용으로 돌아가기" : "쉬운 설명 예제 보기"}
        </button>
      </div>
      {error && (
        <div
          className="beginner-message"
          role="alert"
          ref={errorRef}
          tabIndex={-1}
        >
          <p>{error.message}</p>
          {/Ollama|local model|모델|connect|연결/i.test(error.technical) && (
            <button onClick={() => advanced("local")}>연결 설정 열기</button>
          )}
          <details>
            <summary>문제의 자세한 내용</summary>
            <p>{error.technical}</p>
          </details>
        </div>
      )}
      {notice && (
        <p className="beginner-message" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <div className="beginner-message" role="status">
          <p>{busy}</p>
          <button
            onClick={() => {
              draft.current++;
              void request("localCancel").catch((e) => setError(plainError(e)));
            }}
          >
            요청 멈추기
          </button>
        </div>
      )}
      {example ? (
        <ExampleReading />
      ) : (
        <>
          {!state.trusted && (
            <p className="beginner-message" role="status">
              지금 VS Code는 읽기 전용 모드예요. 예제 설명은 볼 수 있지만, AI에
              요청하거나 내용을 바꾸는 기능은 사용할 수 없어요.
            </p>
          )}
          <section
            className="beginner-overview"
            ref={!proposal && !change ? resultRef : undefined}
            tabIndex={-1}
            aria-label="쉬운 설명"
          >
            <span className="beginner-kicker">한눈에 이해하기</span>
            <h1>이 부분은 무슨 일을 하나요?</h1>
            <p className="beginner-summary">
              {explanation?.summary || fallback}
            </p>
            {!explanation && (
              <button
                className="beginner-primary"
                disabled={unavailable}
                onClick={() =>
                  void run("내용을 읽고 쉬운 설명을 만들고 있어요…", () =>
                    generate("explain"),
                  )
                }
              >
                한국어로 쉽게 풀어줘
              </button>
            )}
            {!a && (
              <button
                onClick={() =>
                  void run("예제를 열고 있어요…", () => request("example"))
                }
              >
                작은 예제로 시작하기
              </button>
            )}
            {explanation && (
              <>
                <p className="beginner-caption">
                  AI가 풀어 쓴 설명이에요. 중요한 조건은 아래에서 확인하세요.
                </p>
                <details className="beginner-details">
                  <summary>조금 더 자세히 알아보기</summary>
                  <ol className="beginner-steps">
                    {explanation.citations.map((c, index) => (
                      <li key={`${c.start}-${index}`}>
                        <span>{index + 1}</span>
                        <p>{c.explanation}</p>
                      </li>
                    ))}
                  </ol>
                  <details className="beginner-source">
                    <summary>설명의 근거가 된 원본 보기</summary>
                    {explanation.citations.map((c, index) => (
                      <div key={index}>
                        <p>{c.explanation}</p>
                        <pre>{c.quote}</pre>
                      </div>
                    ))}
                  </details>
                </details>
                <button
                  className="beginner-link"
                  disabled={unavailable}
                  onClick={() =>
                    void run("최신 내용으로 다시 설명하고 있어요…", () =>
                      generate("explain"),
                    )
                  }
                >
                  다시 설명하기
                </button>
              </>
            )}
          </section>

          <section className="beginner-change" aria-label="원하는 동작 바꾸기">
            <span className="beginner-kicker">내가 원하는 동작으로</span>
            <h2>어떻게 바꾸고 싶으세요?</h2>
            <label htmlFor="beginner-request">
              원하는 결과를 평소 말하듯 적어 주세요.
            </label>
            <textarea
              id="beginner-request"
              value={instruction}
              maxLength={1600}
              rows={3}
              placeholder="예: 보기 전용 사용자는 수정하지 못하게 하고, 이유를 화면에 알려줘."
              onChange={(e) => {
                resetDraft();
                setInstruction(e.target.value);
              }}
            />
            <div className="beginner-action-row">
              <button
                className="beginner-primary"
                disabled={unavailable || !instruction.trim()}
                onClick={() =>
                  void run("요청한 변경안을 만들고 있어요…", () =>
                    generate("edit"),
                  )
                }
              >
                변경안 만들어줘
              </button>
              <small>검토하고 적용하기 전까지 원본은 그대로예요.</small>
            </div>
            <p className="beginner-caption">
              지금 열어 둔 내용 하나를 바꿉니다. 여러 부분에 걸친 시스템 변경은
              아직 이 화면에서 처리하지 않아요.
            </p>
          </section>

          {!!editable.length && (
            <details className="beginner-details">
              <summary>숫자나 문구만 바로 바꾸고 싶어요</summary>
              <div className="beginner-values">
                {editable.map((r) => (
                  <button
                    key={r.id}
                    aria-pressed={selectedRule?.id === r.id}
                    disabled={!!busy}
                    onClick={() => {
                      resetDraft();
                      setRule(r);
                      setValue(String(r.value));
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    <span>{r.label.ko}</span>
                    <strong>{String(r.value)}</strong>
                  </button>
                ))}
              </div>
              {selectedRule && (
                <div className="beginner-value-editor">
                  <label htmlFor="beginner-value">
                    {selectedRule.label.ko} — 새 값
                  </label>
                  <input
                    id="beginner-value"
                    ref={inputRef}
                    value={value}
                    onChange={(e) => {
                      resetDraft();
                      setValue(e.target.value);
                    }}
                  />
                  <button
                    disabled={
                      unavailable || value === String(selectedRule.value)
                    }
                    onClick={() =>
                      void run("바뀌는 내용을 확인하고 있어요…", async () => {
                        const context = current.current,
                          revision = draft.current;
                        const result = await request<PatchSummary>(
                          "prepare",
                          { ruleId: selectedRule.id, value },
                          context,
                        );
                        if (
                          mounted.current &&
                          context === current.current &&
                          revision === draft.current
                        )
                          setPatch({ context, draft: revision, result });
                      })
                    }
                  >
                    바뀌는 내용 보기
                  </button>
                </div>
              )}
            </details>
          )}

          {change && (
            <section
              className="beginner-review"
              ref={resultRef}
              tabIndex={-1}
              aria-label="값 변경안"
            >
              <span className="beginner-kicker">아직 적용하지 않았어요</span>
              <h2>이렇게 달라져요</h2>
              <p>{change.description.ko}</p>
              <div className="beginner-before-after">
                <div>
                  <small>지금</small>
                  <p>{change.oldText}</p>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>바꾸면</small>
                  <p>{change.newText}</p>
                </div>
              </div>
              {scenarioFn && (
                <details>
                  <summary>예시 결과도 비교해 볼까요?</summary>
                  <ScenarioLab
                    fn={scenarioFn}
                    rules={a!.rules}
                    lang="ko"
                    revision={`${state.contextId}:${change.id}`}
                    change={change}
                    disabled={!!busy}
                    hideExport
                    run={(scenarios) =>
                      request<ScenarioReport>(
                        "compare",
                        {
                          name: scenarioFn.name,
                          scenarios,
                          patchId: change.id,
                        },
                        state.contextId,
                      )
                    }
                    exportReport={async () => {}}
                  />
                </details>
              )}
              <button
                className="beginner-primary"
                disabled={unavailable}
                onClick={() =>
                  void run("변경을 적용하고 있어요…", async () => {
                    await request("apply", { id: change.id }, state.contextId);
                    setPatch(undefined);
                    setNotice(
                      "값을 바꿨어요. 편집기에서 Ctrl+Z를 누르면 되돌릴 수 있어요.",
                    );
                  })
                }
              >
                이 값으로 바꾸기
              </button>
            </section>
          )}

          {proposal && (
            <section
              className="beginner-review"
              ref={resultRef}
              tabIndex={-1}
              aria-label="한국어 변경안"
            >
              <span className="beginner-kicker">아직 적용하지 않았어요</span>
              <h2>이렇게 달라져요</h2>
              <p>{proposal.summary}</p>
              <ol>
                {proposal.edits.map((edit, i) => (
                  <li key={i}>{edit.reason}</li>
                ))}
              </ol>
              {!!proposal.risks.length && (
                <>
                  <h3>함께 확인할 점</h3>
                  <ul>
                    {proposal.risks.map((risk, i) => (
                      <li key={i}>{risk}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!proposal.checks.length && (
                <details>
                  <summary>바꾼 뒤 확인할 일</summary>
                  <ul>
                    {proposal.checks.map((check, i) => (
                      <li key={i}>{check}</li>
                    ))}
                  </ul>
                  <p>아직 실행한 검사는 아닙니다.</p>
                </details>
              )}
              <details>
                <summary>바뀌는 원본도 볼래요</summary>
                {proposal.edits.map((edit, i) => (
                  <div key={i}>
                    <p>{edit.reason}</p>
                    <small>지금</small>
                    <pre>{edit.before}</pre>
                    <small>바꾸면</small>
                    <pre>{edit.after}</pre>
                  </div>
                ))}
              </details>
              {proposal.edits.length > 0 && (
                <>
                  <p>
                    {proposal.validation.status === "syntax-failed"
                      ? "문제 있는 변경안이라 적용할 수 없어요. 요청을 고쳐 다시 만들어 주세요."
                      : "실제 앱에서 원하는 대로 동작하는지는 바꾼 뒤 확인해야 해요."}
                  </p>
                  <label className="beginner-consent">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    위 변경 내용을 읽었고, 실제 동작은 적용 후 확인할게요.
                  </label>
                  <button
                    className="beginner-primary"
                    disabled={
                      unavailable ||
                      !accepted ||
                      proposal.validation.status === "syntax-failed"
                    }
                    onClick={() =>
                      void run("검토한 변경을 적용하고 있어요…", async () => {
                        const context = state.contextId;
                        await request(
                          "localReviewSummary",
                          {
                            id: proposal.id,
                            reviewed: true,
                            editCount: proposal.edits.length,
                          },
                          context,
                        );
                        await request(
                          "localApply",
                          { id: proposal.id, acknowledgeUnchecked: true },
                          context,
                        );
                        setGenerated(undefined);
                        setNotice(
                          "변경을 적용했어요. 편집기에서 Ctrl+Z를 누르면 되돌릴 수 있어요. 실제 결과도 확인해 주세요.",
                        );
                      })
                    }
                  >
                    이대로 바꾸기
                  </button>
                </>
              )}
            </section>
          )}

          <details className="beginner-settings">
            <summary>설명 대상과 연결 설정</summary>
            <p>{state.path || "열린 내용이 없어요."}</p>
            <p>
              {state.dirty
                ? "저장하기 전 변경도 포함했어요."
                : "저장된 내용을 읽고 있어요."}
            </p>
            {!state.trusted && (
              <p>현재 작업 공간은 읽기 전용 모드라 변경할 수 없어요.</p>
            )}
            {state.error && <p>{state.error}</p>}
            {!!models.length && (
              <label>
                설명에 사용할 AI
                <select
                  value={model}
                  onChange={(e) => {
                    resetDraft();
                    setGenerated(undefined);
                    setModel(e.target.value);
                  }}
                >
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={() => advanced("local")}>AI 연결 설정</button>
            <button onClick={() => advanced("story")}>
              기존 상세 설명 열기
            </button>
            <button onClick={() => advanced("map")}>파일 연결 살펴보기</button>
          </details>
        </>
      )}
    </main>
  );
}

function ExampleReading() {
  const guide = approvalExampleGuide;
  return (
    <>
      <section className="beginner-overview">
        <span className="beginner-kicker">한눈에 이해하기</span>
        <h1>{guide.title}</h1>
        <p className="beginner-summary">{guide.summary}</p>
        <p className="beginner-caption">
          보내주신 코드를 직접 읽고 정리한 예시예요. 자동 해석 결과나 실행
          결과는 아닙니다.
        </p>
        <details className="beginner-details">
          <summary>조금 더 자세히 알아보기</summary>
          <ol className="beginner-steps">
            {guide.steps.map((step, i) => (
              <li key={step.title}>
                <span>{i + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                  <details>
                    <summary>이 부분을 더 설명해 줘</summary>
                    <p>{step.detail}</p>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        </details>
      </section>
      <section className="beginner-example-changes">
        <h2>승인하면 무엇이 바뀌나요?</h2>
        {guide.changes.map((c) => (
          <div className="beginner-change-row" key={c.topic}>
            <h3>{c.topic}</h3>
            <div className="beginner-before-after">
              <div>
                <small>지금</small>
                <p>{c.before}</p>
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <small>바꾸면</small>
                <p>{c.after}</p>
              </div>
            </div>
          </div>
        ))}
        <p className="beginner-caption">
          이 표는 예제 코드에 적힌 교체 내용을 설명합니다. 지금 프로젝트를
          수정하거나 프로그램을 실행하지 않습니다.
        </p>
      </section>
      <aside className="beginner-note">
        <h3>여기까지 알면 충분해요</h3>
        <p>
          이 프로그램은 스스로 수정 방법을 생각하지 않아요. 정해 둔 내용을
          그대로 바꾸는 시험용 도구예요. 중간에 실패하면 일부 파일만 바뀐 상태로
          남을 수 있어요.
        </p>
      </aside>
    </>
  );
}
