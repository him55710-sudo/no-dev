# Go 원문 읽기·수정 · Go source reading

0.7 개발판의 로컬 데스크톱 VS Code 기능이다. 공개 안정판 0.6.0과 브라우저 데모에는 포함되지 않는다. 설치된 Go SDK의 표준 파서로 현재 파일을 읽고, 한국어/영어 설명에서 실제 원문으로 이동한다. 모델·Ollama·API 키·유료 API가 필요 없다.

## 설치와 사용

Go SDK가 필요하다. PATH의 `go`를 사용하거나 VS Code의 `pureobom.analysisGo` 설정에 실행 파일 경로를 넣는다. 사용자 소스를 실행하지 않는 읽기 도구만 처음 한 번 로컬에서 빌드한다. 도구 소스·SDK 버전·플랫폼이 바뀌면 다시 빌드하며 이후에는 캐시한 작은 프로세스로 읽는다. 첫 준비에는 최대 60초, 각 읽기에는 5초 제한이 있다. SDK·모듈·새 툴체인을 자동 다운로드하지 않는다. 실제 검증 SDK는 Go 1.27.2이며 모든 구버전·OS 조합을 검증한 것은 아니다.

`.go` 파일에서 **현재 파일 설명 열기**를 실행한다. 설명의 줄 번호로 원문을 확인하고 **규칙 바꾸기**에서 숫자·문자열 하나를 바꾼다. Go diff → 명시적 적용 → 필요하면 저장 → 등록한 프로젝트 검사 순서로 확인한다. 적용은 자동 저장하지 않으며 보통의 undo를 쓴다. 파일이 바뀌거나 이미 쓴 변경안은 거절한다.

## 정확히 제공하는 범위

- 함수·메서드 선언, 매개변수/반환 표기, 단일 대입, if/for 초기화, range, switch/type switch/select, return, defer, go, 채널 전송과 제어 이동을 부분적으로 읽는다. 여러 반환식을 함께 표시하며 반환된 `error`를 자동으로 발생한 예외라고 부르지 않는다.
- `defer`의 함수 값·인자는 지금 평가하고 호출은 함수 종료 전 역순으로 실행한다는 차이를 표시한다. 고루틴의 완료 순서나 호출한 구현의 의미는 추측하지 않는다.
- 단일 이름에 대입한 문자열·정수·실수 리터럴 하나만 직접 수정한다. 큰 정수·진법·지수의 원문 표기를 JS Number로 바꾸지 않는다. `true`/`false`는 가릴 수 있는 이름이므로 타입/범위 분석 없이 직접 수정 대상으로 삼지 않는다. 룬·복소수·컨테이너·식·여러 이름 대입은 제외한다.
- 원문 외부는 재직렬화하지 않는다. UTF-8 바이트 위치를 VS Code의 UTF-16 위치로 변환하며 한글·emoji·CRLF와 raw string의 CR 제거, `//line` 위치 지시를 별도로 처리한다. 주석을 지울 수 있는 단항 숫자·올바른 Unicode로 해석할 수 없는 바이트 문자열은 수정 목록에서 제외한다.
- 로컬 AI의 Go 변경안도 같은 파서로 문법을 확인한다. 잘못된 문법은 검토용 diff로 볼 수 있지만 적용은 차단한다. 제어된 HTTP 응답을 쓴 이 통합 검사는 실제 모델의 정확성 점수가 아니다.

문법 파싱은 타입·변수 범위·표현 가능한 숫자 범위·의존성·실행 결과·성능을 검증하지 않는다. `var count int = "wrong type"`도 문법 파서는 받아들일 수 있다. Go import 지도, 함수 시뮬레이션, 전체 구문 의미 분석, 원격 작업 공간은 미제공이다. 익명 함수 본문·지원하지 않는 식은 원문 확인 대상으로 남는다. 문법은 선택한 SDK가 지원하는 범위에 따른다.

소스 128KiB·출력 2MiB·표시 약 400개 구문/12단계/100함수/300값·미리보기 240자·수정 입력 4096자 한도다. 생략·문법 오류·없는 SDK·시간 초과·취소를 표시한다. 원문 링크와 프로젝트 검사로 표시되지 않은 부분도 확인해야 한다.

## 실행 구조와 근거

기능 소스 `5b9e5f0f20b0d7fd4ac786db1cdd03b5104d225f`의 [Windows·Ubuntu CI](https://github.com/him55710-sudo/pureobom/actions/runs/38884588820)가 모두 성공했다. 각 핵심 **185개**, 개발 호스트 **36개**, 새 VSIX 설치본 **36개**와 패키지 도구 4종 실행을 확인했다. [추출한 원자료](evidence/local-ai/go-source-ci.json). 같은 36개 흐름을 두 실행 방식에서 확인했으며 별개 기능 72개로 세지 않는다.

`extension/runtime/go_source.go`는 표준 라이브러리만 사용한다. 호스트는 이 고정 파일만 빌드하고 사용자 소스는 읽기 프로세스의 stdin 데이터로 전달한다. 사용자 import, init, go:generate는 실행하지 않는다. 고정 도구 빌드는 `GOTOOLCHAIN=local`, `GOENV=off`, `GOWORK=off`, `GO111MODULE=off`, `GOPROXY=off`, `GOSUMDB=off`, `GOTELEMETRY=off`, 빈 GOFLAGS, 비활성 CGO와 별도 캐시로 프로젝트 설정·컴파일러 훅·네트워크 자동 가져오기를 배제한다. 프로젝트 검사는 별도로 사용자가 검토한 실제 명령을 실행한다.

설계 참고: [Go 표준 파서](https://pkg.go.dev/go/parser), [defer 명세](https://go.dev/ref/spec#Defer_statements), [raw string AST 위치의 주의점](https://pkg.go.dev/go/ast#BasicLit), [로컬 툴체인 선택](https://go.dev/doc/toolchain).

- `tests/go-source.test.ts`: 실제 SDK/helper로 반환값·분기·defer·range·switch/select, 원문 범위·정밀 숫자·문자열 수정, 비실행, 문법/타입 구별, 한도·취소·없는 도구를 검사한다.
- `extension/test/goSource.ts`와 `localAssistant.ts`: 실제 편집기에서 읽기·줄 이동·diff·적용·undo·오래된 변경안 차단·SDK 실패/복구·Go 제안 문법 검사를 확인한다.
- [Google UUID 외부 프로젝트 검사](evidence/local-ai/go-source-project.md): 201개 통과·1개 skip → 의도한 잘못된 초기값으로 TestUUID 실패 → undo/저장 후 201개 통과·1개 skip. 원본 해시와 깨끗한 checkout도 복구됐다. 최적화나 임의 변경의 정확성 증거가 아니다.
- 패키지 검사는 VSIX에서 꺼낸 Go 도구를 저장소 밖에서 빌드해 읽기·정확한 값 수정을 실행한다. 설치 검사는 production 모드와 런타임 파일 7개의 해시를 확인한다.
- [네이티브 설치 화면](evidence/local-ai/go-source-native.md): 한국어/영어 설명, 실제 숫자 수정·Go diff·적용·undo·원문 이동과 좁은 화면의 제약을 공개한다. 화면 설치본과 후속 수정/통합 설치본의 해시는 구분한다.

## English scope

The development extension reads supported Go syntax using an installed SDK and a locally built standard-library helper. It presents Korean/English source-linked structure, multiple return expressions, deferred calls and concurrency distinctions. Single assigned string/numeric literals can be previewed, explicitly applied and undone without implicit saves. No model or paid API is required; an installed Go SDK and local desktop workspace are required. User code is parsed as data, never built or run by the reader. Types, scope, dependencies, execution and performance remain separate checks. The upstream UUID regression demonstrates the workflow rejecting a wrong edit, not universal correctness or optimization.
