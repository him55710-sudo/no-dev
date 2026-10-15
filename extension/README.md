# 풀어봄 · VS Code 확장 기능

**Pureobom — Read it. Change it. Check it.**

Read JS/TS as source-linked stories in Korean or English, edit a rule, and compare up to 12 inputs before applying. All analysis runs locally. This is a restricted preview, not general code generation or an application test runner. In English VS Code, run **Pureobom: Try an example** or **Pureobom: Explain current file**; choose English in the panel.

코딩 문법이 낯설어도 **문장으로 읽고, 표에서 규칙을 바꾸고, 연결 지도로 구조를 확인하는** 로컬 시제품입니다. JavaScript·TypeScript·JSX·TSX 코드를 한국어와 영어로 설명합니다. JSON은 유효성과 개요를 보여 줍니다.

## 시작하기

0.5에서는 **풀어봄: React 화면 문구 바꿔보기 / Pureobom: Edit React interface text** 명령도 제공합니다. 화면 요소·문구·조건·이벤트 속성을 펼쳐 읽고 문구를 선택해 실제 코드의 변경안을 만드세요. 화면을 실행하거나 최종 디자인을 재현하지는 않습니다.

1. VS Code 1.96 이상에서 확장 탭을 엽니다. (`Ctrl+Shift+X`)
2. 상단 `…` → **VSIX에서 설치… / Install from VSIX…** 를 선택하고 `pureobom-0.6.0.vsix`를 엽니다.
3. `.ts` 또는 `.js` 파일을 열고, `Ctrl+Shift+P` → **풀어봄: 현재 파일 설명 열기**를 실행합니다. 편집기 오른쪽 위 책 아이콘으로도 열 수 있습니다.
4. 처음이라면 왼쪽 풀어봄 아이콘 → **예제로 시작하기**를 누르세요.

Node.js 별도 설치, API 키, 웹 서버가 필요하지 않습니다. 분석과 수정은 확장 기능 안에서 처리합니다. 이 확장 기능이 사용자 코드를 외부 서버로 보내지 않습니다.

상단 **도움말·피드백 / Help & feedback**에서 설치 안내와 저장소를 열거나, 완료·막힘·미지원 경험을 남길 요약을 만들 수 있습니다. 작성한 내용과 버전·환경·언어만 미리 보고 복사합니다. 코드·파일명은 자동 첨부하지 않으며, GitHub에 공유하려면 직접 붙여 넣고 제출해야 합니다.

## 실제 사용 흐름

- **문장으로 읽기:** 함수가 받는 정보, 조건에 따른 분기, 반환·오류 처리 설명을 봅니다. `L숫자`를 누르면 실제 코드의 해당 줄로 이동합니다.
- **내 프로젝트 용어:** 설명 위에서 코드 이름을 선택하고 한국어·영어 뜻을 직접 지정합니다. 설명과 규칙 표, 문장 수정 요청에 반영됩니다. 코드 식별자는 바꾸지 않습니다. 용어는 현재 VS Code 작업 공간에 문서 URI와 선언별로 저장되며, 저장하지 않은 새 문서의 용어는 현재 세션에서만 유지됩니다. 속성·import·중첩 블록 선언은 아직 지정할 수 없습니다.
- **규칙 바꾸기:** `무료 배송 기준`을 선택하거나 `무료 배송 기준을 70000으로 변경`이라고 적습니다. 하나의 이름과 하나의 값만 지원합니다.
- **변경안 확인:** 값의 차이를 먼저 보고, **VS Code에서 차이 비교**로 원본 전체와 변경본을 비교합니다.
- **변경 전후 비교:** 아래 입력 표에서 최대 12개 사례를 확인합니다. 달라짐·같음·확인 불가를 구분하며, 추천 입력 외에 직접 중요한 사례를 넣을 수 있습니다. 비교 설명서는 새 Markdown 문서로 열리고 원하면 저장할 수 있습니다. 가져오지 않은 상대 경로 연결 파일이 있으면 연결 지도를 먼저 읽어 주세요.
- **편집기에 적용:** 열려 있는 문서에 변경이 반영됩니다. **Ctrl+Z**로 실행 취소하고 **Ctrl+S**로 저장합니다. 자동 저장 설정을 켠 VS Code에서는 설정에 따라 저장될 수 있습니다.
- **편집기 알림:** VS Code가 보고한 현재 파일의 오류·경고와 검사 도구의 원래 메시지를 확인합니다. TypeScript의 일부 오류에는 쉬운 한국어·영어 뜻풀이를 붙이며, 위치 버튼은 정확한 원문 범위를 선택합니다. 코드 변경 후 아직 갱신되지 않은 알림은 구분합니다. 알림이 없다고 검사 완료나 정상 동작을 뜻하지 않습니다.
- **검토할 부분:** 편집기 알림과 별도로 풀어봄의 문법 오류·일부 검토 패턴의 근거도 확인합니다.
- **연결 지도:** 작업 공간의 파일을 읽어 정적 상대 경로 import/export 관계를 표시합니다. 파일을 누르면 해당 코드와 설명이 열립니다. 새 파일·외부 파일 변경은 **작업 공간 연결 읽기**로 다시 읽으세요.
- **값을 넣어 확인:** `[50000]`처럼 함수 인자를 JSON 배열로 넣어 지원되는 순수 계산을 따라갑니다. 사용자 코드를 직접 실행하는 기능은 아닙니다.

저장 전 편집 내용도 설명에 반영됩니다. 변경안을 만든 뒤 문서가 바뀌거나 다른 파일로 전환하면 이전 변경안을 적용할 수 없습니다. VS Code의 밝은 테마·어두운 테마·대비 색상과 글꼴 설정을 사용합니다. 연결 그래프의 바탕은 밝은 색입니다.

## 현재 범위

이 버전은 **구문 분석 기반 MVP**입니다. 생성형 AI 모델은 연결하지 않았습니다. 이름은 작은 한국어·영어 용어 사전으로 설명하며, 작성 의도를 추측해서 확정하지 않습니다.

| 항목 | 지원 범위 |
| --- | --- |
| 수정 | 숫자·문자열·불리언 리터럴과 비교 연산자 한 곳. 새로운 기능 생성, 다중 파일 리팩터링 미지원 |
| 검사 | 문법 파싱·검토 패턴과 VS Code의 현재 파일 알림 연결. 변경안의 사전 타입 검사·전체 프로젝트 검사·보안 감사·실제 테스트 실행 미지원 |
| 모의 실행 | 제한된 순수 계산. 네트워크, DOM, 비동기, 외부 패키지, 반복문 등 미지원 구문은 거부 |
| 연결 | 정적인 상대 경로 import/export. 별칭, require, 동적 import 미해석. 그래프 최대 40개 파일 |
| 크기 | 파일당 512KB, 최대 300개, 합계 8MB. 숨김·의존성·빌드 파일은 작업 공간 검색에서 제외 |
| 제한 모드 | 설명 열람 가능. 수정안 생성·적용은 신뢰한 작업 공간에서 가능 |
| 환경 | 데스크톱 VS Code의 Node 확장 호스트. vscode.dev·가상 작업 공간은 미지원. 원격 환경은 미검증 |

문법 검사를 통과해도 의도한 동작과 일치한다는 보장은 없습니다. 실제 기능·테스트 결과와 함께 확인하세요.

## 연구에서 가져온 설계

자연어와 직접 조작을 함께 제공하고, 설명을 원본 위치에 연결하며, 변경 전후를 확인하도록 설계했습니다. Consensus에서 확인한 연구는 연구 노트에 정리되어 있습니다. 해당 연구의 결과가 이 제품의 사용자 효과를 입증하는 것은 아닙니다.

- [Direct Manipulation and Natural Language Programming, Together at Last?](https://consensus.app/papers/direct-manipulation-and-natural-language-programming-ziegler-cao/9efe9ec848035295a07fb95e4cda830b/)
- [Beginners Struggle to Understand LLM-Generated Code](https://consensus.app/papers/i-would-have-written-my-code-differently-beginners-zi-li/5a84eb0eab1c5a3baf17cc92adcae33b/)
- [Bidirectional evaluation with direct manipulation](https://consensus.app/papers/bidirectional-evaluation-with-direct-manipulation-mayer-kunčak/aaade7dd902c5a7e8bc4db392404554e/)

소스와 상세 검증 기록은 함께 제공된 프로젝트의 `extension/`, `docs/` 폴더에 있습니다. 현재는 로컬 VSIX로 배포하며 Marketplace에는 게시하지 않았습니다.
