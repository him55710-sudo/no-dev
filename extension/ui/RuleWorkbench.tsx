import { useState, type ReactNode, type RefObject } from "react";
import type { FileAnalysis, Lang, Rule } from "../../src/core/types";
import type { PatchSummary } from "../src/protocol";
type Props = {
  analysis: FileAnalysis;
  lang: Lang;
  disabled: boolean;
  trusted: boolean;
  edit?: Rule;
  value: string;
  patch?: PatchSummary;
  sentence: string;
  onSelect: (rule: Rule) => void;
  onValue: (value: string) => void;
  onSentence: (value: string) => void;
  onPrepare: (payload: Record<string, unknown>) => void;
  onClose: () => void;
  onPreview: () => void;
  onApply: () => void;
  onSource: (line: number) => void;
  editorRef: RefObject<HTMLDivElement | null>;
  patchRef: RefObject<HTMLElement | null>;
  comparison?: ReactNode;
};
export function RuleWorkbench(p: Props) {
  const { analysis: a, lang, edit, patch } = p;
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const matches = a.rules.filter((r) =>
    `${r.label[lang]} ${r.name} ${r.scope}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const blocked = p.disabled || !p.trusted || !a.syntaxValid;
  return (
    <div className="rule-workbench">
      <div className="journey-heading">
        <span className="eyebrow">
          {t("작은 변경부터 시작해요", "ONE CHANGE AT A TIME")}
        </span>
        <h2>
          {t("무엇을 바꾸고 싶으세요?", "What would you like to change?")}
        </h2>
        <p>
          {t(
            "값을 고르고, 차이를 확인한 뒤 적용하세요. 적용하기 전까지 코드는 바뀌지 않아요.",
            "Choose a value, review the difference, then apply. Code stays unchanged until you apply.",
          )}
        </p>
      </div>
      <ol
        className="edit-progress"
        aria-label={t("변경 진행 단계", "Change progress")}
      >
        <li aria-current={!edit && !patch ? "step" : undefined}>
          <span>1</span>
          {t("값 선택", "Choose")}
        </li>
        <li aria-current={edit && !patch ? "step" : undefined}>
          <span>2</span>
          {t("새 값 입력", "Edit")}
        </li>
        <li aria-current={patch ? "step" : undefined}>
          <span>3</span>
          {t("차이 확인·적용", "Review & apply")}
        </li>
      </ol>
      {!p.trusted && (
        <p className="banner">
          {t(
            "작업 공간이 제한 모드라 지금은 값을 바꿀 수 없어요.",
            "Changes are unavailable in Restricted Mode.",
          )}
        </p>
      )}
      {!a.syntaxValid && (
        <p className="banner error">
          {t(
            "먼저 확인하기에서 문법 오류를 해결해 주세요.",
            "Resolve syntax errors in Check first.",
          )}
        </p>
      )}
      <div className={`rule-layout ${edit || patch ? "has-selection" : ""}`}>
        <section
          className="rule-catalog"
          aria-label={t("바꿀 값 목록", "Editable values")}
        >
          <label htmlFor="rule-search">
            {t("이름으로 찾기", "Find by name")}
            <span>
              {matches.length} / {a.rules.length}
            </span>
          </label>
          <input
            id="rule-search"
            type="search"
            placeholder={t(
              "예: 배송, 할인, 제목",
              "e.g. shipping, discount, title",
            )}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(20);
            }}
          />
          <div className="rule-list">
            {matches.slice(0, limit).map((rule) => (
              <button
                key={rule.id}
                className="rule-row"
                aria-pressed={edit?.id === rule.id}
                disabled={blocked}
                onClick={() => p.onSelect(rule)}
              >
                <span className="rule-row-title">
                  <strong>{rule.label[lang]}</strong>
                  <small>
                    {rule.name} · L{rule.line}
                  </small>
                </span>
                <span className="rule-row-value">
                  {(rule.raw.length > 85
                    ? rule.raw.slice(0, 85) + "…"
                    : rule.raw) || '""'}
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          {!matches.length && (
            <div className="catalog-empty">
              <strong>
                {a.rules.length
                  ? t("일치하는 값이 없어요", "No matching values")
                  : t(
                      "직접 바꿀 수 있는 값이 없어요",
                      "No directly editable values",
                    )}
              </strong>
              <p>
                {a.rules.length
                  ? t(
                      "다른 이름으로 찾아보거나 검색어를 지워보세요.",
                      "Try another name or clear the search.",
                    )
                  : t(
                      "이 파일은 읽기와 검토부터 시작하세요. 넓은 범위의 수정은 AI 도움에서 제안받을 수 있어요.",
                      "Start with reading and review. AI help can propose broader changes.",
                    )}
              </p>
              {search && (
                <button onClick={() => setSearch("")}>
                  {t("검색 지우기", "Clear search")}
                </button>
              )}
            </div>
          )}
          {matches.length > limit && (
            <button className="load-more" onClick={() => setLimit(limit + 20)}>
              {t(
                `20개 더 보기 · ${matches.length - limit}개 남음`,
                `Show 20 more · ${matches.length - limit} remaining`,
              )}
            </button>
          )}
        </section>
        <div className="change-column">
          {edit && (
            <div className="change-editor" ref={p.editorRef}>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">
                    {t("선택한 값", "SELECTED VALUE")}
                  </span>
                  <h3>{edit.label[lang]}</h3>
                </div>
                <button className="text-button" onClick={p.onClose}>
                  {t("취소", "Cancel")}
                </button>
              </div>
              <button
                className="line-link"
                disabled={p.disabled}
                onClick={() => p.onSource(edit.line)}
              >
                {t("원문 확인", "View source")} · L{edit.line} ↗
              </button>
              <div className="current-value">
                <small>{t("현재 값", "Current value")}</small>
                <code>{edit.raw}</code>
              </div>
              {edit.note && <p className="reading-note">{edit.note[lang]}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onPrepare({ ruleId: edit.id, value: p.value });
                }}
              >
                <label htmlFor="rule-value">
                  {t("어떤 값으로 바꿀까요?", "What should the new value be?")}
                </label>
                {edit.type === "boolean" || edit.type === "operator" ? (
                  <select
                    id="rule-value"
                    value={p.value}
                    onChange={(e) => p.onValue(e.target.value)}
                  >
                    {(edit.type === "boolean"
                      ? ["true", "false"]
                      : [">=", ">", "<=", "<", "===", "!==", "==", "!="]
                    ).map((v) => (
                      <option key={v} value={v}>
                        {edit.type === "boolean"
                          ? `${v === "true" ? t("예 / 켜짐", "Yes / on") : t("아니요 / 꺼짐", "No / off")} (${edit.syntax === "python" ? (v === "true" ? "True" : "False") : v})`
                          : `${v} · ${({ ">=": t("이상", "at least"), ">": t("초과", "greater than"), "<=": t("이하", "at most"), "<": t("미만", "less than"), "===": t("값과 종류가 같음", "same value and type"), "!==": t("값 또는 종류가 다름", "different value or type"), "==": t("종류 변환 후 같음", "equal after conversion"), "!=": t("종류 변환 후 다름", "unequal after conversion") } as Record<string, string>)[v]}`}
                      </option>
                    ))}
                  </select>
                ) : edit.type === "string" ? (
                  <textarea
                    id="rule-value"
                    rows={3}
                    value={p.value}
                    onChange={(e) => p.onValue(e.target.value)}
                  />
                ) : (
                  <input
                    id="rule-value"
                    inputMode="decimal"
                    value={p.value}
                    onChange={(e) => p.onValue(e.target.value)}
                  />
                )}
                <small className="field-help">
                  {edit.syntax === "css"
                    ? t(
                        "단위까지 입력하세요. 예: 24px",
                        "Include the unit, e.g. 24px.",
                      )
                    : edit.type === "number"
                      ? t(
                          "단위 없이 숫자를 써 주세요. 7만 → 70000",
                          "Use a plain number, e.g. 70000.",
                        )
                      : edit.type === "string"
                        ? t(
                            "표시할 문구를 그대로 쓰세요. 따옴표를 더하지 않아도 돼요.",
                            "Enter the text as-is. No extra quotes needed.",
                          )
                        : t(
                            "변경 전후는 다음 단계에서 비교해요.",
                            "Compare before and after in the next step.",
                          )}
                </small>
                <button
                  className="primary full-width"
                  disabled={blocked || p.value === String(edit.value)}
                >
                  {t("이 값으로 변경안 보기 →", "Review this change →")}
                </button>
              </form>
            </div>
          )}
          {!edit && !patch && (
            <div className="selection-placeholder">
              <span aria-hidden="true">↖</span>
              <h3>
                {t("바꿀 값을 하나 골라보세요", "Choose a value to start")}
              </h3>
              <p>
                {t(
                  "원본 코드의 위치와 현재 값을 확인하고, 원하는 새 값을 입력할 수 있어요.",
                  "See its source and current value, then enter the value you want.",
                )}
              </p>
            </div>
          )}
          {patch && (
            <section
              className="change-review"
              ref={p.patchRef}
              tabIndex={-1}
              aria-label={t("변경 미리보기", "Change preview")}
            >
              <span className="eyebrow">
                {t("아직 적용하지 않았어요", "NOT APPLIED YET")}
              </span>
              <h3>{t("이렇게 달라집니다", "Here is what will change")}</h3>
              <p>{patch.description[lang]}</p>
              <div className="change-values">
                <div>
                  <small>{t("현재", "Before")}</small>
                  <code>{patch.oldText}</code>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>{t("변경 후", "After")}</small>
                  <code>{patch.newText}</code>
                </div>
              </div>
              <ul className="verification-facts">
                <li>{t("문법 검사 통과", "Syntax checked")}</li>
                <li>
                  {t(
                    "타입·실제 동작은 아직 확인 필요",
                    "Types and runtime behavior still need checking",
                  )}
                </li>
              </ul>
              <button
                className="secondary full-width"
                disabled={p.disabled}
                onClick={p.onPreview}
              >
                {t(
                  "VS Code에서 코드 차이 보기 ↗",
                  "View the code diff in VS Code ↗",
                )}
              </button>
              {p.comparison && (
                <details className="comparison-disclosure">
                  <summary>
                    {t(
                      "예시 값으로 변경 전후 비교하기",
                      "Compare outcomes with example inputs",
                    )}
                  </summary>
                  {p.comparison}
                </details>
              )}
              <div className="apply-bar">
                <button
                  className="primary full-width"
                  disabled={blocked}
                  onClick={p.onApply}
                >
                  {t(
                    "확인했어요. 편집기에 적용",
                    "Apply this change to the editor",
                  )}
                </button>
                <small>
                  {t(
                    "적용 후 Ctrl+Z로 실행 취소할 수 있어요.",
                    "Undo afterward with Ctrl+Z.",
                  )}
                </small>
              </div>
            </section>
          )}
        </div>
      </div>
      <details className="disclosure request-disclosure">
        <summary>
          {t("문장으로 요청하고 싶다면", "Prefer to describe the change?")}
        </summary>
        <p>
          {t(
            "표에 있는 정확한 이름과 새 값 하나를 적어 주세요. 자유로운 기능 추가는 AI 도움에서 요청하세요.",
            "Use an exact name from the list and one new value. For broader changes, use AI help.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            p.onPrepare({ request: p.sentence });
          }}
        >
          <label htmlFor="sentence">{t("변경 요청", "Change request")}</label>
          <div className="input-row">
            <input
              id="sentence"
              value={p.sentence}
              onChange={(e) => p.onSentence(e.target.value)}
              placeholder={t(
                "무료 배송 기준을 70000으로 변경",
                "Change freeShippingThreshold to 70000",
              )}
            />
            <button disabled={blocked || !p.sentence.trim()}>
              {t("변경안 보기", "Review change")}
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
