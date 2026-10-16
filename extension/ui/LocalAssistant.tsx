import { useEffect, useRef, useState } from "react";
import type { Lang, Words } from "../../src/core/types";
import {
  assistantLanguages,
  assistantLimits,
  type AssistantTask,
} from "../../src/core/localAssistant";
import type { AssistantResult } from "../src/localAssistantController";
import type { LocalModel } from "../src/ollama";
import type { ViewState } from "../src/protocol";
import { request } from "./bridge";
import "./local-assistant.css";

export function LocalAssistant({
  state,
  lang,
}: {
  state: ViewState;
  lang: Lang;
}) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [model, setModel] = useState("");
  const [origin, setOrigin] = useState("");
  const [task, setTask] = useState<AssistantTask>("explain");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Words>();
  const [generated, setGenerated] = useState<{
    context: string;
    lang: Lang;
    result: AssistantResult;
  }>();
  const [reviewed, setReviewed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const mounted = useRef(true),
    operation = useRef(false),
    output = useRef<HTMLElement>(null);
  const activeContext = useRef(state.contextId);
  activeContext.current = state.contextId;
  const activeLanguage = useRef(lang);
  activeLanguage.current = lang;
  const result =
    generated?.context === state.contextId && generated.lang === lang
      ? generated.result
      : undefined;
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      void request("localCancel").catch(() => {});
    },
    [lang],
  );
  useEffect(() => {
    if (result) output.current?.focus();
  }, [result]);
  async function run(job: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setNotice(undefined);
    const context = state.contextId;
    try {
      await job();
    } catch (e) {
      if (
        mounted.current &&
        activeContext.current === context &&
        activeLanguage.current === lang
      )
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const eligible =
    state.trusted &&
    !state.busy &&
    !!state.language &&
    Object.hasOwn(assistantLanguages, state.language) &&
    (state.sourceBytes ?? Infinity) <= assistantLimits.sourceBytes;
  function clearProposal() {
    setGenerated(undefined);
    setReviewed(false);
    setAcknowledged(false);
  }
  return (
    <section className="local-assistant">
      <div className="card">
        <h2>
          {t("내 PC의 AI로 읽고 고치기", "Read and change with local AI")}
        </h2>
        <p>
          {t(
            "현재 파일 하나와 아래 요청만 선택한 로컬 모델로 보냅니다. 모델의 추론은 틀릴 수 있어 원문 근거와 변경안을 함께 확인합니다.",
            "Only the current file and your request go to the selected local model. Review source evidence and changes because model reasoning can be wrong.",
          )}
        </p>
        <p className="muted">
          {state.path} ·{" "}
          {assistantLanguages[state.language || ""] || state.language} ·{" "}
          {state.sourceBytes ?? 0} bytes / 24,000
        </p>
        <details className="local-setup">
          <summary>
            {t("처음 사용: Ollama 준비하기", "First use: prepare Ollama")}
          </summary>
          <p>
            {t(
              "Ollama와 원하는 로컬 코드 모델을 설치하세요. 설치·모델 다운로드에는 인터넷과 저장 공간이 필요합니다. 로컬 추론에는 API 키가 필요 없으며, 속도는 PC와 모델에 따라 달라집니다.",
              "Install Ollama and a local code model. Installation and model downloads need internet and storage. Local inference needs no API key; speed depends on your PC and model.",
            )}
          </p>
          <p>
            {t(
              "실행 중인 Ollama를 종료한 뒤, 터미널에서 클라우드 기능을 끄고 시작하세요.",
              "Quit any running Ollama server, then start with cloud features disabled.",
            )}
          </p>
          <pre>{`# Windows PowerShell\n$env:OLLAMA_NO_CLOUD="1"\nollama serve\n\n# macOS / Linux\nOLLAMA_NO_CLOUD=1 ollama serve`}</pre>
          <p>
            {t(
              "다른 터미널에서 예시 모델을 내려받을 수 있습니다. 모델별 라이선스를 확인하세요.",
              "You can download an example model in another terminal. Check the model's license.",
            )}
          </p>
          <pre>ollama pull qwen2.5-coder:3b</pre>
          <p>
            {t(
              "별도 포트는 VS Code의 Pureobom: Ollama Port 설정에서 지정합니다. 원격 VS Code 연결은 아직 지원하지 않습니다. 모델 설치나 설정 변경을 자동 실행하지 않습니다.",
              "Set a custom port in VS Code's Pureobom: Ollama Port setting. Remote VS Code is not supported yet. This panel does not install models or change server settings automatically.",
            )}
          </p>
        </details>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              clearProposal();
              const next = await request<{
                origin: string;
                models: LocalModel[];
              }>("localModels");
              if (!mounted.current) return;
              setModels(next.models);
              setOrigin(next.origin);
              setModel(next.models[0]?.name || "");
              setNotice(
                next.models.length
                  ? {
                      ko: "로컬 전용 설정을 확인했습니다.",
                      en: "Local-only mode confirmed.",
                    }
                  : {
                      ko: "설치된 로컬 텍스트 모델이 없습니다.",
                      en: "No installed local text model found.",
                    },
              );
            })
          }
        >
          {t("Ollama 연결 확인", "Connect to Ollama")}
        </button>
        {origin ? <p className="muted">{origin}</p> : null}
        {models.length ? (
          <label>
            {t("사용할 로컬 모델", "Local model")}
            <select
              value={model}
              disabled={busy}
              onChange={(e) => {
                setModel(e.target.value);
                clearProposal();
              }}
            >
              {models.map((m) => (
                <option key={m.digest + m.name} value={m.name}>
                  {m.name} · {(m.size / 1e9).toFixed(1)} GB
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          {t("하고 싶은 작업", "Task")}
          <select
            value={task}
            disabled={busy}
            onChange={(e) => {
              setTask(e.target.value as AssistantTask);
              clearProposal();
            }}
          >
            <option value="explain">
              {t("쉬운 말로 설명", "Explain in plain language")}
            </option>
            <option value="edit">
              {t("요청한 내용으로 수정 제안", "Propose a requested change")}
            </option>
            <option value="optimize">
              {t("최적화 제안과 확인할 점", "Suggest optimization and checks")}
            </option>
          </select>
        </label>
        <label>
          {t(
            "요청 (설명은 비워도 됩니다)",
            "Request (optional for explanation)",
          )}
          <textarea
            rows={3}
            value={instruction}
            maxLength={2000}
            disabled={busy}
            onChange={(e) => {
              setInstruction(e.target.value);
              clearProposal();
            }}
            placeholder={t(
              "예: 배송비 기준을 바꾸고 영향을 설명해 줘",
              "Example: change the shipping threshold and explain the effect",
            )}
          />
        </label>
        {state.busy ? (
          <p role="status">
            {t(
              "현재 파일을 다시 읽는 중입니다…",
              "Refreshing the current file…",
            )}
          </p>
        ) : !eligible ? (
          <p className="banner">
            {t(
              "신뢰한 로컬 작업 공간에서 24KB 이하의 지원 파일을 열어 주세요.",
              "Open a supported file up to 24KB in a trusted local workspace.",
            )}
          </p>
        ) : null}
        <div className="local-actions">
          <button
            className="primary"
            disabled={
              busy ||
              !eligible ||
              !model ||
              (task !== "explain" && !instruction.trim())
            }
            onClick={() =>
              void run(async () => {
                clearProposal();
                const response = await request<AssistantResult>(
                  "localGenerate",
                  { model, task, instruction, lang },
                  state.contextId,
                );
                if (
                  mounted.current &&
                  activeContext.current === state.contextId &&
                  activeLanguage.current === lang
                )
                  setGenerated({
                    context: state.contextId,
                    lang,
                    result: response,
                  });
              })
            }
          >
            {t("현재 파일로 요청하기", "Send current file")}
          </button>
          {busy ? (
            <button
              onClick={() =>
                void request("localCancel").catch((e) => setError(e.message))
              }
            >
              {t("취소", "Cancel")}
            </button>
          ) : null}
        </div>
        {busy ? (
          <p role="status">
            {t(
              "로컬 모델이 작업 중입니다. 파일을 바꾸면 요청이 취소됩니다.",
              "Local model is working. Changing the file cancels the request.",
            )}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="banner error">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="banner">
            {notice[lang]}
          </p>
        ) : null}
      </div>
      {generated?.context === state.contextId && generated.lang !== lang ? (
        <p role="status" className="banner">
          {t(
            "이전 응답은 영어로 생성됐습니다. 한국어 설명은 다시 요청해 주세요.",
            "The previous response was generated in Korean. Send a new request for an English explanation.",
          )}
        </p>
      ) : null}
      {result ? (
        <section
          className="card local-result"
          tabIndex={-1}
          ref={output}
          aria-label={t("로컬 AI 결과", "Local AI result")}
        >
          <h2>{t("모델의 설명과 제안", "Model explanation and proposal")}</h2>
          <p className="muted">
            {result.model} · {(result.elapsedMs / 1000).toFixed(1)}s ·{" "}
            {t("추론 결과 · 검토 필요", "Model inference · review required")}
          </p>
          <p className="local-summary">{result.summary}</p>
          <h3>{t("원문에서 확인", "Check against the source")}</h3>
          {result.citations.map((c, i) => (
            <div className="local-citation" key={`${c.start}-${i}`}>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    request(
                      "localSource",
                      { id: result.id, index: i },
                      state.contextId,
                    ),
                  )
                }
              >
                L{c.line}
              </button>
              <p>{c.explanation}</p>
              <pre>{c.quote}</pre>
            </div>
          ))}
          {result.risks.length ? (
            <>
              <h3>{t("주의할 변화", "Tradeoffs and uncertainty")}</h3>
              <ul>
                {result.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
          {result.checks.length ? (
            <>
              <h3>
                {t(
                  "모델이 제안한 확인 항목 · 아직 실행하지 않음",
                  "Suggested checks · not executed",
                )}
              </h3>
              <ul>
                {result.checks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
          {result.edits.length ? (
            <>
              <h3>
                {t("변경 제안", "Proposed changes")} · {result.edits.length}
              </h3>
              <ul>
                {result.edits.map((e, i) => (
                  <li key={i}>{e.reason}</li>
                ))}
              </ul>
              <p
                className={
                  result.validation.status === "syntax-failed"
                    ? "banner error"
                    : "banner"
                }
              >
                {result.validation.detail}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await request(
                      "localPreview",
                      { id: result.id },
                      state.contextId,
                    );
                    if (mounted.current) setReviewed(true);
                  })
                }
              >
                {t("VS Code에서 전체 차이 검토", "Review full diff in VS Code")}
              </button>
              <label className="local-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                {t(
                  "타입·실행 결과·성능은 검증되지 않았음을 확인했습니다.",
                  "I understand types, runtime behavior and performance remain unchecked.",
                )}
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !state.trusted ||
                  !reviewed ||
                  !acknowledged ||
                  result.validation.status === "syntax-failed"
                }
                onClick={() =>
                  void run(async () => {
                    await request(
                      "localApply",
                      { id: result.id, acknowledgeUnchecked: acknowledged },
                      state.contextId,
                    );
                    if (mounted.current) {
                      clearProposal();
                      setNotice({
                        ko: "적용했습니다. 편집기의 실행 취소로 되돌릴 수 있습니다.",
                        en: "Applied. Use editor undo to revert.",
                      });
                    }
                  })
                }
              >
                {t("검토한 변경 적용", "Apply reviewed changes")}
              </button>
              <p className="muted">
                {t(
                  "자동 저장하지 않습니다. 편집기 자동 저장 설정은 그대로 적용됩니다. 최적화 효과는 별도 측정이 필요합니다.",
                  "No explicit save is performed; editor autosave settings still apply. Optimization effects require measurement.",
                )}
              </p>
            </>
          ) : (
            <p>
              {t("코드 변경 제안은 없습니다.", "No code changes proposed.")}
            </p>
          )}
        </section>
      ) : null}
    </section>
  );
}
