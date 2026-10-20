import { useState } from "react";
import type { StructureEdge } from "./model";

export function ConnectionEvidence({
  edge,
  source,
}: {
  edge: StructureEdge;
  source: (id: string, index: number) => void;
}) {
  const [shown, setShown] = useState(3);
  return (
    <div className="connection-evidence">
      {edge.sources.slice(0, shown).map((ref, index) => {
        const site = edge.sites?.[index];
        return (
          <section
            className="connection-site"
            aria-label={`연결 위치 ${index + 1}`}
            key={`${ref.path}:${ref.start}:${index}`}
          >
            <h3>
              연결 위치 {index + 1} · {ref.line}행
            </h3>
            {site ? (
              <>
                <p>{site.summary}</p>
                <details>
                  <summary>이 위치의 코드</summary>
                  <code>{site.code}</code>
                </details>
                {site.inputs.length ? (
                  <dl>
                    {site.inputs.map((input, i) => (
                      <div key={i}>
                        <dt>{input.label}</dt>
                        <dd>
                          {input.description}
                          <code>{input.code}</code>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : edge.kind === "calls" ? (
                  <p>명시적으로 전달한 인수가 없습니다.</p>
                ) : null}
                {site.omittedInputs ? (
                  <p>
                    나머지 인수·속성 {site.omittedInputs}개는 원문에서
                    확인하세요.
                  </p>
                ) : null}
                {site.result ? <p>{site.result}</p> : null}
                {site.contexts.length ? (
                  <details>
                    <summary>
                      주변 분기·반복·오류 처리 {site.contexts.length}개
                    </summary>
                    {site.contexts.map((context, i) => (
                      <div className="connection-context" key={i}>
                        <p>{context.description}</p>
                        <small>{context.line}행</small>
                        <code>{context.code}</code>
                      </div>
                    ))}
                  </details>
                ) : (
                  <p>
                    같은 함수 안에서 직접 감싸는 분기·반복·오류 처리 구문은
                    표시할 항목이 없습니다.
                  </p>
                )}
                {site.omittedContexts ? (
                  <p>주변 구문 {site.omittedContexts}개를 더 생략했습니다.</p>
                ) : null}
              </>
            ) : (
              <p>
                이 분석에는 연결의 상세 구문이 없습니다. 구조를 새로 읽어
                확인하세요.
              </p>
            )}
            <button onClick={() => source(edge.id, index)}>
              {ref.path}:{ref.line} 원문 ↗
            </button>
          </section>
        );
      })}
      {shown < edge.sources.length ? (
        <button onClick={() => setShown((count) => count + 3)}>
          다음 연결 위치 보기 · {edge.sources.length - shown}곳 남음
        </button>
      ) : null}
      <details className="connection-limits">
        <summary>이 설명의 확인 범위</summary>
        {edge.kind === "routes" ? (
          <p>
            고정 주소·키와 Next.js App Router의 파일 규칙을 대조했습니다. 동적
            주소, 재작성, 프록시, basePath와 실제 서버 배치는 해석하지 않습니다.
            SWR의 fetcher는 키를 다른 방식으로 사용할 수 있습니다.
          </p>
        ) : null}
        <p>
          전달식과 직접 감싸는 구문을 읽은 결과입니다. 실제 값, 앞선 종료문을
          포함한 전체 실행 경로, 외부 오류 처리와 데이터 계약은 확인하지
          않습니다. 함수 전달은 전달받은 쪽의 실제 실행을 증명하지 않습니다. 긴
          코드 표현은 앞부분만 표시합니다.
        </p>
      </details>
    </div>
  );
}
