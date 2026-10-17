import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Story } from "../../src/components/Story";
import { MapView } from "../../src/components/MapView";
import { ScenarioLab } from "../../src/components/ScenarioLab";
import { Terminology } from "../../src/components/Terminology";
import { ProductHelp } from "../../src/components/ProductHelp";
import { EditorProblems } from "./EditorProblems";
import { LocalAssistant } from "./LocalAssistant";
import { ProjectChecks } from "./ProjectChecks";
import type { ScenarioReport } from "../../src/core/scenarioModel";
import type { Lang, Rule, Simulation, Words } from "../../src/core/types";
import type { PatchSummary, ViewState } from "../src/protocol";
import { host, request } from "./bridge";
import "./style.css";

type Tab = "story" | "rules" | "checks" | "map" | "local";
function App() {
  const saved = host.getState() as { lang?: Lang } | undefined;
  const [lang, setLang] = useState<Lang>(saved?.lang === "en" ? "en" : "ko");
  const [state, setState] = useState<ViewState>({
    contextId: "",
    path: "",
    version: 0,
    dirty: false,
    trusted: true,
    busy: false,
  });
  const [tab, setTab] = useState<Tab>("story");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Words>();
  const [help, setHelp] = useState(false);
  const [working, setWorking] = useState(false);
  const [edit, setEdit] = useState<Rule>();
  const [value, setValue] = useState("");
  const [sentence, setSentence] = useState("");
  const [patch, setPatch] = useState<PatchSummary>();
  const [fn, setFn] = useState("");
  const [args, setArgs] = useState("[50000]");
  const [simulation, setSimulation] = useState<Simulation>();
  const context = useRef("");
  const editorRef = useRef<HTMLDivElement>(null);
  const patchRef = useRef<HTMLElement>(null);
  const simulationRef = useRef<HTMLElement>(null);
  const ko = lang === "ko",
    a = state.analysis;
  const disabled = working || state.busy || !a;
  const scenarioFn =
    a?.functions.find((f) => f.name === fn) ??
    a?.functions.find((f) => f.simulatable);
  const t = (k: string, e: string) => (ko ? k : e);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.data?.type !== "state") return;
      const next = e.data.state as ViewState;
      if (context.current !== next.contextId) {
        setNotice(undefined);
        setPatch(undefined);
        setEdit(undefined);
        setSimulation(undefined);
        setFn("");
        setError("");
        context.current = next.contextId;
      }
      setState(next);
      if (next.tab === "map") setTab("map");
      if (next.tab === "local") setTab("local");
    };
    window.addEventListener("message", receive);
    void request("ready").catch((e) => setError(e.message));
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    host.setState({ lang });
    document.documentElement.lang = lang;
  }, [lang]);
  async function action(job: () => Promise<void>) {
    setWorking(true);
    setError("");
    setNotice(undefined);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  function selectRule(rule: Rule) {
    setEdit(rule);
    setValue(String(rule.value));
    setPatch(undefined);
    setTab("rules");
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      editorRef.current
        ?.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input, select, textarea")
        ?.focus();
    });
  }
  async function prepare(payload: Record<string, unknown>) {
    const id = context.current;
    const result = await request<PatchSummary>("prepare", payload, id);
    if (id === context.current) {
      setPatch(result);
      requestAnimationFrame(() =>
        patchRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      );
    }
  }
  const source = (line: number) =>
    void action(() => request("source", { line }, state.contextId));
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">풀</span>
          <div>
            <strong>풀어봄</strong>
            <small>
              {t(
                "코드를 이해하는 작업 공간",
                "A workspace for understanding code",
              )}
            </small>
          </div>
        </div>
        <div className="product-links">
          <button onClick={() => setHelp(true)}>
            {t("도움말·피드백", "Help & feedback")}
          </button>
          <select
            aria-label="설명 언어 / Language"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </div>
      </header>
      <section className="file-summary">
        <span className="eyebrow">{t("지금 읽는 파일", "CURRENT FILE")}</span>
        <h1>
          {state.path || t("코드 파일을 열어 주세요", "Open a code file")}
        </h1>
        <div className="meta">
          <span className="pill">
            {state.busy
              ? t("설명 업데이트 중…", "Updating…")
              : !a
                ? t("지원 파일을 기다리는 중", "Waiting for a supported file")
                : a.kind === "text"
                  ? t("문법 기반 설명 미제공", "No built-in syntax explanation")
                  : t("내 컴퓨터에서 분석", "Analyzed locally")}
          </span>
          {state.path && (
            <span>
              {state.dirty
                ? t("저장 전 변경 포함", "Includes unsaved edits")
                : t("저장된 내용", "Saved content")}
            </span>
          )}
          {a?.web ? (
            <span>
              {a.web.nodes} {t("개 원문 항목", "source entries")} ·{" "}
              {a.rules.length} {t("개 수정 가능", "editable values")}
            </span>
          ) : a && a.kind === "json" ? (
            <span>
              {a.data?.fields.length ?? 0} {t("개 데이터 항목", "data entries")}{" "}
              · {a.rules.length} {t("개 수정 가능", "editable values")}
            </span>
          ) : a && a.kind === "script" ? (
            <span>
              {a.functions.length} {t("개 기능", "functions")} ·{" "}
              {a.rules.length} {t("개 규칙", "rules")}
            </span>
          ) : null}
          <button
            disabled={working || state.busy}
            onClick={() => void action(() => request("refresh"))}
          >
            {t("새로 읽기", "Refresh")}
          </button>
        </div>
      </section>
      {!state.trusted && (
        <p className="banner">
          {t(
            "제한 모드: 설명은 읽을 수 있습니다. 코드 변경은 작업 공간을 신뢰한 뒤 가능합니다.",
            "Restricted Mode: read explanations now; edits require a trusted workspace.",
          )}
        </p>
      )}
      {(error || state.error) && (
        <p className="banner error" role="alert">
          {error || state.error}
        </p>
      )}
      {notice && (
        <p className="banner success" role="status">
          {notice[lang]}
        </p>
      )}
      {state.path && state.diagnostics && (
        <button className="diagnostic-summary" onClick={() => setTab("checks")}>
          <span>{t("편집기 알림", "Editor reports")}</span>
          <strong>
            {t("오류", "Errors")} {state.diagnostics.errors} ·{" "}
            {t("경고", "Warnings")} {state.diagnostics.warnings}
          </strong>
          <span>
            {state.diagnostics.status === "edited"
              ? t("코드 변경 후 갱신 대기", "Awaiting reports after edit")
              : t("내용 확인 →", "Review →")}
          </span>
        </button>
      )}
      {!a && !state.busy ? (
        <section className="empty card">
          <h2>
            {t(
              "어려운 코드, 문장으로 읽어 보세요",
              "Read your code as a story",
            )}
          </h2>
          <p>
            {t(
              "JavaScript 또는 TypeScript 파일을 열면 기능, 조건, 바꿀 수 있는 값을 보여 드립니다. JSON 파일도 읽을 수 있습니다.",
              "Open a JavaScript, TypeScript or JSON file to explore its logic and editable values.",
            )}
          </p>
          <button
            className="primary"
            onClick={() => void action(() => request("example"))}
          >
            {t("무료 배송 예제로 시작", "Try the shipping example")}
          </button>
          <p className="muted">
            {t(
              "외부 AI 서비스와 API 키 없이 작동합니다.",
              "No external AI service or API key required.",
            )}
          </p>
        </section>
      ) : (
        <>
          <nav className="tabs" aria-label={t("설명 보기 방식", "Views")}>
            {(
              [
                ["story", "문장으로 읽기", "Story"],
                ["rules", "규칙 바꾸기", "Rules"],
                ["checks", "검토할 부분", "Review"],
                ["map", "연결 지도", "Map"],
                ["local", "로컬 AI", "Local AI"],
              ] as const
            ).map(([key, korean, english]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
              >
                {t(korean, english)}
                {key === "checks" && !!a?.issues.length && (
                  <span className="count">{a.issues.length}</span>
                )}
              </button>
            ))}
          </nav>
          <main aria-busy={state.busy}>
            {state.language === "go" && state.busy ? (
              <p role="status">
                {t(
                  "Go 구문을 읽고 있습니다. 처음 사용할 때는 설치된 Go로 읽기 도구를 준비해 시간이 더 걸릴 수 있습니다.",
                  "Reading Go syntax. The first use may take longer while the installed Go SDK builds the reader.",
                )}
              </p>
            ) : null}
            {state.language === "java" && state.busy ? (
              <p role="status">
                {t(
                  "Java 구문을 읽고 있습니다. 처음 사용할 때는 설치된 JDK로 읽기 도구를 준비합니다.",
                  "Reading Java syntax. The first use prepares the reader with the installed JDK.",
                )}
              </p>
            ) : null}
            {state.pythonNotice || state.goNotice || state.javaNotice ? (
              <section className="card" role="status">
                <p>
                  {state.pythonNotice || state.goNotice || state.javaNotice}
                </p>
                {state.javaNotice ? (
                  <p>
                    {t(
                      "JDK 21 이상을 설치하세요. 필요한 경우 pureobom.analysisJavaHome에 JDK 폴더의 절대 경로를 지정할 수 있습니다. 로컬 데스크톱 작업 공간에서 사용하세요.",
                      "Install JDK 21 or later. Optionally set the absolute JDK directory in pureobom.analysisJavaHome. Use a local desktop workspace.",
                    )}
                  </p>
                ) : null}
                {state.goNotice ? (
                  <p>
                    {t(
                      "Go SDK 설치 후 pureobom.analysisGo 설정에서 실행 파일 경로를 지정할 수 있습니다. 로컬 데스크톱 작업 공간에서 사용하세요.",
                      "Install a Go SDK and optionally set its executable path in pureobom.analysisGo. Use a local desktop workspace.",
                    )}
                  </p>
                ) : null}
              </section>
            ) : null}
            {a && tab === "local" && (
              <>
                <LocalAssistant state={state} lang={lang} />
                <ProjectChecks state={state} lang={lang} />
              </>
            )}
            {a?.kind === "text" && tab !== "local" && (
              <section className="card">
                <p>
                  {state.language === "python" || state.language === "go"
                    ? t(
                        "구문 읽기 도구를 사용할 수 없습니다. 위 안내를 확인하거나 로컬 AI에서 설명을 요청할 수 있습니다.",
                        "The syntax reader is unavailable. Check the notice above or request a local AI explanation.",
                      )
                    : t(
                        "이 언어의 문법 기반 설명은 아직 제공하지 않습니다. 로컬 AI에서 현재 파일의 설명이나 변경을 요청할 수 있습니다.",
                        "Syntax-grounded explanation is not available for this language yet. Local AI can propose explanations and changes for the current file.",
                      )}
                </p>
                <button onClick={() => setTab("local")}>
                  {t("로컬 AI 열기", "Open local AI")}
                </button>
              </section>
            )}
            {a && tab === "story" && (
              <>
                <Terminology
                  key={a.path}
                  terms={a.terms || []}
                  lang={lang}
                  disabled={disabled}
                  onSource={source}
                  onSave={async (symbolId, label) => {
                    await request(
                      "term",
                      { symbolId, label, lang },
                      state.contextId,
                    );
                    setNotice({
                      ko: "내 용어를 설명에 반영했습니다. 원본 코드 이름은 유지됩니다.",
                      en: "Your term is now used in explanations. Source names are unchanged.",
                    });
                  }}
                />
                <Story
                  analysis={a}
                  disabled={disabled}
                  editDisabled={disabled || !state.trusted}
                  lang={lang}
                  onSource={source}
                  onEdit={selectRule}
                  onSqlDialect={(dialect) =>
                    void action(() =>
                      request(
                        "sqlDialect",
                        { dialect: dialect || "" },
                        state.contextId,
                      ),
                    )
                  }
                  onSimulate={(name) => {
                    setFn(name);
                    setSimulation(undefined);
                    setArgs("[]");
                    requestAnimationFrame(() =>
                      simulationRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      }),
                    );
                  }}
                />
              </>
            )}
            {a && tab === "rules" && (
              <>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {t("규칙 바꾸기", "EDIT THE RULES")}
                    </span>
                    <h2>
                      {a.kind === "json"
                        ? t(
                            "원문에 저장된 값을 바꾸세요",
                            "Change a stored value",
                          )
                        : t(
                            "원하는 동작에 맞게 값을 바꾸세요",
                            "Adjust the rules",
                          )}
                    </h2>
                  </div>
                </div>
                <p className="muted">
                  {a.sql
                    ? t(
                        "SQLite 방언을 선택한 파일의 숫자·작은따옴표 문자열을 수정합니다. 아래 표에 표시된 규칙 이름 전체(@위치 포함)를 쓰세요. 데이터베이스 결과·제약·성능은 프로젝트 검사에서 확인해야 합니다.",
                        "Edit numeric and single-quoted string literals after selecting SQLite. Use the full rule name shown in the list below, including @position. Check database results, constraints and performance with project checks.",
                      )
                    : a.web
                      ? t(
                          "일반 HTML 문구·일부 텍스트 속성·CSS 선언 값 하나를 수정합니다. CSS는 단위까지 입력하세요. 화면·접근성·스타일 우선순위는 실제 페이지에서 확인해야 합니다.",
                          "Edit one ordinary HTML text, selected text attribute or CSS declaration value. Include CSS units. Check rendering, accessibility and cascade in the actual page.",
                        )
                      : a.kind === "json"
                        ? t(
                            "문자열·숫자·참거짓 값 하나를 바꿉니다. 주석과 나머지 원문은 유지하며, 실제 적용 방식은 데이터를 읽는 코드에서 확인해야 합니다.",
                            "Change one string, number or boolean. Comments and the rest of the source are preserved; its effect depends on the code that reads the data.",
                          )
                        : a.go
                          ? t(
                              "이름 하나에 대입한 문자열·숫자 리터럴 하나를 수정합니다. 참거짓 이름·룬·식은 대상이 아닙니다. 타입·범위·실제 동작은 프로젝트 검사에서 확인하세요.",
                              "Edit one string or numeric literal assigned to a name. Boolean identifiers, runes and expressions are excluded. Check types, ranges and behavior with project checks.",
                            )
                          : a.python
                            ? t(
                                "이름 하나에 대입한 문자열·숫자·참거짓 값을 수정합니다. 사용처·타입·실제 동작은 별도 검사해야 합니다.",
                                "Edit one string, number or boolean assigned to a name. Its uses, types and actual behavior need separate checks.",
                              )
                            : t(
                                "상수, 문구, 참·거짓과 비교 방식을 수정할 수 있습니다. 자유로운 변경 제안은 로컬 AI 탭에서 요청하세요.",
                                "Edit constants, text, booleans and comparisons. Request broader changes in the local AI tab.",
                              )}
                </p>
                <form
                  className="sentence"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(() => prepare({ request: sentence }));
                  }}
                >
                  <label htmlFor="sentence">
                    {t("문장으로 변경 요청", "Request a change")}
                  </label>
                  <div className="input-row">
                    <input
                      id="sentence"
                      value={sentence}
                      onChange={(e) => setSentence(e.target.value)}
                      placeholder={
                        a.web
                          ? t(
                              "표의 이름 전체와 큰따옴표로 감싼 새 값",
                              "Full table name and a new value in double quotes",
                            )
                          : a.kind === "json"
                            ? t(
                                '예: $["enabled"]를 false로 변경',
                                'Example: change $["enabled"] to false',
                              )
                            : a.python || a.go || a.java || a.sql
                              ? t(
                                  "표의 원문 이름과 새 값을 적어 주세요",
                                  "Use a source name from the table and one new value",
                                )
                              : t(
                                  "무료 배송 기준을 70000으로 변경",
                                  "Change freeShippingThreshold to 70000",
                                )
                      }
                    />
                    <button
                      disabled={
                        disabled ||
                        !state.trusted ||
                        !sentence.trim() ||
                        !a.syntaxValid
                      }
                    >
                      {t("변경안 만들기", "Preview change")}
                    </button>
                  </div>
                  <small>
                    {a.web
                      ? t(
                          '이름 전체(@위치 포함)와 새 값 하나를 적어 주세요. 예: "24px"',
                          'Use the full name including @position and one quoted value, e.g. "24px".',
                        )
                      : a.kind === "json"
                        ? t(
                            "아래 표의 키 경로 전체와 새 값 하나를 적어 주세요.",
                            "Use the full key path from the table and one new value.",
                          )
                        : t(
                            "아래 표의 규칙 이름과 새 값 하나를 적어 주세요. 7만 → 70000, 15% → 0.15",
                            "Use one rule name and one new value. Write 70000 or 0.15 without units.",
                          )}
                  </small>
                </form>
                <div className="table-scroll card">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("규칙", "Rule")}</th>
                        <th>{t("현재 값", "Value")}</th>
                        <th>{t("위치", "Location")}</th>
                        <th>{t("수정", "Edit")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.rules.map((rule) => (
                        <tr key={rule.id}>
                          <td>
                            <strong>{rule.label[lang]}</strong>
                            <small className="mono">{rule.name}</small>
                          </td>
                          <td className="mono">
                            {rule.syntax === "python" || rule.syntax === "go"
                              ? rule.raw
                              : String(rule.value)}
                          </td>
                          <td>
                            <button
                              className="line-link"
                              onClick={() => source(rule.line)}
                            >
                              L{rule.line}
                            </button>
                          </td>
                          <td>
                            <button
                              disabled={
                                disabled || !state.trusted || !a.syntaxValid
                              }
                              onClick={() => selectRule(rule)}
                            >
                              {t("바꾸기", "Edit")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {a.rules.length === 0 && (
                    <p className="empty">
                      {t(
                        "이 파일에서 지원되는 편집 규칙을 찾지 못했습니다.",
                        "No supported editable rules in this file.",
                      )}
                    </p>
                  )}
                </div>
                {edit && (
                  <div className="card rule-editor" ref={editorRef}>
                    <h3>{edit.label[lang]}</h3>
                    {edit.note ? <p>{edit.note[lang]}</p> : null}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(() => prepare({ ruleId: edit.id, value }));
                      }}
                    >
                      <label htmlFor="rule-value">
                        {t("새 값", "New value")}
                      </label>
                      <div className="input-row">
                        {edit.type === "boolean" || edit.type === "operator" ? (
                          <select
                            id="rule-value"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          >
                            {(edit.type === "boolean"
                              ? ["true", "false"]
                              : [">=", ">", "<=", "<", "===", "!==", "==", "!="]
                            ).map((v) => (
                              <option key={v} value={v}>
                                {edit.syntax === "python" &&
                                edit.type === "boolean"
                                  ? v === "true"
                                    ? "True"
                                    : "False"
                                  : v}
                              </option>
                            ))}
                          </select>
                        ) : edit.type === "string" ? (
                          <textarea
                            id="rule-value"
                            value={value}
                            rows={3}
                            onChange={(e) => setValue(e.target.value)}
                          />
                        ) : (
                          <input
                            id="rule-value"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                          />
                        )}
                        <button
                          className="primary"
                          disabled={disabled || !state.trusted}
                        >
                          {t("변경안 만들기", "Preview change")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEdit(undefined);
                            setPatch(undefined);
                          }}
                        >
                          {t("닫기", "Close")}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
                {patch && (
                  <section
                    className="card patch"
                    ref={patchRef}
                    aria-label={t("변경 미리보기", "Change preview")}
                  >
                    <span className="eyebrow">
                      {t("적용 전 확인", "REVIEW BEFORE APPLYING")}
                    </span>
                    <h3>{patch.description[lang]}</h3>
                    <div className="diff">
                      <div>
                        <small>{t("현재", "Before")}</small>
                        <code>{patch.oldText}</code>
                      </div>
                      <span>→</span>
                      <div>
                        <small>{t("변경 후", "After")}</small>
                        <code>{patch.newText}</code>
                      </div>
                    </div>
                    <p>
                      {t(
                        "문법 검사를 통과했습니다. 이 변경안의 타입과 실제 동작은 아직 확인하지 않았습니다. 적용 뒤 편집기 알림도 살펴보세요.",
                        "Syntax checked. Types and runtime behavior of this proposal are not verified. Review editor reports after applying it.",
                      )}
                    </p>
                    <div className="actions">
                      <button
                        disabled={disabled}
                        onClick={() =>
                          void action(() =>
                            request(
                              "preview",
                              { id: patch.id, lang },
                              state.contextId,
                            ),
                          )
                        }
                      >
                        {t("VS Code에서 차이 비교", "Compare in VS Code")}
                      </button>
                      <button
                        className="primary"
                        disabled={disabled || !state.trusted}
                        onClick={() =>
                          void action(async () => {
                            await request(
                              "apply",
                              { id: patch.id },
                              state.contextId,
                            );
                            setPatch(undefined);
                            setNotice({
                              ko: "편집기에 적용했습니다. Ctrl+Z로 취소하고, Ctrl+S로 저장하세요.",
                              en: "Applied to the editor. Undo with Ctrl+Z; save with Ctrl+S.",
                            });
                          })
                        }
                      >
                        {t("편집기에 적용", "Apply to editor")}
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
            {a && tab === "checks" && (
              <>
                <ProjectChecks state={state} lang={lang} />
                {state.diagnostics && (
                  <EditorProblems
                    snapshot={state.diagnostics}
                    lang={lang}
                    disabled={disabled}
                    onSource={(revision, id) =>
                      void action(() =>
                        request(
                          "diagnosticSource",
                          { revision, id },
                          state.contextId,
                        ),
                      )
                    }
                  />
                )}
                <span className="eyebrow">REVIEW WITH CONTEXT</span>
                <h2>{t("한 번 더 살펴볼 부분", "Things to review")}</h2>
                <p className="muted">
                  {t(
                    "아래 항목은 구문 검사와 정해진 패턴에 따른 제안입니다. 실제 버그를 확정하거나 전체 코드의 품질을 보증하지 않습니다.",
                    "These are syntax checks and pattern-based suggestions, not a complete audit.",
                  )}
                </p>
                {a.issues.map((issue) => (
                  <section key={issue.id} className="card issue">
                    <span className="pill">
                      {issue.level === "error"
                        ? t("문법 오류", "Syntax error")
                        : t("확인 필요", "Review")}
                    </span>
                    <h3>{issue.title[lang]}</h3>
                    <p>{issue.detail[lang]}</p>
                    <button
                      className="line-link"
                      onClick={() => source(issue.line)}
                    >
                      {t("해당 코드 보기", "View source")} · L{issue.line}
                    </button>
                  </section>
                ))}
                {!a.issues.length && (
                  <p className="card">
                    {t(
                      "지원하는 검사에서 제안할 항목을 찾지 못했습니다. 모든 동작이 검증되었다는 뜻은 아닙니다.",
                      "No findings from the supported checks. This does not verify all behavior.",
                    )}
                  </p>
                )}
              </>
            )}
            {tab === "map" && (
              <>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={working || state.busy}
                    onClick={() => void action(() => request("scan"))}
                  >
                    {t("작업 공간 연결 읽기", "Scan workspace")}
                  </button>
                </div>
                <p className="muted">
                  {state.scanNote ||
                    t(
                      "열어 본 파일의 연결을 표시합니다. 프로젝트 전체 연결은 위 버튼으로 읽어 주세요.",
                      "Showing files read so far. Scan the workspace to find more connections.",
                    )}
                </p>
                <MapView
                  files={state.project?.files || []}
                  lang={lang}
                  onSelect={(path) =>
                    void action(async () => {
                      await request("select", { path });
                      setTab("story");
                    })
                  }
                />
              </>
            )}
          </main>
        </>
      )}
      {a && scenarioFn && (patch || fn) && (
        <ScenarioLab
          key={`${state.contextId}:${patch?.id}:${scenarioFn.name}`}
          fn={scenarioFn}
          rules={a.rules}
          lang={lang}
          revision={`${state.contextId}:${patch?.id}`}
          change={patch}
          disabled={disabled}
          run={(scenarios) =>
            request<ScenarioReport>(
              "compare",
              { name: scenarioFn.name, scenarios, patchId: patch?.id },
              state.contextId,
            )
          }
          exportReport={(content) =>
            request<void>("report", { content }, state.contextId)
          }
        />
      )}
      {fn && (
        <section ref={simulationRef} className="card simulation">
          <div className="section-heading">
            <h2>
              {t("값을 넣어 확인", "Try inputs")} · <code>{fn}</code>
            </h2>
            <button
              onClick={() => {
                setFn("");
                setSimulation(undefined);
              }}
            >
              {t("닫기", "Close")}
            </button>
          </div>
          <p className="muted">
            {t(
              "제한된 계산을 따라가는 모의 실행입니다. 사용자 코드를 직접 실행하거나 네트워크를 호출하지 않습니다.",
              "A restricted interpreter follows supported calculations without executing arbitrary code or making network calls.",
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const id = state.contextId;
                const result = await request<Simulation>(
                  "simulate",
                  { name: fn, args },
                  id,
                );
                if (id === context.current) setSimulation(result);
              });
            }}
          >
            <label htmlFor="args">
              {t(
                "받는 정보 순서대로 입력 (예: [50000])",
                "Arguments in order (e.g. [50000])",
              )}
            </label>
            <div className="input-row">
              <input
                id="args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
              />
              <button disabled={disabled}>{t("결과 확인", "Evaluate")}</button>
            </div>
          </form>
          {simulation && (
            <>
              <pre>
                {simulation.ok
                  ? (JSON.stringify(simulation.result, null, 2) ?? "undefined")
                  : simulation.error}
              </pre>
              <ol>
                {simulation.trace.map((step, i) => (
                  <li key={i}>
                    {step.text}{" "}
                    <button
                      className="line-link"
                      onClick={() => source(step.line)}
                    >
                      L{step.line}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
      <footer className="app-footer">
        {t(
          "기본 읽기는 지원되는 구문과 원문에 기반합니다. 선택형 로컬 AI의 설명·수정은 모델의 제안이며 의미·동작·성능 검토가 필요합니다.",
          "Built-in reading uses supported syntax and source text. Optional local AI output is a model proposal; review its meaning, behavior and performance.",
        )}
      </footer>
      {help && (
        <ProductHelp
          lang={lang}
          environment="vscode"
          example={false}
          onClose={() => setHelp(false)}
          onOpen={(resource) => request("openResource", { resource })}
          onCopy={(text) => request("copyFeedback", { text })}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
