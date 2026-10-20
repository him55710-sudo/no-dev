# Go AST·수정·외부 프로젝트 검사

2026-10-16, Windows · Go 1.27.2 · VS Code 1.96.4. [원자료](go-source-project.json). 모델 응답이나 자동 최적화 사례가 아니다. 인용된 원문은 [Google UUID BSD 라이선스](GOOGLE_UUID_LICENSE.txt)를 따른다.

대상은 [Google UUID v1.6.0](https://github.com/google/uuid/tree/0f11ee6918f41a04c201eceeadf612a377bc7fbc), 커밋 `0f11ee6918f41a04c201eceeadf612a377bc7fbc`의 `uuid.go`다. 실제 VS Code에서 Go AST로 함수·조건·여러 반환식·반복을 읽고 원문으로 이동했다. `ParseBytes`의 한국어/영어 설명과 선택 범위를 JSON에 보존했다. 표시 한도에는 도달하지 않았다.

`ParseBytes`의 `for i := 0; i < 32; i += 2`에서 **0 하나만 2로 바꾸는 의도한 오류**를 준비했다. 처음 바이트 처리를 건너뛰므로 좋은 수정안으로 제안한 것이 아니다. Go diff → 적용 → 저장 → 실제 프로젝트 테스트 → undo·저장 → 재검사를 실행했다.

| 상태 | pass | fail | skip | task 종료 |
| --- | ---: | ---: | ---: | ---: |
| 원본 | 201 | 0 | 1 | 0 |
| 초기값 0 → 2 | 200 | 1 | 1 | 1 |
| undo·저장 후 | 201 | 0 | 1 | 0 |

개수는 `go test -mod=readonly -count=1 -json ./...`가 출력한 이름 있는 테스트와 하위 테스트의 종료 이벤트다. 실패한 이름은 `TestUUID`다. 실행마다 이전 JSONL을 지워 오래된 출력을 재사용하지 않았다. 제품은 task 종료 코드·파일 해시·변경 여부를 기록하며 검사 harness가 새 출력에서 개수를 읽는다. 이 실행 시간을 성능 개선 수치로 비교하지 않는다.

미리보기는 원본을 바꾸지 않았고 적용도 자동 저장하지 않았다. 미저장 상태의 검사 실행은 거절됐다. 원본/복구 SHA-256은 `707a63232670b23c8bb7e90fc4cbbfdaf0d2bff6a17734943fa0c476f182a741`, 변경본은 `1d18b31f80fd3936266e28ca01e2f58839e55d15c5c33fd722bc884b9b0a9208`다. Windows checkout의 CRLF 원문을 유지한 해시다. 종료 후 git 작업 트리는 깨끗했고 upstream에는 변경을 보내지 않았다.

재현: Go SDK와 저장소 개발 의존성을 준비하고 `git clone --depth 1 --branch v1.6.0 https://github.com/google/uuid.git test-results/projects/google-uuid`, `pnpm extension:build`, `node scripts/test-go-source-project.mjs`를 실행한다. PATH가 아니라 별도 SDK를 쓸 때는 `PUREOBOM_TEST_GO`에 실행 파일을 지정한다. Linux에서 그래픽 세션이 없으면 `xvfb-run -a`를 사용한다. 실제 외부 프로젝트 기록은 Windows이며 Linux에서도 이 사례를 실행했다고 주장하지 않는다.

검사 스크립트는 정확한 커밋과 깨끗한 checkout을 확인한다. 별도 프로필을 만들고 임시 tasks.json은 없을 때만 VS Code 시작 전에 생성하며 종료 시 제거한다. 실패해도 대상 파일은 원본으로 복구한다. 테스트 명령은 사용자 코드 실행을 포함하며 Go 읽기 helper의 비실행 범위와 구별된다. 테스트 캐시 재사용과 모듈/툴체인 자동 다운로드는 비활성화했다.
