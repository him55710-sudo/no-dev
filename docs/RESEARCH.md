# 선행 연구와 제품 설계

조사일: 2026-10-15. Consensus 검색 후 각 논문의 상세 레코드와 초록을 조회했습니다. 아래 내용은 **초록과 메타데이터 범위**에서의 정리입니다. 논문 전체의 실험 자료를 재분석하지 않았으며, 제품 효과 검증과는 구분합니다.

## 1. 문제 정의

사용자가 원하는 것은 코드 생성 버튼 하나가 아니라, 생성된 결과를 **이해하고 수정하고 판단할 수 있는 개발 도구**입니다. 코딩 문법을 일상 문장으로 바꾸는 것만으로는 부족합니다. 조건·데이터·의존 관계·실패 상황·변경 영향을 연결해 보여주어야 합니다.

제품 가설은 ‘코드 구조를 근거로 생성된 설명, 직접 조작 가능한 규칙, 입력에 따른 피드백을 함께 제공하면 비개발자의 수정 정확성과 오류 발견 능력을 높일 수 있다’입니다. 아직 사용자 실험으로 검증되지 않은 가설입니다.

## 2. 연구 근거

### Direct Manipulation and Natural Language Programming, Together at Last? (2026)

Parker Ziegler, D. Cao, Justin P. Lubin, Sarah E. Chasins. _Proceedings of the ACM on Programming Languages_, 10, 1132–1163.

[Consensus 상세 레코드](https://consensus.app/papers/direct-manipulation-and-natural-language-programming-ziegler-cao/9efe9ec848035295a07fb95e4cda830b/)

프로그램을 구조화된 편집의 연속으로 다루고, 직접 조작과 자연어가 공통 편집 언어를 사용하도록 제안합니다. 18명 대상 연구에서 두 방식을 함께 제공했을 때 자연어로 수행한 편집 비중은 6.14%였습니다. 직접 조작은 작업 나누기와 점진적 편집에 도움이 되었으며, 자연어는 반복 작업의 자동화 등에 쓰였습니다.

**적용:** 표/설명 카드와 문장 입력이 모두 `makePatch`라는 동일한 수정 경로를 사용합니다. 대화를 길게 이어가는 대신 바꿀 규칙과 새 값을 화면에서 확정합니다. 이 연구는 특정 시스템·참가자·과제의 결과이며, 모든 비개발자가 직접 조작을 선호한다고 일반화할 수 없습니다.

### “I Would Have Written My Code Differently”: Beginners Struggle to Understand LLM-Generated Code (2025)

Yangtian Zi, Luisa Li, Arjun Guha, C. Anderson, Molly Q. Feldman. _Proceedings of the 33rd ACM International Conference on the Foundations of Software Engineering_.

[Consensus 상세 레코드](https://consensus.app/papers/i-would-have-written-my-code-differently-beginners-zi-li/5a84eb0eab1c5a3baf17cc92adcae33b/)

초급 컴퓨터과학 수강생 32명의 160개 과제를 분석한 연구입니다. 과제별 성공률은 32.5%였고, 비원어민의 언어 장벽, Python 문법의 낯섦, 자동화 편향 등이 관찰되었습니다. 코드 생성 이후 읽고 평가하는 단계가 별도의 장벽임을 보여줍니다.

**적용:** 한국어 중심의 설명, 원본 행 번호, 미지원 표시, 변경 전후 계산을 제공합니다. ‘문법 통과’를 ‘동작 검증 완료’로 표시하지 않습니다. 초급 수강생 대상 결과를 전체 비개발자 집단의 능력으로 해석해서는 안 됩니다.

### Bidirectional evaluation with direct manipulation (2018)

M. Mayer, Viktor Kunčak, Ravi Chugh. _Proceedings of the ACM on Programming Languages_, 2, 1–28.

[Consensus 상세 레코드](https://consensus.app/papers/bidirectional-evaluation-with-direct-manipulation-mayer-kunčak/aaade7dd902c5a7e8bc4db392404554e/)

출력 수정에서 프로그램 변경을 유도하는 양방향 평가를 제안하고, Sketch-n-Sketch에서 HTML 문서 편집을 시연했습니다. 초록에서는 총 약 1,400줄의 10개 예제를 통해 접근법을 평가했다고 설명합니다.

**적용:** 설명 화면의 값이 원본 코드의 정확한 범위를 가리키도록 유지하고, 수정 후 설명을 다시 계산합니다. 이 시제품은 논문의 일반적인 양방향 평가 알고리즘을 구현하지 않습니다. 숫자·문자열·불리언·비교 연산으로 편집 범위를 제한합니다.

### 구현 근거

[TypeScript 공식 Compiler API 문서](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)는 소스 파일을 파싱하고 구문 트리를 순회하는 API를 제공합니다. 문서가 TypeScript 6 이하의 API를 설명하고 7 계열의 차이를 안내하므로, 시제품은 검증한 5.9.3을 고정합니다. 정규식으로 코드 전체를 추측하는 대신 문법 구조·문자 범위·행 번호를 사용합니다.

## 3. 설계 원칙

| 원칙                              | 시제품의 실제 구현                     | 남은 한계                                    |
| --------------------------------- | -------------------------------------- | -------------------------------------------- |
| 설명에는 근거가 있어야 함         | 파일/행/문자 범위를 보존               | 사업적 의도·동적 동작은 알 수 없음           |
| 작은 수정부터 확정                | 단일 값/연산 편집, 미리보기, 적용      | 광범위한 리팩터링 미지원                     |
| 한 가지 입력 방식에 의존하지 않기 | 규칙 표와 제한된 자연어 요청 병행      | 자유로운 자연어 이해 미지원                  |
| 확실하지 않으면 표시              | 미지원 구문, 해석 불가 결과, 검토 후보 | 표시된 항목 외의 결함은 발견하지 못함        |
| 결과와 근거를 함께 제시           | 입력별 결과와 분기 기록                | 실제 실행 환경의 결과는 아님                 |
| 빠른 피드백                       | Worker·파일 단위 캐시·지연 ZIP 로딩    | 매우 큰 프로젝트·복잡한 AST는 별도 검증 필요 |

## 4. 다음 사용자 평가

비개발자와 기초 개발자를 구분해 모집하고, 동일 과제를 ‘원본 코드+일반 AI 설명’과 ‘풀어봄’ 조건에서 교차 수행하게 합니다. 학습 순서 영향을 줄이기 위해 순서를 균형 배치합니다. 참가자 수는 파일럿 이후 검정력 분석으로 정합니다.

과제는 배송 기준 변경, 조건 경계 오류 발견, 실패 처리 누락 확인, 영향받는 파일 찾기입니다. 측정할 것은 정확한 완료율, 소요 시간, 잘못된 수정 적용률, 숨겨진 오류를 정상이라고 믿는 비율, 설명 이해도와 주관적 부담입니다. ‘빠르게 했다’만으로 도구가 좋다고 결론 내리지 않습니다.

첫 사용성 실험 전에는 지원 범위와 한계를 이해했는지 확인하고, 정답을 알려주지 않는 진행 방식을 사용합니다. 이 평가가 끝나야 비개발자에게 실제 도움이 된다는 제품 주장을 할 수 있습니다.
