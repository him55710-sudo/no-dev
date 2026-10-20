import { useMemo, useState } from "react";
import {
  sourceLines,
  type CodeBlock,
  type FileReading,
} from "../../src/workspace/codeReading";

export function CodeReading({
  reading,
  current,
  disabled,
  onEdit,
}: {
  reading: FileReading;
  current: boolean;
  disabled: boolean;
  onEdit: (block: CodeBlock, request?: string) => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const lines = useMemo(() => sourceLines(reading.source), [reading.source]);
  const source = (start: number, end: number) =>
    lines.slice(start - 1, end).join("");
  return (
    <div className="pr-code-reading">
      <div className="pr-reading-toolbar">
        <div>
          <h3>코드를 차근차근 읽기</h3>
          <p className="pr-caption">
            {reading.lineCount}줄을 빠짐없이 설명에 연결했습니다. AI 해석의
            정확성이나 실행 성공을 뜻하지는 않습니다.
          </p>
        </div>
        <button
          aria-pressed={showSource}
          onClick={() => setShowSource((value) => !value)}
        >
          {showSource ? "설명에 집중하기" : "코드와 나란히 보기"}
        </button>
      </div>
      {reading.contextScope === "surrounding-code" && (
        <p className="pr-notice">
          큰 파일은 각 부분과 주변 코드를 나누어 읽었습니다. 멀리 떨어진 코드
          사이의 관계는 더 확인해야 할 수 있어요.
        </p>
      )}
      {!current && (
        <p className="pr-notice">
          코드가 바뀌어 이전 설명을 보고 있습니다. 다시 읽은 뒤 수정해 주세요.
        </p>
      )}
      {!reading.lineCount && (
        <p>
          아직 아무 내용도 없는 파일입니다. 원하는 역할을 아래에 적어 새 코드를
          만들 수 있어요.
        </p>
      )}
      {reading.blocks.map((block, index) => (
        <article
          className="pr-code-block"
          key={`${block.startLine}:${block.endLine}`}
        >
          <header>
            <span className="pr-eyebrow">
              부분 {index + 1} · {block.startLine}~{block.endLine}줄
            </span>
            <h3>{block.title}</h3>
            <p>{block.purpose}</p>
          </header>
          {(block.inputs.length > 0 || block.outputs.length > 0) && (
            <div className="pr-reading-io">
              {block.inputs.length > 0 && (
                <div>
                  <h4>받는 정보</h4>
                  <ul>
                    {block.inputs.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </div>
              )}
              {block.outputs.length > 0 && (
                <div>
                  <h4>만드는 결과</h4>
                  <ul>
                    {block.outputs.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <h4>이렇게 읽으면 돼요</h4>
          <ol className="pr-reading-steps">
            {block.steps.map((step) => (
              <li
                key={step.startLine}
                className={showSource ? "with-source" : undefined}
              >
                <div className="pr-reading-meaning">
                  <p>{step.explanation}</p>
                  {step.example && (
                    <p className="pr-reading-example">
                      <strong>예를 들면</strong> {step.example}
                    </p>
                  )}
                  {!showSource && (
                    <details>
                      <summary>
                        이 설명에 해당하는 코드 · {step.startLine}~
                        {step.endLine}줄
                      </summary>
                      <pre>
                        <code>{source(step.startLine, step.endLine)}</code>
                      </pre>
                    </details>
                  )}
                </div>
                {showSource && (
                  <div className="pr-reading-source">
                    <small>
                      {step.startLine}~{step.endLine}줄
                    </small>
                    <pre>
                      <code>{source(step.startLine, step.endLine)}</code>
                    </pre>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="pr-reading-reason">
            <h4>왜 이렇게 썼을까요?</h4>
            <span className="pr-reading-basis">
              {
                {
                  explicit: "코드에 적힌 이유",
                  inferred: "코드를 바탕으로 한 추정",
                  unknown: "작성 이유는 확인되지 않음",
                }[block.rationale.basis]
              }
            </span>
            <p>{block.rationale.explanation}</p>
            {block.rationale.quote && (
              <details>
                <summary>판단의 근거 보기</summary>
                <pre>
                  <code>{block.rationale.quote}</code>
                </pre>
              </details>
            )}
          </div>
          {block.changes.length > 0 && (
            <div className="pr-reading-changes">
              <h4>이런 부분을 바꿀 수 있어요</h4>
              {block.changes.map((change, i) => (
                <details key={i}>
                  <summary>{change.title}</summary>
                  <dl>
                    <dt>지금은</dt>
                    <dd>{change.current}</dd>
                    <dt>이렇게 요청하면</dt>
                    <dd>{change.request}</dd>
                    <dt>달라지는 점</dt>
                    <dd>{change.effect}</dd>
                    <dt>함께 확인할 점</dt>
                    <dd>{change.caution}</dd>
                  </dl>
                  <button
                    disabled={disabled || !current}
                    onClick={() => onEdit(block, change.request)}
                  >
                    이 요청으로 수정 준비하기
                  </button>
                  <details>
                    <summary>수정할 코드의 근거</summary>
                    <pre>
                      <code>{change.evidence}</code>
                    </pre>
                  </details>
                </details>
              ))}
            </div>
          )}
          {block.unknowns.length > 0 && (
            <div className="pr-reading-unknowns">
              <h4>더 확인해야 하는 점</h4>
              <ul>
                {block.unknowns.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            className="pr-link"
            disabled={disabled || !current}
            onClick={() => onEdit(block)}
          >
            이 부분을 내가 원하는 대로 바꾸기
          </button>
        </article>
      ))}
    </div>
  );
}
