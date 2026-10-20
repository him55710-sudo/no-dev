import type { FileAnalysis, Lang, Rule } from "../core/types";
import { Steps } from "./Story";

export function SqlStory({
  analysis,
  lang,
  onSource,
  onEdit,
  onDialect,
  disabled,
  editDisabled,
}: {
  analysis: FileAnalysis;
  lang: Lang;
  onSource: (line: number) => void;
  onEdit: (rule: Rule) => void;
  onDialect?: (dialect: "sqlite" | undefined) => void;
  disabled: boolean;
  editDisabled: boolean;
}) {
  const ko = lang === "ko";
  return (
    <div className="story">
      <section className="card data-facts">
        <label>
          {ko ? "이 파일의 SQL 방언 " : "SQL dialect for this file "}
          <select
            value={analysis.sql?.dialect || ""}
            disabled={disabled || !onDialect}
            onChange={(event) =>
              onDialect?.(
                event.target.value === "sqlite" ? "sqlite" : undefined,
              )
            }
          >
            <option value="">{ko ? "선택하지 않음" : "Not selected"}</option>
            <option value="sqlite">SQLite</option>
          </select>
        </label>
        <p>
          {ko
            ? "열려 있는 파일에 적용합니다. VS Code에서는 파일을 닫거나 다시 시작하면 다시 선택합니다. PostgreSQL·MySQL 등 다른 방언은 아직 전용 분석을 제공하지 않습니다."
            : "Applies to this open file. In VS Code, select again after closing the file or restarting. Dedicated PostgreSQL/MySQL and other dialect analysis is not available yet."}
        </p>
        {analysis.sql?.dialect ? (
          <p>
            {ko
              ? `SQLite ${analysis.sql.version} 문법을 포함된 로컬 파서로 읽었습니다. API·모델·데이터베이스 연결 없이 작동합니다. 쿼리를 실행하지 않았으며, 실제 엔진 버전·테이블·열·제약·결과·성능은 미검증입니다.`
              : `Read with a bundled local parser for SQLite ${analysis.sql.version} syntax. No API, model or database connection is needed. Queries were not executed; actual engine version, tables, columns, constraints, results and performance are unchecked.`}
          </p>
        ) : (
          <p role="status">
            {ko
              ? "방언을 선택하면 원문의 구조와 수정 가능한 값을 읽습니다."
              : "Select the dialect to read source structure and editable values."}
          </p>
        )}
      </section>
      {analysis.issues.length ? (
        <section className="card" role="status">
          {analysis.issues.map((issue) => (
            <p key={issue.id}>
              {issue.detail[lang]}{" "}
              <button
                className="line-link"
                onClick={() => onSource(issue.line)}
              >
                L{issue.line}
              </button>
            </p>
          ))}
        </section>
      ) : null}
      {analysis.sql?.dialect ? (
        <>
          <h2>
            {ko
              ? "쿼리 원문에서 읽은 구조"
              : "Structure read from query source"}
          </h2>
          <p>
            {ko
              ? "문장의 구조를 설명합니다. 실제 실행 순서나 쿼리 계획을 나타내지는 않습니다."
              : "Describes statement structure, not an execution sequence or query plan."}
          </p>
          <section className="card">
            <Steps steps={analysis.steps} lang={lang} onSource={onSource} />
            {analysis.syntaxValid && !analysis.steps.length ? (
              <p>
                {ko
                  ? "표시할 SQL 문장이 없습니다."
                  : "No SQL statements to display."}
              </p>
            ) : null}
          </section>
          <h3>{ko ? "원문에 적힌 값 바꾸기" : "Change written values"}</h3>
          <p>
            {ko
              ? "일반 작은따옴표 문자열과 숫자만 직접 수정합니다. 매개변수·식별자·NULL·blob 값은 별도 변경이 필요합니다."
              : "Direct editing covers ordinary single-quoted strings and numbers. Parameters, identifiers, NULL and blobs need separate changes."}
          </p>
          <div className="story-rules">
            {analysis.rules.map((rule) => (
              <button
                className="story-rule"
                key={rule.id}
                onClick={() => onEdit(rule)}
                disabled={editDisabled || !analysis.syntaxValid}
              >
                <span>{rule.label[lang]}</span>
                <strong>{rule.raw}</strong>
                <span>{ko ? "바꾸기" : "Edit"}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
