# C# 원문 읽기·수정 · C# source reading

0.7 개발 소스의 **로컬 데스크톱 VS Code** 기능이다. 공개 안정판 0.6.0과 Pages에는 포함되지 않는다. 설치된 .NET SDK의 Roslyn으로 일부 구문과 실제 값을 읽고 한국어·영어로 표시한다. 모델·Ollama·API 키·유료 API는 필요 없다.

## 설치와 사용

안정 버전 .NET SDK 8 이상이 필요하다. 런타임만 설치한 환경에서는 사용할 수 없다. `pureobom.analysisDotnet` 사용자 설정에 `dotnet` 실행 파일의 절대 경로를 넣거나 PATH에서 찾도록 비워 둔다. 선택한 실행기가 나열하는 안정 SDK 중 가장 높은 버전과 해당 reference pack/runtime을 사용한다. 현재 실제 검증 환경은 **SDK 10.0.402 / runtime 10.0.13 / Windows**다. SDK 8·9나 모든 운영체제 조합을 검증했다는 뜻은 아니다.

`.cs` 파일에서 **현재 파일 설명 열기**를 실행한다. 설명의 줄 번호로 원문을 확인하고 **규칙 바꾸기**에서 값 하나를 바꾼다. 자연어 요청에서는 `C# L137 @위치`처럼 표시된 규칙 이름 전체를 사용한다. 숫자의 `UL`, `m`, `f` 등 필요한 접미사는 그대로 입력한다. 변경안 → C# diff → 명시적 적용 → 필요하면 저장 → 프로젝트 검사 순서로 확인한다. 자동 저장하지 않으며 편집기 undo를 사용할 수 있다. 파일이 달라지거나 이미 사용한 변경안은 다시 적용하지 못한다.

첫 사용에는 포함된 고정 도구만 로컬 컴파일한다. SDK·경로·도구 소스 등이 달라지면 캐시를 다시 준비한다. 준비 60초, 각 도구 호출 5초 한도다. SDK·프로젝트 의존성을 자동 다운로드하지 않는다. 필요한 도구가 없거나 실패하면 이유와 설정 방법을 표시한다.

## 제공 범위와 한계

- 메서드·생성자·연산자·로컬 함수의 일부 선언과 본문, if/else, return/throw, 반복, switch 문·식, 조건식의 양쪽 결과, try/catch/filter/finally, using, lock, checked, yield, break/continue/goto를 원문에 연결한다. 람다·로컬 함수의 선언을 즉시 실행으로 설명하지 않는다. 오버로드 이름에 선언된 매개변수 타입을 붙인다.
- 프로퍼티·접근자·primary constructor의 별도 함수 설명, 모든 식의 의미, 호출 결과·타입·오버로드 해석, import 지도와 함수 시뮬레이션은 미제공이다. 지원하지 않는 구문은 원문과 미지원 상태를 표시한다.
- 숫자·일반/verbatim/raw 문자열·boolean 리터럴 하나를 수정한다. 조건식과 반환식의 리터럴도 포함한다. 문자·null·UTF-8 문자열·보간 문자열 전체·주석이나 공백으로 부호와 숫자가 떨어진 식은 직접 수정 대상에서 제외한다. 문자열 수정은 일반 C# 문자열 escape로 인코딩하므로 표기 형태가 달라질 수 있다.
- 숫자는 JavaScript Number로 변환하지 않아 큰 정수·진법·지수·구분자·접미사를 보존한다. 새 값이 리터럴 하나인지, 변경 후 같은 위치·종류인지, 전체 파일이 파싱되는지 검사한다. 범위 밖 원문은 재직렬화하지 않는다.
- UTF-16 원문 위치와 실제 파일의 CR/LF/CRLF 줄을 사용한다. 한글·emoji와 `#line`이 있어도 원문 이동은 실제 파일 위치를 가리킨다.
- 파일 안의 `#define`/`#undef`는 파서가 처리하지만 프로젝트의 define·언어 버전·framework·의존성은 읽지 않는다. 조건부 컴파일에서 비활성 코드는 설명·수정 대상에서 제외하며 지시문이 있으면 제한을 표시한다. 선택 SDK의 기본 안정 언어 버전을 사용한다.
- 로컬 AI의 C# 변경안도 같은 파서로 검사한다. 문법 오류는 diff로 볼 수 있으나 적용을 차단한다. 제어된 HTTP 응답을 이용한 검사는 실제 모델의 의미 정확도 근거가 아니다.

**파싱은 타입 검사·프로젝트 빌드·동작 검증이 아니다.** `int n="wrong";` 같은 코드는 파싱될 수 있다. 대입 타입·오버로드·의존성·실행 결과·성능은 실제 프로젝트 명령으로 확인해야 한다. 사용자 C#이나 프로젝트의 빌드 훅·source generator를 분석 중 실행하지 않는다. 원격 작업 공간은 지원하지 않는다.

입력 128KiB·출력 2MiB·표시 약 400구문/16단계/100함수/300값·원문 미리보기 240자·새 값 4096자 한도다. 생략 안내와 원문을 함께 확인한다. 긴 파일 전체를 설명했다고 간주하지 않는다.

## 구현과 재현

`extension/runtime/PureobomCSharpSource.cs`는 `CSharpSyntaxTree.ParseText`만 사용한다. `csharpSource.ts`는 SDK 안의 compiler/reference assemblies로 이 고정 helper를 준비한다. MSBuild·restore·사용자 프로젝트 컴파일을 호출하지 않으며 실행 훅·profiler·추가 dependency 환경 변수는 전달하지 않는다. 사용자 소스는 파서 입력이다. 사용자가 검토해 실행하는 **프로젝트 검사**는 별도로 실제 코드를 빌드·실행한다.

- `tests/csharp-source.test.ts`: 구문·분기·예외·물리적 위치·큰 정수·문자열 비실행·잘못된 교체·문법과 타입의 차이·조건부 컴파일·한도·취소·없는 SDK·자연어 숫자 보존.
- `extension/test/csharpSource.ts`, `localAssistant.ts`: 실제 편집기와 원문 이동·C# diff·적용·재분석·undo·오래된 변경안 차단·SDK 실패/복구·제안 문법 검사.
- `scripts/test-csharp-source-project.mjs`: 고정 외부 GuardClauses의 기존 테스트를 편집기 변경과 연결한다. [재현 방법](../scripts/fixtures/guardclauses/README.md).
- `scripts/check-release.mjs`: VSIX에서 추출한 고정 C# helper를 저장소 밖에서 컴파일하고 읽기·정확한 값 수정을 실행한다. 설치 통합 검사는 production 모드와 runtime 파일 9개 해시를 대조한다. 실제 실행 결과는 [작업 기록](AGENT_WORKLOG.md)에 남긴다.

설계 근거: [Roslyn syntax analysis](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/get-started/syntax-analysis), [CSharpSyntaxTree.ParseText](https://learn.microsoft.com/en-us/dotnet/api/microsoft.codeanalysis.csharp.csharpsyntaxtree.parsetext), [공식 .NET SDK 배포 metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json).

2026-10-20 후속: [별도 프로필의 0.7.0 설치 VSIX 검사](evidence/local-ai/function-format-installed-integration.json)에서 C# 읽기·편집·undo·SDK 실패/복구·모델 제안 문법 검사를 포함한 전체 51개 흐름이 통과했다. SDK 10.0.402 환경이며 SDK 8/9, GuardClauses의 편집 후 전체 검사, 설치본 수동 UI 조작을 검증한 것으로 확대하지 않는다.

[GuardClauses 외부 연동](evidence/local-ai/csharp-source-project.md)도 완료했다. 원래 net8.0 테스트 959개 통과, 검증용 값 변경 후 7개 실패, native undo 후 959개 통과와 BOM을 포함한 원문 바이트 복원을 확인했다. SDK 10의 Major roll-forward 환경이며 검증용 변경을 실제 upstream 버그 발견이나 최적화로 세지 않는다. 첫 BOM 위치 오류와 검증 스크립트 수정도 기록했다.

제품 커밋 `0a95520`의 [Windows/Ubuntu CI](evidence/local-ai/function-format-ci.json)에서는 C#을 포함한 핵심 242개·개발/설치 각 51개와 VSIX에서 추출한 C# helper의 읽기/수정이 통과했다. 외부 GuardClauses 실행과 새 harness의 BOM 수정은 이 CI 이후의 별도 로컬 기록이다.

## English scope

The development desktop extension uses an installed stable .NET SDK 8+ and Roslyn to read supported C# syntax and exact literal values. It provides Korean/English source links, native C# diffs, explicit edits and undo without implicit saving. Only a fixed helper is compiled; user source is parsed and never executed during analysis. No model or paid API is required. Types, project defines/language settings, dependencies, behavior and performance require separate project checks. Support is partial; the published 0.6.0 extension and browser demo do not include this feature.
