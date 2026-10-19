# Rust 원문 읽기·값 수정 · 개발판

2026-10-20. **0.7 개발 소스의 VS Code 데스크톱 기능**이다. 공개 0.6.0 설치본과 웹 데모에 추가된 기능은 아니다. API 키·모델·Rust SDK 없이 포함된 파서로 현재 편집기의 원문을 읽는다. Rust 프로젝트 전체의 정확성을 보증하지 않는다.

## 사용할 수 있는 범위

`.rs` 파일 또는 Rust로 지정한 새 문서를 열고 풀어봄의 **이해하기**를 선택한다. 함수, impl 메서드, 본문이 있는 trait 메서드, 매개변수, 지역 바인딩, return과 블록의 마지막 식, if/else, match의 각 패턴·guard·결과, 반복·호출의 일부 구조를 한국어/영어로 표시한다. 줄 번호는 현재 문서로 연결된다. 지원하지 않는 구문은 원문과 미해석 표시로 남긴다.

**바꾸기**에서는 숫자, bool, 일반 UTF-8 문자열과 raw string을 수정할 수 있다. 큰 정수·접미사·진법은 JS 숫자로 변환하지 않는다. 예를 들어 `9007199254740993u64`를 `9007199254740995u64`로 바꾸면 해당 범위만 교체한다. 숫자 입력에는 필요한 `u64`, `i32`, `f64` 등의 접미사를 포함한다. 문자열은 새 내용을 그대로 입력하며 Rust escape 또는 raw delimiter를 만든다. 매크로·속성 내부, char·byte·C 문자열은 직접 수정 목록에 넣지 않는다.

변경안을 확인한 뒤 **VS Code 코드 차이 보기**로 원문 전체를 비교하고 **편집기에 적용**한다. 자동 저장하지 않는다. Ctrl+Z로 원문을 되돌릴 수 있다. 문서가 바뀌면 기존 변경안은 무효가 된다. 문법 오류가 있는 원문은 구조·편집 목록을 제공하지 않는다. 숫자 입력에 문장·주석·다중 식을 끼워 넣는 변경은 거절한다. 한국어/영어의 제한된 값 변경 요청도 Rust 숫자 접미사를 보존한다.

## 검사 범위와 비용

[tree-sitter-rust 0.24.2](https://github.com/tree-sitter/tree-sitter-rust/releases/tag/v0.24.2) grammar와 web-tree-sitter 0.27.1을 고정해 포함한다. [배포 파일·해시·라이선스](../extension/runtime/rust/README.md)를 확인할 수 있다. 파싱 시 네트워크·Cargo·rustc·프로젝트 코드·build.rs·proc macro를 실행하지 않는다. 로컬 worker의 파싱·값 수정에 외부 API 비용은 없다.

**문법 파싱 통과는 컴파일 성공이 아니다.** 타입·숫자 범위·borrow/lifetime·소유권·trait 해석·모듈 의존성·매크로 확장·속성/cfg·Rust edition 적용·실행 결과·성능은 검사하지 않는다. 타입이 틀린 `fn f()->bool {123}`과 매크로 내부의 임의 토큰도 파싱될 수 있다. 후보 전체를 다시 파싱해도 이 한계는 같다. 현재 import 지도·실행 시뮬레이션·Rust 자동 포맷은 제공하지 않는다.

선택형 로컬 AI의 Rust 변경안도 같은 문법 검사를 거친다. 문법 오류인 제안은 diff를 볼 수 있으나 적용할 수 없다. 이는 모델 설명의 의미 정확성을 검증한 것이 아니다. 원래 프로젝트의 `cargo test`, `cargo check` 등은 [프로젝트 검사](PROJECT_CHECKS.md)에 별도로 등록하고 필요한 Rust 도구와 의존성을 준비해야 한다. 그 명령은 프로젝트 코드를 실행할 수 있으며, 원문 읽기와 별도 단계다.

원문 128 KiB, 분석 출력 2 MiB, 편집 값 4096자, 함수 100개, 함수당 매개변수 100개, 표시 단계 400개·깊이 16, 값 300개, 탐색 20,000노드·깊이 64로 제한한다. 생략 여부를 표시한다. 파싱 중 2초가 지나면 parser callback으로 중단을 요청하고, host worker 요청은 최대 20초에 worker를 종료한다. 표시 개수나 `supported` 단계 수는 설명 정확도 점수가 아니다.

## 검증과 남은 작업

- Rust 회귀 검사 16개: UTF-16 위치, BOM·emoji·CRLF/CR, 큰 정수·suffix, 함수/분기/guard, closure/async/`?`, raw delimiter·escape, 오류 구문, 코드 삽입 거절, 넓은 매개변수·긴 이름·한도, 한국어/영어 값 요청.
- 전체 핵심 검사 258개와 웹 빌드·확장 빌드 통과. 마지막 `match` 식 표시와 출력 한도 보완도 핵심 검사에 포함한다.
- Windows VS Code 1.96.4 개발 호스트 **54개**와 첫 설치 VSIX의 production 모드 **54개** 통과. 해당 설치본은 마지막 식 표시와 숫자 입력 안내를 포함하며, 후속 출력·이름·매개변수 한도 보완 전이다. 한도 보완본의 전체 설치 재검사는 아래 실패 기록과 후속 결과를 구분한다. 같은 54개 흐름을 두 방식으로 실행한 것이며 108개 서로 다른 기능이 아니다. [개발 기록](evidence/local-ai/rust-source-development-integration.json), [첫 설치 성공 기록](evidence/local-ai/rust-source-installed-integration.json).
- 설치본의 실제 파일 11개 해시를 대조하며 grammar와 binding WASM도 포함한다. 패키지에서 추출한 worker를 저장소 밖에서 실행해 Rust 파싱·정확한 수정·오류/삽입 거절을 확인했다.
- 실제 빌드된 UI/worker와 **모의 편집기**를 연결한 화면에서 한국어/영어 읽기·값 수정·반영 상태를 확인했다. [한국어 분기](evidence/local-ai/rust-source-reading-ko.jpg), [영어 변경안](evidence/local-ai/rust-source-review-en.jpg), [반영 후](evidence/local-ai/rust-source-applied-en.jpg). 재현: `node scripts/preview-function-format.mjs --rust`. 실제 native diff·undo는 별도의 VS Code 통합 검사 근거다.

첫 개발 호스트 실행에서 공통 요청 파서가 `u64` 접미사를 숫자 둘로 오인해 변경안 준비가 실패했다. Rust 숫자 추출을 추가하고 한/영 회귀 검사와 실제 host 흐름으로 수정 확인했다. 화면 확인 중 `match`의 마지막 식 표시 누락도 발견해 보완했다. 실패를 모델 품질이나 upstream 문제로 돌리지 않는다.

최종 설치 검사 재실행 중에는 Rust 검사에 도달하기 전 Go 분석 존재 assertion이 실패한 시도도 있었다. [실패 기록](evidence/local-ai/rust-source-installed-first-failure.json)을 보존한다. 당시 assertion에 상세 notice가 없었으므로 원인을 단정하지 않는다. 상태를 출력하도록 진단만 보강했고 검사 조건·production timeout을 완화하지 않았다. 성공한 실행과 실패한 시도를 별도로 기록한다.

다음 시도는 기존 TypeScript 진단 대기에서 실패했다. [언어 서버 로그 근거](evidence/local-ai/rust-source-installed-diagnostic-failure.json)는 상위 저장소의 자동 가져오기 의존성 탐색과 앞선 가상 문서 요청의 적체를 보여 준다. 격리된 테스트 프로필에서 자동 가져오기 제안·타입 자동 취득을 끄고 실제 TS 2322 오류 검사와 60초 제한은 유지했다. 이 변경은 제품 사용자의 설정을 바꾸지 않는다.

그 뒤 재검사는 [작은 JS 예제 초기 분석 timeout](evidence/local-ai/rust-source-installed-startup-failure.json)으로 끝났다. 확장 호스트의 반복적인 응답 지연을 관찰했으나 원인은 확정하지 않는다. **마지막 한도 보완본의 전체 설치 suite는 아직 성공으로 표시하지 않는다.** 핵심 258개와 마지막 패키지 추출 worker 검사는 통과했다. 로컬 반복 재시도 대신 별도 Windows/Linux CI를 진행하며, 기존 설치 54개 성공 기록을 마지막 패키지의 성공으로 바꾸지 않는다.

**실제 외부 Rust 프로젝트의 기존 테스트 전후·복구, Linux 실행, 다른 VS Code 버전·테마·좁은 화면·원격 작업 공간은 아직 이 기록의 검증 범위가 아니다.** 실제 Rust 유지보수·최적화 성공으로 주장하지 않는다. 사용자가 지정한 실제 프로젝트 평가와 원래 [제품 완성 계획](PRODUCT_COMPLETION.md)의 남은 범위는 계속 진행 중이다.
