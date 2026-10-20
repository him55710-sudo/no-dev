# Java 외부 프로젝트 · minimal-json

2026-10-16, Windows와 VS Code 1.96.4에서 확인했다. [원자료](java-source-project.json)는 실제 파서의 양언어 설명·선택한 값·정확한 범위·프로젝트 명령의 종료 코드·파일 해시·원래 테스트 결과와 준비 실패를 포함한다. 모델 응답이나 최적화 성공 사례가 아니다.

대상은 MIT 라이선스 [minimal-json 0.9.5](https://github.com/ralfstx/minimal-json/tree/5518c876226ae07f8291d6b41209bc3c979f4a55), 고정 commit `5518c876226ae07f8291d6b41209bc3c979f4a55`이다. upstream이 현재 유지보수 중단을 명시한 프로젝트이며, 설치를 권장하는 목록이 아니라 고정된 회귀 검증 자료로 사용했다. [라이선스](MINIMAL_JSON_LICENSE.txt)를 보존하고 upstream에는 변경을 보내지 않았다.

## 실제 흐름

`com.eclipsesource.json/src/main/java/com/eclipsesource/json/JsonParser.java`에서 312개 표시 노드 중 283개를 지원 구문으로 읽었다. 나머지는 원문 확인 대상으로 남으며 표시 한도에 따른 생략은 없었다. 메서드 `JsonParser.readArray()`의 한국어·영어 구조와 34행 `MAX_NESTING_LEVEL`의 원문 위치를 확인했다.

| 단계 | 실제 upstream 라이브러리 테스트 | VS Code task |
| --- | --- | --- |
| 원본 | 452 pass, 0 fail, 0 ignored | passed, exit 0 |
| 고정 오류 `1000 → 1` | 439 pass, 13 fail, 0 ignored | failed, exit 1 |
| native undo·저장 | 452 pass, 0 fail, 0 ignored | passed, exit 0 |

Java diff를 열기 전과 후 원문은 같았고, 적용은 정확한 숫자 범위만 바꿨다. 자동 저장하지 않았으며 미저장 상태에서 프로젝트 검사는 거절됐다. 저장 후 실제 명령을 실행했다. 실패한 테스트는 원자료에 모두 남겼다. undo·저장 후 원본 해시와 깨끗한 Git checkout이 복구됐고 임시 tasks.json도 제거했다.

- 원본/복구 SHA-256: `fbb4b36589fbb6cd795aca555557aa7fcbe7fd2d7f04fcfac64e47aee5c1961e`
- 변경 SHA-256: `6d7982c6dd6e0bd70cacc1858ef980e5119d2ec9fe9fe2827b9d4a41359adfa8`
- JDK: Temurin `25.0.4.1+1-LTS`.

## 원래 빌드와의 차이·실패

upstream Maven 설정은 Java 1.5 target을 사용한다. 이 최신 JDK에서 그대로 수행한 Maven 빌드 성공으로 표기하지 않는다. 별도 adapter가 **변경하지 않은 main/test Java 파일 전부**를 `javac --release 8`로 컴파일하고, 원래 라이브러리의 모든 `*Test` 클래스를 JUnitCore로 실행했다. 별도의 성능 비교 모듈, OSGi 패키징, Maven 배포와 Java 1.5 API 호환 검사는 실행하지 않았다.

JUnit 4.12·Mockito 1.10.19와 전이 의존성 Hamcrest 1.3·Objenesis 2.1은 원래 버전을 사용한다. Maven Central의 SHA-1과 받은 파일을 대조했고 재현용 SHA-256을 [고정 목록](../../../scripts/fixtures/minimal-json/dependencies.json)에 기록했다. 실행 시 네트워크 다운로드하지 않으며 `--setup`에서만 명시적으로 받는다.

첫 실행은 하위 패키지의 테스트 이름을 평탄화해 `Mocking_Test` 클래스를 찾지 못했다. 패키지 상대 경로를 사용하도록 고쳤다. 다음 원본 실행은 447 pass·5 fail이었다. 오래된 Mockito가 JDK의 `java.io`에 접근하지 못한 오류와 spy 필드 초기화 실패였다. 이 **별도 테스트 JVM에만** `--add-opens java.base/java.lang=ALL-UNNAMED`와 `--add-opens java.base/java.io=ALL-UNNAMED`를 설정한 뒤 452개가 통과했다. 제품 파서의 JVM에는 이 설정을 넣지 않았다. 구형 source/target 경고도 원자료에 남겼다.

## 재현·판정 한계

[준비·재현 명령](../../../scripts/fixtures/minimal-json/README.md), [`scripts/test-java-source-project.mjs`](../../../scripts/test-java-source-project.mjs), [`extension/test/javaSourceProject.ts`](../../../extension/test/javaSourceProject.ts)를 사용한다. Node 24, 프로젝트 의존성, 빌드한 확장, JDK와 고정 checkout이 필요하다.

이 결과는 한 환경의 한 고정 오류를 실제 테스트가 발견하고 편집기에서 복구한 근거다. 모든 Java 프로젝트, 임의 변경, 모델 설명 정확도, JDK/OS 조합, 실행 성능 개선을 검증하지 않았다. 제품의 문법 파싱은 타입·의존성·실행 검사와 별개다.
