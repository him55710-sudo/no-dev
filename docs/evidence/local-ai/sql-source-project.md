# 실제 sqlc SQLite 예제 · 2026-10-16

[원자료](sql-source-project.json) · [재현 방법](../../../scripts/fixtures/sqlc/README.md) · [MIT 라이선스](SQLC_LICENSE.txt)

외부 저장소 [sqlc-dev/sqlc](https://github.com/sqlc-dev/sqlc/tree/c69308b521a50f92fee48ae623702c5550c49d95)의 커밋 `c69308b521a50f92fee48ae623702c5550c49d95`, `examples/authors/sqlite/query.sql`을 사용했다. Windows·VS Code 1.96.4·Go 1.27.2·공식 sqlc 1.31.1, 원래 Go 모듈의 `github.com/ncruces/go-sqlite3 v0.35.6` 및 고정 WASM 의존성이다.

SQLite를 명시적으로 선택하고 한국어/영어 설명, 리터럴 범위와 원문 줄 이동을 확인했다. 모델·API 추론은 사용하지 않았다.

| 상태 | 실제 작업 | 원래 TestAuthors |
| --- | --- | --- |
| 원본 | SQLite 코드 재생성, 원래 Go 테스트 | 1 pass / exit 0 |
| 고정 오류 | `LIMIT 1 → LIMIT 0`, native SQL diff·적용·저장 후 같은 명령 | 1 fail / exit 1, `sql: no rows in result set` |
| 복구 | 편집기 undo·저장·재생성·재검사 | 1 pass / exit 0 |

원본·복구 SQL SHA-256은 `229bed6489f38068b4f9fc425f702ca71cca2ce4167468686e3e60a07ad2adc7`로 일치했다. 깨끗한 checkout도 확인했다. 편집기 적용은 자동 저장하지 않았고 저장 전 검사는 거절됐다. 매 작업 후 생성된 Go 파일 3개를 byte 단위로 복구했다. 원자료의 `<workspace>`/`<temp>`는 로컬 경로를 가린 표기다.

원래 sqlc 설정에는 다른 DB와 cloud 항목이 있어 SQLite schema/query/Go 생성 항목만 담은 임시 로컬 설정을 사용했다. 원본 쿼리·스키마·Go 테스트·assertion은 수정하지 않았다. 생성된 Go 상수만 직접 바꾸거나 테스트 캐시를 재사용하지 않았다.

준비 실패: 저장소 루트의 `go test ./examples/authors/sqlite`는 별도 examples 모듈을 찾지 못했다. examples 모듈로 옮긴 뒤 sparse checkout에 빠진 `internal/migrations`도 추가해야 했다. 이후 원래 의존성과 테스트로 실행했다.

한계: TestAuthors는 작가 한 명의 생성·조회와 오류를 확인한다. 반환 필드 전체·모든 CRUD 경계·성능을 assert하지 않으며 sqlc 전체 검사도 아니다. **문법이 맞아도 잘못된 동작이 생길 수 있고 프로젝트 검사가 이를 잡는다는 한 사례**다. 최적화 성공·모델 정확성·다른 SQL 방언 인증으로 쓰지 않는다.
