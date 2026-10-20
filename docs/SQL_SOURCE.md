# SQL 원문 읽기·수정 · SQLite source reading

0.7 개발 소스의 기능이다. 공개 안정 0.6.0과 Pages 데모에는 아직 배포하지 않았다. 모델·유료 API·DB 연결 없이 **선택한 SQLite 문법의 구조와 적힌 값**을 읽는다. 모든 SQL 방언이나 실제 데이터베이스 동작을 검증하는 기능은 아니다.

## 사용 흐름

1. VS Code에서 `.sql` 파일을 열고 **풀어봄: 현재 파일 설명 열기**를 실행한다. 개발용 브라우저에서는 SQL 파일을 가져온다.
2. 문장으로 읽기에서 **이 파일의 SQL 방언 → SQLite**를 선택한다. 기본은 선택하지 않음이며 다른 파일에 자동 적용하지 않는다. VS Code 선택은 열린 문서에만 유지되고 재시작하면 다시 선택한다. 브라우저 선택은 가져온 파일과 함께 로컬 작업 공간에 저장한다.
3. 구조·조건·원문 줄을 확인하고 숫자나 일반 작은따옴표 문자열의 **바꾸기**로 변경안을 만든다. 숫자는 단위 없는 SQLite 표기, 문자열은 내용만 입력한다.
4. diff를 확인한 뒤 적용한다. VS Code 편집기만 바뀌고 자동 저장하지 않는다. Ctrl+Z로 되돌릴 수 있다. 파일이나 방언이 바뀌면 이전 제안은 무효다.
5. 실제 동작은 저장 후 [프로젝트 검사](PROJECT_CHECKS.md)에서 검토한 명령으로 확인한다. 원문 파서는 DB 연결·쿼리 실행을 자동 수행하지 않는다.

## 범위와 한계

- MIT 라이선스의 `sqlite3-parser` **0.7.1**을 포함한다. 문법 기준은 **SQLite 3.53.0**이며 숫자 `_` 구분자를 명시적으로 활성화한다. 설치된 엔진 버전과 컴파일 옵션은 알아내지 않는다.
- SELECT/INSERT/UPDATE/DELETE, 일부 DDL·트랜잭션, CTE, 결합, CASE/ELSE, WHERE, GROUP BY/HAVING, ORDER BY, LIMIT/OFFSET, 함수 호출식·열 선언을 부분적으로 표시한다. 문장 구조는 실행 순서·쿼리 계획이 아니다. 이름과 식은 원문을 보존하며 모든 식을 자연어로 번역하지 않는다.
- 지원하지 않는 최상위 문장은 원문 확인으로 표시한다. 테이블·열·함수의 존재, 바인딩, 자료형 변환, 제약, 트리거 효과, 반환값·성능은 미검증이다. **파싱 성공은 DB 실행 성공이 아니다.** PostgreSQL·MySQL·SQL Server 등은 전용 분석을 제공하지 않는다.
- 숫자를 JS Number로 변환하지 않아 큰 정수·지수·소수·부호·16진수·구분자를 보존한다. SQLite 자체의 범위·반올림·형 변환을 보장하는 것은 아니다.
- 문자열의 `'`를 `''`로 인코딩한다. 수정 후 전체 원문을 다시 파싱하고 동일 위치·종류의 리터럴 하나인지 확인한다. 숫자 자리에 식·주석·추가 SQL을 넣는 입력은 거절하며 나머지 원문은 재출력하지 않는다.
- 식별자, 매개변수, NULL, TRUE/FALSE 이름, blob, 부호와 숫자 사이에 주석/공백이 있는 값은 직접 수정 대상이 아니다. 일반 작은따옴표 문자열만 지원한다.
- 한도: NUL 없는 **128KiB** 파일 전체, AST 탐색 **400개·12단계**, 수정 값 **300개**, 입력 **4096자**. 큰 파일 일부만 잘라 문법 통과로 표시하지 않는다. 표시 생략을 안내한다. 위치는 UTF-16, 물리적 LF/CRLF/CR 줄 기준이다. SQL `--` 주석은 LF까지 이어지므로 CR만으로 끝나지 않는다.
- 로컬 AI 제안도 SQLite를 선택해야 같은 문법 검사기를 사용한다. 미선택은 미검증으로 남는다. 모델 응답의 의미 정확성이 개선됐다는 증거는 아니다.

## 검증과 재현

`tests/sql-source.test.ts`의 9개 검사는 방언 캐시, Unicode/개행·주석 뒤 문장 위치, 구조, 두 LIMIT 표기의 count/offset, 큰 숫자, 문자열 인코딩, 잘못된 수정, 표시 한도와 한국어/영어 렌더링을 다룬다. Node 24.19.0의 실제 `node:sqlite` 3.53.3 인메모리 DB로 문자열 속 SQL 비실행과 64비트 정수 보존도 확인했다. 이 엔진은 제품에 포함하지 않는다.

`extension/test/sqlSource.ts`는 실제 VS Code의 방언 선택·원문 이동·SQL diff·수정·재분석·undo와 제안 무효화를 검사한다. AI 통합은 통제된 HTTP 응답이며 실제 모델 검증과 별도다. `release:check`는 저장소 밖에 추출한 Worker에서 SQLite 파서를 실행한다.

[외부 sqlc SQLite 예제](evidence/local-ai/sql-source-project.md)는 공식 sqlc 재생성과 원래 Go 테스트로 통과→고정 오류 실패→undo 후 통과를 확인했다. [재현 방법](../scripts/fixtures/sqlc/README.md). [설치본 실제 화면](evidence/local-ai/sql-source-native.md)에서 한국어/영어 구조 설명과 한국어 숫자 수정·diff·적용·Ctrl+Z를 확인했다. 좁은 화면·접근성 전체 검토, 브라우저의 실제 SQL 가져오기 조작과 다른 DB 방언은 남아 있다.

기능 커밋 `3b1aa4d`의 [Windows·Ubuntu CI](https://github.com/him55710-sudo/pureobom/actions/runs/38899949436)는 각 핵심 217개, 개발/설치 통합 각 43개를 통과했다. [원자료](evidence/local-ai/sql-source-ci.json)는 production 모드·런타임 8개 해시·추출 도구 5종을 포함한다. 실제 모델 추론이나 외부 sqlc 테스트를 이 수에 합치지 않는다.

```sh
pnpm exec vitest run tests/sql-source.test.ts
pnpm extension:build
pnpm extension:test
pnpm extension:package
pnpm extension:test:installed
pnpm release:package
pnpm release:check
```

English: Select SQLite explicitly for each SQL file. The bundled parser reads partial structure and edits ordinary numeric/single-quoted literals without a model, API or DB connection. It does not execute SQL, validate schema or prove behavior/performance. Full-source reparse and exact-range checks preserve surrounding text. Unsupported dialects remain unverified.

Primary references: [parser repository](https://github.com/justjake/sqlite3-parser-js), [SQLite expressions](https://www.sqlite.org/lang_expr.html), [SQLite comments](https://www.sqlite.org/lang_comment.html).
