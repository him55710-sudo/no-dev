# Java 원문 읽기·수정 · Java source reading

0.7 개발 소스의 **로컬 데스크톱 VS Code** 기능이다. 공개 안정판 0.6.0과 Pages 데모에는 포함되지 않는다. 설치된 JDK 파서로 일부 구문과 실제 값을 읽어 한국어·영어로 표시한다. 모델·Ollama·API 키·유료 API가 필요 없다.

## 설치와 사용

JDK 21 이상이 필요하다. `pureobom.analysisJavaHome` 사용자 설정에 JDK 폴더의 절대 경로를 넣거나 `JAVA_HOME`을 설정한다. 둘 다 없으면 PATH의 `java`와 `javac`를 사용하며 두 버전이 같아야 한다. JRE만 설치한 환경은 사용할 수 없다. 실제 검증은 Temurin **25.0.4.1+1**에서 했고 모든 JDK 배포판·구버전 조합을 검증한 것은 아니다.

`.java` 파일에서 **현재 파일 설명 열기**를 실행하고 설명의 줄 번호로 원문을 확인한다. **규칙 바꾸기**에서 숫자·문자열·참거짓 하나의 새 값을 넣어 Java diff → 명시적 적용 → 필요하면 저장 → 프로젝트 검사 순서로 확인한다. 큰 정수의 `L`, 실수의 `f` 등 필요한 표기를 유지한다. 자연어 요청도 해당 표기를 그대로 전달한다. 자동 저장하지 않으며 편집기의 undo를 사용할 수 있다. 파일이 바뀌었거나 이미 사용한 변경안은 다시 적용할 수 없다.

첫 사용에는 포함된 고정 Java 도구만 로컬에서 컴파일한다. 도구 소스·JDK 버전·실행 경로·운영체제가 바뀌면 다시 준비하고, 이후에는 캐시한 도구를 별도 프로세스로 실행한다. 준비는 최대 60초, 각 도구 호출은 5초 제한이다. JDK·프로젝트 의존성을 자동 다운로드하지 않는다. 도구가 없거나 실패하면 이유와 설정 방법을 표시한다.

## 제공하는 범위와 한계

- 클래스·record·인터페이스·enum의 멤버, 메서드·생성자 선언, 대입, if/else, for/향상된 for/while/do, switch와 조건식 일부, return·throw·yield·break·continue·label·assert·synchronized를 원문에 연결한다. 오버로드는 선언된 매개변수 타입으로 구분한다.
- try 자원 준비 순서·역순 닫기·억제될 수 있는 예외, catch와 finally를 구별한다. 람다 선언은 본문 실행과 구별한다. 중첩된 모든 식을 풀어 설명하지 않으며 임의 호출·초기화의 결과를 추측하지 않는다.
- 변수 초기값 또는 단일 이름/멤버에 대입한 일반 문자열·숫자·boolean 리터럴 하나를 수정한다. 숫자를 JavaScript Number로 변환하지 않아 큰 정수·진법·지수·접미사를 보존한다. 문자 리터럴, null, text block, 주석을 포함한 숫자식, Unicode escape로 바꾼 토큰 경계는 직접 수정 대상에서 제외한다.
- JDK의 UTF-16 원문 위치를 사용한다. 한글·emoji·CRLF/CR/LF와 Java Unicode escape의 차이를 검사했다. 문자열은 Java escape로 인코딩하며 변경 전후 원문 범위 밖을 재직렬화하지 않는다. 수정 후 다시 파싱하여 같은 종류의 리터럴 하나인지와 정확한 변경 범위를 확인한다.
- 로컬 AI의 Java 변경안도 같은 파서로 검사한다. 문법 오류는 diff로 볼 수 있지만 적용은 차단한다. 이 경로의 제어된 HTTP 응답 검사는 실제 모델 정확도의 근거가 아니다.

**문법 파싱은 타입 검사나 실행 검증이 아니다.** `int count = "wrong type";` 같은 코드는 파싱을 통과할 수 있다. 숫자가 대입 타입에 맞는지, 변수 범위·import·의존성·호출·런타임 결과·성능은 프로젝트 도구로 확인해야 한다. import 연결 지도, 함수 시뮬레이션, package/module 설명, 전체 의미 분석, preview 언어 기능, 원격 작업 공간은 미제공이다. 파서가 받아들이는 문법은 선택한 JDK에 따른다.

입력 128KiB·출력 2MiB·표시 약 400구문/12단계/100메서드/300값·원문 미리보기 240자·단일 값 4096자 한도다. 생략 표시와 실제 원문을 함께 확인한다. 긴 파일의 전체 동작을 설명했다고 간주하지 않는다.

## 실행 구조와 검증

`extension/runtime/PureobomJavaSource.java`는 JDK 표준 API만 사용한다. `JavacTask.parse()`로 사용자 입력을 읽으며 `analyze`, `generate`, 컴파일 task의 `call`은 실행하지 않는다. 사용자 코드를 컴파일·실행하거나 import한 클래스를 로드하지 않는다. 클래스/소스/annotation processor 검색 경로를 비우고 annotation processing을 끈다. 호스트는 JVM 실행 훅 환경 변수와 CLASSPATH를 전달하지 않는다. 실제 프로젝트 검사는 사용자가 검토한 별도 명령으로 코드를 실행한다.

설계 근거: [JavacTask의 파싱·분석·생성 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.compiler/com/sun/source/util/JavacTask.html), [원문 위치 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.compiler/com/sun/source/util/SourcePositions.html), [switch case API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.compiler/com/sun/source/tree/CaseTree.html).

- `tests/java-source.test.ts`: 실제 JDK로 구문·예외·분기·정확한 값·잘못된 교체·큰 정수·Unicode·비실행·문법/타입 구별·한도·취소·없는 도구를 확인한다.
- `extension/test/javaSource.ts`, `localAssistant.ts`: 실제 편집기 읽기·원문 이동·Java diff·적용·재분석·undo·오래된 변경안 차단·JDK 실패/복구와 AI 제안 문법 차단을 확인한다.
- 설치 검사는 VSIX의 production 모드와 런타임 8개 해시를 확인한다. 패키지 검사는 추출한 Java 도구를 저장소 밖에서 빌드하여 읽기와 정확한 값 수정을 실행한다. [작업 기록](AGENT_WORKLOG.md)에 실제 실행 결과와 실패를 남긴다.
- [외부 minimal-json 검사](evidence/local-ai/java-source-project.md)는 원래 라이브러리 테스트와 실제 편집기 흐름을 연결한다. 고정 회귀를 발견하고 undo로 복구하는 검사이며 최적화 성공 사례가 아니다.

## English scope

The development extension uses an installed JDK 21+ to parse supported Java structure and exact literal values. It supports Korean/English source links, native Java diffs, explicit edits and undo without implicit saving. A fixed standard-library helper is compiled locally; user source is parser input only. No model or paid API is required. Types, dependencies, execution and performance require separate project checks. Native source support is partial and local-desktop-only; published 0.6.0 and the browser demo do not include it.
