import { useState } from "react";
import type { FileAnalysis, Lang, Rule } from "../core/types";
import "./DataFacts.css";

const names = {
  object: ["객체", "object"],
  array: ["목록", "array"],
  string: ["문자열", "string"],
  number: ["숫자", "number"],
  boolean: ["참·거짓", "boolean"],
  null: ["null 값", "null value"],
};

export function DataFacts({
  analysis,
  lang,
  onSource,
  onEdit,
  disabled = false,
  editDisabled = disabled,
}: {
  analysis: FileAnalysis;
  lang: Lang;
  onSource: (line: number) => void;
  onEdit: (rule: Rule) => void;
  disabled?: boolean;
  editDisabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const data = analysis.data,
    ko = lang === "ko";
  const t = (k: string, e: string) => (ko ? k : e);
  if (!data)
    return (
      <section className="card data-facts">
        <h2>{t("데이터를 읽을 수 없습니다", "Cannot read this data")}</h2>
        <p>
          {t(
            "문법 오류를 먼저 확인해 주세요.",
            "Check the syntax errors first.",
          )}
        </p>
        <button disabled={disabled} onClick={() => onSource(1)}>
          {t("원문 보기", "View source")}
        </button>
      </section>
    );
  const query = search.trim().toLocaleLowerCase();
  const visible = data.fields.filter((field) =>
    `${field.path} ${field.preview}`.toLocaleLowerCase().includes(query),
  );
  const rules = new Map(analysis.rules.map((rule) => [rule.id, rule]));
  return (
    <section
      className="card data-facts"
      aria-label={t("원문 데이터", "Source data")}
    >
      <header>
        <span className="eyebrow">
          {t("모델 없이 확인한 값", "SOURCE FACTS · NO MODEL")}
        </span>
        <h2>{t("원문에 저장된 데이터", "Data stored in this file")}</h2>
        <p>{analysis.steps[0]?.text[lang]}</p>
      </header>
      <p className="data-facts-boundary">
        {t(
          "키 이름만으로 실행 조건·재시도·요금 적용을 판단하지 않습니다. 여기서는 적힌 값과 위치를 확인하고 값 하나를 바꿀 수 있습니다.",
          "Key names do not establish conditions, retries or charges. Inspect the written values and their locations, and change one value at a time.",
        )}
      </p>
      <label className="data-facts-search">
        <span>{t("키 경로·값 찾기", "Find a key path or value")}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("예: enabled, 50000", "Example: enabled, 50000")}
        />
      </label>
      <p className="muted" role="status">
        {visible.length} / {data.fields.length}{" "}
        {t("개 항목 표시", "entries shown")}
      </p>
      {data.truncated ? (
        <p className="data-facts-boundary">
          {t(
            "최대 300개 항목·12단계 깊이까지만 표시합니다. 나머지는 원문에서 확인해 주세요.",
            "Showing up to 300 entries and 12 levels. Inspect the source for the rest.",
          )}
        </p>
      ) : null}
      <ul className="data-facts-list">
        {visible.map((field) => {
          const rule = field.ruleId ? rules.get(field.ruleId) : undefined;
          const container = field.type === "object" || field.type === "array";
          return (
            <li key={field.id}>
              <div className="data-facts-heading">
                <code>{field.path}</code>
                <span className="data-facts-type">
                  {names[field.type][ko ? 0 : 1]}
                </span>
              </div>
              <div className="data-facts-value">
                {container ? (
                  <span>
                    {field.count} {t("개 항목", "entries")}
                  </span>
                ) : (
                  <code>{field.preview}</code>
                )}
              </div>
              {field.abbreviated ? (
                <small>
                  {t(
                    "긴 값의 일부입니다. 전체 값은 원문에서 확인하세요.",
                    "Abbreviated value. View the source for the full text.",
                  )}
                </small>
              ) : null}
              {field.note ? (
                <p className="data-facts-note">{field.note[lang]}</p>
              ) : null}
              <div className="data-facts-actions">
                <button
                  disabled={disabled}
                  onClick={() => onSource(field.line)}
                  aria-label={`${t("원문", "Source")} ${field.path}, L${field.line}`}
                >
                  {t("원문", "Source")} L{field.line}
                </button>
                {rule ? (
                  <button
                    disabled={editDisabled || !analysis.syntaxValid}
                    onClick={() => onEdit(rule)}
                    aria-label={`${t("값 바꾸기", "Edit value")} ${field.path}`}
                  >
                    {t("값 바꾸기", "Edit value")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {!visible.length ? (
        <p>
          {query
            ? t(
                "표시 범위에서 일치하는 항목이 없습니다.",
                "No matches in the displayed entries.",
              )
            : t(
                "이 객체나 목록은 비어 있습니다.",
                "This object or array is empty.",
              )}
        </p>
      ) : null}
      <p className="muted">
        {t(
          "숫자는 원문 표기를 유지합니다. 읽는 프로그램의 숫자 정밀도와 변경 효과는 별도로 확인해야 합니다. null과 객체·목록 전체는 원문에서 수정하세요.",
          "Numbers retain their source spelling. Consumer precision and change effects require separate checks. Edit null and whole objects or arrays in the source.",
        )}
      </p>
    </section>
  );
}
