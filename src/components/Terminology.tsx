import { useState } from "react";
import type { CodeTerm } from "../core/glossary";
import type { Lang } from "../core/types";
import "./terminology.css";

type Props = {
  terms: CodeTerm[];
  lang: Lang;
  disabled?: boolean;
  onSave: (id: string, label: string) => Promise<void>;
  onSource: (line: number) => void;
};
export function Terminology({
  terms,
  lang,
  disabled,
  onSave,
  onSource,
}: Props) {
  const [selected, setSelected] = useState("");
  if (!terms.length) return null;
  const ko = lang === "ko",
    active = terms.find((term) => term.id === selected) || terms[0];
  const count = terms.filter((term) => term.custom?.[lang]).length;
  return (
    <details className="terminology">
      <summary>
        {ko ? "내 프로젝트 용어" : "My project terms"}
        <span>
          {count
            ? ko
              ? `${count}개 지정`
              : `${count} customized`
            : ko
              ? "낯선 이름에 뜻 붙이기"
              : "Give unfamiliar names meaning"}
        </span>
      </summary>
      <div className="terminology-body">
        <p>
          {ko
            ? "코드 이름에 내가 아는 뜻을 붙여 보세요. 설명과 규칙 표에 반영되며 원본 코드 이름은 유지됩니다."
            : "Give code names meanings you recognize. Stories and rule tables use your terms; source identifiers stay the same."}
        </p>
        <label>
          {ko ? "뜻을 붙일 코드 이름" : "Code name to explain"}
          <select
            value={active.id}
            onChange={(e) => setSelected(e.target.value)}
            disabled={disabled}
          >
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name} ·{" "}
                {term.scope === "file"
                  ? ko
                    ? "파일 전체"
                    : "file scope"
                  : `${term.scope}()`}{" "}
                · L{term.line}
              </option>
            ))}
          </select>
        </label>
        <TermForm
          key={`${active.id}:${lang}:${active.custom?.[lang] || ""}`}
          term={active}
          lang={lang}
          disabled={disabled}
          onSave={onSave}
        />
        <div className="terminology-foot">
          <button
            type="button"
            onClick={() => onSource(active.line)}
            disabled={disabled}
          >
            {ko ? "원문에서 확인" : "See declaration"} · L{active.line}
          </button>
          <small>
            {ko
              ? "직접 지정한 뜻입니다. 코드의 실제 의도를 검증한 결과는 아닙니다."
              : "These are your meanings, not verified author intent."}
          </small>
        </div>
      </div>
    </details>
  );
}
function TermForm({
  term,
  lang,
  disabled,
  onSave,
}: {
  term: CodeTerm;
  lang: Lang;
  disabled?: boolean;
  onSave: Props["onSave"];
}) {
  const [value, setValue] = useState(term.custom?.[lang] || "");
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const ko = lang === "ko",
    locked = disabled || working;
  async function save(label: string) {
    setWorking(true);
    setError("");
    try {
      await onSave(term.id, label);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
    >
      <label>
        {ko ? "한국어로 부를 이름" : "Name in English"}
        <input
          value={value}
          maxLength={80}
          placeholder={term.defaults[lang]}
          disabled={locked}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <div className="terminology-actions">
        <button
          type="submit"
          disabled={
            locked || !value.trim() || value.trim() === term.custom?.[lang]
          }
        >
          {working
            ? ko
              ? "저장 중…"
              : "Saving…"
            : ko
              ? "설명에 적용"
              : "Use in explanations"}
        </button>
        <button
          type="button"
          disabled={locked || !term.custom?.[lang]}
          onClick={() => void save("")}
        >
          {ko ? "기본 이름으로" : "Reset name"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
