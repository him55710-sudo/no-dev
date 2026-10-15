import type { Lang } from "../core/types";
import { Icon } from "./Icon";
export const papers = [
  {
    year: "2026",
    title:
      "Direct Manipulation and Natural Language Programming, Together at Last?",
    authors: "Ziegler · Cao · Lubin · Chasins",
    url: "https://consensus.app/papers/direct-manipulation-and-natural-language-programming-ziegler-cao/9efe9ec848035295a07fb95e4cda830b/",
    ko: "18명 대상 연구에서는 두 방식을 함께 쓸 때 자연어 편집 비중이 6.14%였습니다. 이 도구는 직접 바꾸는 표와 문장 요청을 같은 수정 처리에 연결합니다.",
    en: "In an 18-participant study, natural language accounted for 6.14% of edits when both modes were available. This tool routes direct edits and sentence requests through the same patch operation.",
  },
  {
    year: "2025",
    title:
      "“I Would Have Written My Code Differently”: Beginners Struggle to Understand LLM-Generated Code",
    authors: "Zi · Li · Guha · Anderson · Feldman",
    url: "https://consensus.app/papers/i-would-have-written-my-code-differently-beginners-zi-li/5a84eb0eab1c5a3baf17cc92adcae33b/",
    ko: "초급 수강생 32명의 160개 과제에서 코드 이해·판단의 어려움과 언어 장벽을 관찰했습니다. 설명에서 원문 위치와 입력별 결과를 확인할 수 있도록 설계했습니다.",
    en: "A study of 32 introductory students across 160 tasks observed comprehension difficulties and language barriers. Descriptions here link to source evidence and input-based previews.",
  },
  {
    year: "2018",
    title: "Bidirectional evaluation with direct manipulation",
    authors: "Mayer · Kunčak · Chugh",
    url: "https://consensus.app/papers/bidirectional-evaluation-with-direct-manipulation-mayer-kunčak/aaade7dd902c5a7e8bc4db392404554e/",
    ko: "화면의 변경을 원본 프로그램에 반영하는 양방향 평가를 제시합니다. 이 시제품은 그 전체 알고리즘을 구현한 것이 아니라, 코드 위치를 보존하는 값·비교 연산 수정에 원칙을 적용합니다.",
    en: "Introduces bidirectional evaluation that propagates output edits into programs. This prototype borrows the source-linked editing principle for literals and comparisons; it does not implement the complete algorithm.",
  },
];
export function Research({ lang }: { lang: Lang }) {
  const ko = lang === "ko";
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">BUILT ON RESEARCH</span>
          <h2>
            {ko
              ? "연구에서 출발한, 이해하는 도구"
              : "A tool for understanding, informed by research"}
          </h2>
        </div>
        <span className="tag">Consensus</span>
      </div>
      <div className="research-intro card">
        <h3>
          {ko
            ? "설명 → 작은 수정 → 근거 확인"
            : "Understand → make a small edit → check evidence"}
        </h3>
        <p>
          {ko
            ? "자연어만으로 모든 복잡성을 없앨 수는 없습니다. 대신 코드를 이해하고 판단하는 데 필요한 구조와 피드백을 사람의 언어로 보여줍니다. 아래 연구는 설계의 참고 근거이며, 이 제품의 효과를 검증한 결과는 아닙니다."
            : "Natural language alone does not remove all complexity. This tool exposes structure and feedback in familiar language. These studies inform the design; they do not validate this product’s effectiveness."}
        </p>
      </div>
      {papers.map((p) => (
        <a
          className="research-card card"
          href={p.url}
          target="_blank"
          rel="noreferrer"
          key={p.year}
        >
          <span className="paper-year">{p.year}</span>
          <div>
            <h3>{p.title}</h3>
            <span className="muted">{p.authors}</span>
            <p>{p[lang]}</p>
          </div>
          <Icon name="external" size={18} />
        </a>
      ))}
      <section className="card research-intro">
        <h3>
          {ko
            ? "현재 할 수 있는 일과 다음 단계"
            : "Current scope and next steps"}
        </h3>
        <p>
          {ko
            ? "현재: JavaScript·TypeScript의 구문 설명, 정적 연결 지도, 값·비교 방식 편집, 문법 검사, 제한된 계산 미리보기. 한국어·영어를 지원합니다."
            : "Now: JavaScript/TypeScript syntax explanations, static import maps, literal and comparison edits, syntax checks and restricted calculation previews, in Korean and English."}
        </p>
        <p>
          {ko
            ? "다음: 사용자 정의 용어 사전, Python 분석기, 실행 환경을 격리한 실제 테스트, 언어 모델을 통한 문맥 설명, 변경 영향 분석, 비개발자 사용자 평가."
            : "Next: custom glossaries, a Python parser, isolated real tests, model-assisted contextual explanations, impact analysis and evaluation with non-programmers."}
        </p>
      </section>
    </>
  );
}
