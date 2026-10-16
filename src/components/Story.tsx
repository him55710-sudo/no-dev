import { useState } from "react";
import type { FileAnalysis, Lang, Step, Rule } from "../core/types";
import { label } from "../core/labels";
import { Icon } from "./Icon";
import { InterfaceTree } from "./InterfaceTree";
import { DataFacts } from "./DataFacts";
export function Steps({
  steps,
  lang,
  onSource,
  depth = 0,
}: {
  steps: Step[];
  lang: Lang;
  onSource: (line: number) => void;
  depth?: number;
}) {
  return (
    <ol className={"steps depth-" + Math.min(depth, 3)}>
      {steps.map((step, i) => (
        <li key={step.id} className={`step step-${step.kind}`}>
          <div className="step-body">
            <span className="step-number">
              {depth ? (
                <Icon
                  name={
                    step.kind === "return"
                      ? "arrow"
                      : step.kind === "error"
                        ? "alert"
                        : "chevron"
                  }
                  size={14}
                />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <div className="step-content">
              <span className={!step.supported ? "muted" : ""}>
                {step.text[lang]}
              </span>
              <button className="line-link" onClick={() => onSource(step.line)}>
                L{step.line} <Icon name="code" size={12} />
              </button>
            </div>
          </div>
          {depth < 12 && step.children.length > 0 && (
            <Steps
              steps={step.children}
              lang={lang}
              onSource={onSource}
              depth={depth + 1}
            />
          )}{" "}
          {depth < 12 && step.otherwise && (
            <div className="otherwise">
              <span>
                {lang === "ko"
                  ? step.kind === "guard"
                    ? "오류가 나면"
                    : "그렇지 않으면"
                  : step.kind === "guard"
                    ? "On error"
                    : "Otherwise"}
              </span>
              <Steps
                steps={step.otherwise}
                lang={lang}
                onSource={onSource}
                depth={depth + 1}
              />
            </div>
          )}
          {depth < 12 && step.finalizer && (
            <Steps
              steps={[step.finalizer]}
              lang={lang}
              onSource={onSource}
              depth={depth + 1}
            />
          )}
          {depth >= 12 &&
            (step.children.length > 0 || step.otherwise || step.finalizer) && (
              <p className="muted">
                {lang === "ko"
                  ? "더 깊은 구조는 원문에서 확인해 주세요."
                  : "See source for deeper nesting."}
              </p>
            )}
        </li>
      ))}
    </ol>
  );
}
export function Story({
  analysis,
  lang,
  onSource,
  onSimulate,
  onEdit,
  disabled = false,
  editDisabled = disabled,
}: {
  analysis: FileAnalysis;
  lang: Lang;
  onSource: (line: number) => void;
  onSimulate: (name: string) => void;
  onEdit: (rule: Rule) => void;
  disabled?: boolean;
  editDisabled?: boolean;
}) {
  const [detail, setDetail] = useState(false);
  const ko = lang === "ko";
  if (analysis.kind === "json")
    return (
      <DataFacts
        key={analysis.path}
        analysis={analysis}
        lang={lang}
        onSource={onSource}
        onEdit={onEdit}
        disabled={disabled}
        editDisabled={editDisabled}
      />
    );
  if (analysis.kind === "text")
    return (
      <div className="empty card">
        <Icon name="file" size={38} />
        <h3>{ko ? "파일을 보관하고 있어요" : "File preserved"}</h3>
        <p>
          {ko
            ? "이 언어의 상세 분석은 아직 지원하지 않습니다. 원문을 열거나, 지원되는 JavaScript·TypeScript 파일을 선택하세요."
            : "Detailed analysis is not available for this language. View its source or select a JavaScript/TypeScript file."}
        </p>
        <button className="button" onClick={() => onSource(1)}>
          {ko ? "원문 보기" : "View source"}
        </button>
      </div>
    );
  return (
    <div className="story">
      <div className="section-heading">
        <div>
          <span className="eyebrow">READ THE LOGIC</span>
          <h2>
            {ko ? "이 파일은 이렇게 작동해요" : "Here is how this file works"}
          </h2>
        </div>
        <button
          className={"small-toggle " + (detail ? "active" : "")}
          onClick={() => setDetail(!detail)}
        >
          <Icon name="plus" size={14} />
          {ko ? "초기 설정도 보기" : "Show setup"}{" "}
        </button>
      </div>
      {analysis.rules.some(
        (r) => r.scope === "file" && r.type !== "operator",
      ) && (
        <div className="story-rules">
          {analysis.rules
            .filter((r) => r.scope === "file" && r.type !== "operator")
            .map((r) => (
              <button
                key={r.id}
                className="story-rule"
                onClick={() => onEdit(r)}
                disabled={!analysis.syntaxValid}
              >
                <span>{r.label[lang]}</span>
                <strong>
                  {typeof r.value === "number"
                    ? r.value.toLocaleString("en-US")
                    : String(r.value)}
                </strong>
                <span className="story-rule-action">
                  {ko ? "바꾸기" : "Edit"} <Icon name="arrow" size={13} />
                </span>
              </button>
            ))}
        </div>
      )}
      {detail && (
        <section className="card setup-card">
          <h3>{ko ? "파일을 불러올 때 준비하는 것" : "Module setup"}</h3>
          <Steps steps={analysis.steps} lang={lang} onSource={onSource} />
        </section>
      )}
      <InterfaceTree
        analysis={analysis}
        lang={lang}
        onSource={onSource}
        onEdit={onEdit}
      />
      {analysis.functions.length === 0 ? (
        <section className="card setup-card">
          <Steps steps={analysis.steps} lang={lang} onSource={onSource} />
          {analysis.steps.length === 0 && (
            <p>
              {ko
                ? "분석할 실행 구문이 없습니다."
                : "No executable statements found."}
            </p>
          )}
        </section>
      ) : (
        analysis.functions.map((fn, i) => (
          <section className="card function-card" key={fn.id}>
            <header>
              <div className="function-symbol">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div>
                <h3>{fn.label[lang]}</h3>
                <span className="mono muted">{fn.name}</span>
              </div>
              <span className="tag">
                {fn.async
                  ? ko
                    ? "기다림이 있는 기능"
                    : "Async function"
                  : ko
                    ? "기능"
                    : "Function"}
              </span>
            </header>
            <div className="function-input">
              <span className="mini-label">{ko ? "받는 정보" : "INPUTS"}</span>
              {fn.params.length ? (
                fn.params.map((p) => (
                  <span className="input-pill" key={p.name}>
                    {(p.label || label(p.name))[lang]} <code>{p.name}</code>{" "}
                    <small>
                      {p.type === "number"
                        ? ko
                          ? "숫자"
                          : "number"
                        : p.type === "boolean"
                          ? ko
                            ? "예 / 아니요"
                            : "yes / no"
                          : p.type}
                      {p.optional ? " · optional" : ""}
                    </small>
                  </span>
                ))
              ) : (
                <span className="muted">{ko ? "없음" : "None"}</span>
              )}
            </div>
            <Steps steps={fn.steps} lang={lang} onSource={onSource} />
            <footer>
              <span>
                <span className="status-dot" />
                {ko ? "코드 구문에서 확인한 설명" : "Derived from code syntax"}
              </span>
              {fn.simulatable && (
                <button
                  className="text-button"
                  onClick={() => onSimulate(fn.name)}
                >
                  <Icon name="play" size={14} />
                  {ko ? "값을 넣어 확인" : "Try inputs"}
                </button>
              )}
            </footer>
          </section>
        ))
      )}
      <p className="footnote">
        <Icon name="info" size={15} />
        {ko
          ? "이름 번역은 용어 사전을 사용합니다. 호출한 기능의 실제 동작·작성 의도·실행 결과까지 보장하지는 않습니다."
          : "Names use a small glossary. Descriptions do not establish author intent, called-function behavior or runtime outcomes."}
      </p>
    </div>
  );
}
