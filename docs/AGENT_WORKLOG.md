# 에이전트 작업 기록 · Agent work log

공개 개발 기록의 시작일: 2026-10-16. 완료된 작업과 예정 작업을 구별한다. 이 기록은 재현할 수 있는 작업 사실이며 에이전트의 비공개 내부 추론 기록이 아니다. 모델 출력·도구 로그에 개인정보나 비밀이 있으면 공개하지 않는다.

## 기존 작업의 확인 가능한 기준선

| 커밋/버전 | Git 이력과 파일로 확인 가능한 작업 | 근거와 한계 |
| --- | --- | --- |
| `d415f8b` / 0.6.0 | 현재 파일 편집기 오류·경고 연결, 일부 TypeScript 오류 뜻풀이, 원문 이동과 오래된 보고 처리 | [검증 기록](RELEASE_VALIDATION.md), [16개 통합 검사 원자료](extension-integration-0.6.json). 외부 프로젝트 검증·일반 AI 편집 미포함 |
| `cb44d87` | 공개 배포·CI·사용자 관찰 상태 점검, 출시 자료와 게시자 인계 문서 | [당시 공개 점검](LAUNCH_READINESS.md). 수요 검증 완료가 아님 |
| `7603971` | 영문 README의 오래된 버전 표기와 오류 알림 범위 수정 | Git diff와 [CI](https://github.com/him55710-sudo/pureobom/actions/runs/38844251809). 제품 기능 변화 없음 |

더 오래된 작업은 [CHANGELOG](../CHANGELOG.md), Git 이력과 버전별 검증 자료로 추적한다. 보존되지 않은 과거 실행 내역을 완전한 기록인 것처럼 재구성하지 않는다.

## 2026-10-16 · 제품 완성 계획 재정렬

- 사용자 요청: 유료 API 없이 다언어 코드 이해·수정·최적화, 실제 프로젝트 연동 검증, 공개 기획과 작업 내역. 홍보보다 제품 우선. Ollama 활용 허용.
- 조사: 현재 코드·확장 프로토콜·문서·Git 상태와 실행 환경 확인. 기준 커밋 `7603971`, 작업 트리 깨끗함. 이 PC에서 Ollama 명령·기본 설치 경로·모델 폴더를 찾지 못함. Python 3.12와 Node 런타임 사용 가능. 설치된 Ollama 추론을 검증한 것으로 세지 않음.
- 문서 작업: `PRODUCT_COMPLETION.md`, `LANGUAGE_SUPPORT.md`, 이 작업 기록을 작성. 기존 수요/모집 대기는 새 개발 계획의 선행 조건에서 제외.
- 설계 자료: Ollama 공식 [Chat API](https://docs.ollama.com/api/chat), [모델 목록](https://docs.ollama.com/api/tags), [구조화 출력](https://docs.ollama.com/capabilities/structured-outputs), [로컬 전용 설정](https://docs.ollama.com/faq), [Windows 독립 실행 CLI](https://docs.ollama.com/windows). 공개 API·스키마를 활용하고 반환값은 별도 검증할 예정.
- 다음 작업: 루프백 전용 전송, 로컬 모델 확인, 정확한 인용/변경안 검증, VS Code 검토 UI, 실제 Ollama 실행. 아래 기록에 실제 결과가 추가되기 전까지 구현·검증 완료로 세지 않음.

## 2026-10-16 · 로컬 AI의 첫 구현과 실제 프로젝트 검증

- **공개 계획:** 앞 절의 상세 계획·언어 표·작업 기록을 `68f5c51`로 커밋하고 공개 저장소에 push했다.
- **실행 환경:** 공식 Ollama v0.40.5 독립 실행 ZIP의 SHA-256 `5134ce7e3bc8e94d0494721c799ec293b429450d0c52461b0ee3647dd3bb4bb7` 확인. 검증 폴더에서 `OLLAMA_NO_CLOUD=1`, 루프백 11435로 실행. 서버 `/api/status`의 `cloud.disabled:true` 확인. `qwen2.5-coder:3b` 모델 digest는 원자료에 기록. 모델·바이너리는 Git에 포함하지 않음.
- **엔진과 전송:** `src/core/localAssistant.ts`, `extension/src/ollama.ts`. 한국어/영어 구조화 요청, 로컬 전용 상태와 모델 확인, 고정 루프백·리디렉션 거절, 크기/시간 제한, 취소, 원문 인용/수정 범위 검증을 구현. 모델의 셸 명령·도구 호출은 실행하지 않음.
- **편집기 연결:** `localAssistantController.ts`, 기존 controller/protocol/extension과 `LocalAssistant.tsx`. 현재 파일 명시, 모델 선택, 설명/수정/최적화 제안, 정확한 인용 선택, native diff, 명시적 다중 범위 적용과 undo. 문서가 바뀌면 제안 폐기. 지원하지 않는 문서로 이동하면 이전 파일의 AI 제안을 지움. 로컬 AI 명령 추가.
- **문법 확인:** `assistantValidation.ts`, `pythonValidation.ts`. JS/TS와 JSON의 제안 파싱, Python `-I -S`의 고정 ast.parse 프로그램. 사용자 파일 실행 없이 검사하며 도구가 없거나 검사하지 않은 언어는 미검증 표시. 의미·타입·성능 검사로 부르지 않음.
- **자동 검증:** `pnpm test` **147개 통과**, `pnpm extension:build`, `pnpm build` 성공. 실제 VS Code 1.96.4 통합 검사 **19개 통과**. 새 AI 통합 3개는 제어된 로컬 HTTP 응답을 사용하므로 실제 추론 검증과 분리. Python 테스트 재현을 위해 CI에 Python 3.12 준비 단계 추가.
- **실제 추론:** Python 배송 예제 설명 22.3초, 수정 17.6초. 실제 모델 응답과 확인된 인용/수정 범위는 [원자료](evidence/local-ai/README.md)에 공개. 한 사례를 모든 언어의 성능·정확성으로 일반화하지 않음.
- **외부 프로젝트:** BSD 라이선스의 Pallets itsdangerous 2.2.0, 고정 커밋 `096c8d42545d3b68ea21a4f890fb2b2d8979c0bd`. 별도 복사본·Python 가상환경·VS Code 프로필에서 `want_bytes` 변경 제안 → 원문 선택 → diff → 실제 적용·저장 → 변경 전후 pytest **각 297개 통과** → native undo·저장 → 원본 해시 복구. 모델 출력은 실제 Ollama에서 받았으며 upstream에 변경하지 않음. 재현 스크립트 `scripts/test-local-project.mjs`와 테스트 진입점을 추가.
- **발견·수정:** 첫 외부 결과는 위치가 실제인 import를 인용했지만 변경 근거로 부적절했고 설명도 부정확했다. '인용이 존재함'만으로 충분하지 않아 각 변경과 인용의 겹침을 요구하는 검사를 추가. 보강 전/후 자료 모두 남김. 보강 후에도 모델이 중복 타입 검사를 제안하는 품질 한계가 남음.
- **최적화 측정 실패:** 검토한 특정 변경만 실행하는 `scripts/benchmark-local-proposal.py`로 결과/예외/객체 동일성 10개와 15회×10만 호출을 검사. 문자열 입력에서 후보가 약 24~38% 느렸고 바이트 입력도 이 측정에서 개선되지 않아 **미채택**. 원본 프로젝트 유지. 일반 사용자용 성능 측정 기능을 구현했다고 주장하지 않음.
- **화면 확인에서 수정:** 새 '로컬 AI' 탭이 좁은 패널 오른쪽에 숨는 것을 실제 VS Code 화면에서 발견해 탭 줄바꿈 적용. 하단의 '모든 설명은 구문 기반' 문구도 로컬 모델 경로를 구분하도록 수정. Python에서 미분석 항목을 '기능 0개'로 보여 주던 통계를 숨기고 요청 가능 상태로 표시.
- **출력 언어 실패:** 한국어 화면에서 실제 3B 모델이 영어로 답함. 한국어 기본 요청·응답 언어 지시를 보강하고 설명 문구에 한글이 전혀 없는 경우 거절하도록 수정. 회귀 검사 추가. 재실행 응답은 한국어였지만 파일 주석만 요약해 설명이 부족했으므로 품질 성공으로 세지 않음. 원자료 공개.
- **배포 묶음 검사:** 개발판 VSIX를 만들며 `out/real-project.cjs` 테스트 코드 포함을 발견해 제외하고, 허용된 런타임 번들 외 파일이 들어오면 배포 검사가 실패하도록 보강. 다시 만든 VSIX를 별도 프로필에 설치 성공. 소스/데모/VSIX의 체크섬·구성·라이선스 검사 통과. 아직 공개 릴리스로 게시하지 않음.
- **설치본 실제 조작:** 한국어 UI에서 로컬 연결 → 배송 기준 70000 요청 → 실제 모델 응답 17.7초 → Python 문법 확인 → native diff → 확인란 → 적용 → 디스크 원본 해시 유지 → Ctrl+Z → 영문 UI 전환. [화면과 상세 기록](evidence/local-ai/installed-ui.md). 설명의 부정확한 시제와 적용 중 상태 안내 문제도 기록했고, 후자는 갱신 중 문구로 수정·빌드 확인.
- **남은 범위:** 여러 언어의 실제 모델·파서 검증, 모델의 설명 정확성, 여러 파일 변경, 실제 프로젝트 검사/성능 측정을 사용자가 실행할 UI, 추가 운영체제·모델 조합, 설치본과 공개 CI 확인. 이 작업으로 전체 제품 완성을 선언하지 않음.

## 2026-10-16 · 언어별 실제 응답과 설정 파일 지원 보강 (진행 중)

- **공개 증분:** 로컬 AI 첫 구현과 증거를 `3710ea1`로 push. [해당 SHA의 Verify](https://github.com/him55710-sudo/pureobom/actions/runs/38853005494)에서 Windows·Ubuntu 두 작업 성공 확인.
- **설명 누락 개선:** 기본 설명 요청을 파일 소개 대신 입력·조건·결과와 동작 코드 근거를 요구하도록 수정. Python 재실행에서 배송비 계산을 언급했지만 주요 조건 누락이 남아 있어 전체 정확성으로 세지 않음.
- **언어별 사례:** `examples/local-ai/`의 JS/TS/JSX/TSX, Go, Rust, Java, C#, HTML, CSS, SQL, JSON/JSONC와 기존 Python 예제, `cases.json`, `scripts/evaluate-local-languages.mjs` 추가. 실제 모델 응답과 예상 문자열을 비교하며 코드를 적용·실행하지 않음. Python의 `70_000`→`70000` 표기 차이 같은 의미상 허용 가능한 불일치도 원자료에 유지하고 별도 해석.
- **모델 비교 준비:** 공식 [qwen2.5-coder:7b](https://ollama.com/library/qwen2.5-coder:7b)를 같은 로컬 전용 서버에 다운로드. 다운로드 성공은 답변 품질 검증이 아님. 모델 파일은 공개 소스/VSIX에 포함하지 않음.
- **JSONC 구현:** `jsonData.ts`와 분석기·제안 검증·파일 선택·미저장 문서 확장자 연결을 수정. [Microsoft jsonc-parser](https://github.com/microsoft/node-jsonc-parser) 3.3.1을 고정 의존성으로 추가. AST의 구조만 읽으며 사용자 키를 JS 객체 속성으로 변환하지 않음. 부분 파싱 결과와 오류 목록을 구분하고, 주석·끝 쉼표·배열/스칼라·문자열 내부 URL·잘못된 표현을 검사. JSON은 기존의 엄격한 문법 유지.
- **발견한 배포 실패:** 단위 검사는 통과했지만 VS Code의 Worker가 `Cannot find module './impl/format'`으로 실패함. UMD 진입점의 간접 require가 번들에 남은 원인이므로 `build-extension.mjs`에서 ESM module 진입점을 선택하도록 수정. 통합 검사 실패 시 경로·상태·오류를 출력하도록 진단 개선. 이후 기존 TypeScript 진단 대기 제한에도 걸렸으며 성공으로 기록하지 않음; 재검증 예정.
- **문맥 예약:** 작은 파일에도 32768 문맥을 예약하던 전송을 입력 바이트+4096 출력+1024 형식 여유에 맞춰 8192/16384/32768 중 선택하도록 수정. 크기 제한을 넘기면 거절하며 입력을 자르지 않음. 아직 실제 속도 향상 수치를 주장하지 않음.
- **최종 자동 확인:** 핵심 검사 152개, 새 프로필의 실제 VS Code 통합 20개 통과. 미저장 JSONC의 주석·끝 쉼표·잘못된 편집·undo를 실제 Worker로 확인. 이전 프로필은 남은 Code 인스턴스와 충돌해 테스트 시작이 거절되기도 했으므로, `test-extension.mjs`가 매 실행 새 테스트 프로필을 만들도록 수정. 테스트 대기 시간을 늘려 실패를 숨기지 않음. [20개 검사 원자료](evidence/local-ai/vscode-jsonc-integration.json).
- **패키지 런타임 검사:** VSIX에 들어 있는 Worker를 임시 폴더로 꺼내 프로젝트 node_modules 경로 없이 실행해 JSONC 파싱을 확인. 파일 존재·체크섬 검사만으로 런타임 준비를 주장하지 않도록 `release:check`를 보강하고 CI에 묶음 생성·검사를 추가. 수정된 패키지 검사 성공.
- **28회 결과:** [원자료·의미 검토](evidence/local-ai/language-review.md). 수정 12건은 기대 문자열 일치, Python 1건은 동일 숫자 표기 차이, SQL 1건은 근거 불일치 거절. 설명 14건의 구조/원문 검증 통과와 의미 정확성을 구분했고 발견한 오류·누락을 기록.
- **7B CSS 비교:** 같은 파일을 실제 7B 모델에 요청. 3B가 잘못 설명한 3열과 화면 조건·간격을 올바르게 설명했으나 이 PC에서 109.7초 소요. 자동 문맥 16384가 요청과 서버 상태에서 확인됨. [원자료](evidence/local-ai/css-qwen-7b.json). 전체 모델 품질·속도 우열로 일반화하지 않음.
- **7B Python 비교:** 80.4초, 문맥 16384. 음수 ValueError·무료 배송 분기·기본 배송비 반환을 5개 원문 인용으로 설명. [원자료](evidence/local-ai/python-qwen-7b.json). 요약에서는 음수 예외가 생략돼 인용 설명까지 함께 검토해야 함.

## 2026-10-16 · 프로젝트 검사 명령을 제품에 연결

- **목적:** 모델이 적은 '확인할 항목'과 실제 프로젝트 테스트를 구별하고, 수정·저장 후 사용자가 실행 결과를 확인하도록 P4를 보강.
- **변경:** `extension/src/projectChecks.ts`, `extension/ui/ProjectChecks.tsx`, host 메시지·화면 상태 연결. 같은 프로젝트 폴더의 일회성 test/build process/shell 작업을 목록에서 선택하고 명령 검토 후 실행. 모델 응답은 실행 입력으로 사용하지 않음. 자동 저장 없음, 미저장 파일 차단, 실제 종료 코드·시각·파일 해시 기록, 관찰한 파일/설정 변경 시 오래된 결과 표시. 한 번에 한 작업, 명시적 취소와 10분 중단 요청. 실행할 때 선택한 명령의 fingerprint를 다시 비교. 환경 값은 host 안에서만 비교하며 출력·소스·환경을 자동 전송하지 않음.
- **범위:** 기존 task의 명령 하나만 새 실행으로 복사하며 dependsOn·runOn·감시 옵션은 실행하지 않음. 사용법과 파일 감시 제외·외부 환경·성능 측정 한계는 [PROJECT_CHECKS.md](PROJECT_CHECKS.md)에 명시. UI는 한국어·영어 모두 작성. React 스킬 기준으로 파생 상태·효과 정리·비동기 unmount/context 방어·레이블/상태 알림을 검토.
- **실제 외부 검사:** [itsdangerous 원자료](evidence/local-ai/itsdangerous-project-checks.json). 고정 커밋 2.2.0과 격리 Python 환경에서 새 기능으로 pytest 297개 통과. 검토한 고정 오류(`want_bytes`가 빈 bytes를 반환)를 편집기에 넣고 미저장 실행 차단 확인 → 저장 후 pytest `-x`가 5개 실행 중 1개 실패(exit 1) → native undo·저장 후 297개 통과. 최종 소스 해시와 Git 깨끗한 상태 확인. 모델 코드 실행이나 성공한 최적화 사례로 세지 않음.
- **검증 스크립트 실패:** 첫 외부 실행은 기준선 297개 통과 뒤 LF 문자열을 CRLF 파일에서 찾지 못해 중단. 원본은 보존됐으며 개행을 편집 범위에서 제외해 수정. task 내부 타입 등록 누락 경고도 실제 provider/schema 등록으로 해결.
- **실제 취소 버그:** `executeTask`의 반환 직후 취소하면 VS Code가 아직 프로세스를 등록하지 않아 'Task to terminate not found'가 발생하고 중단 대기에 남음. 실제 프로세스 시작 이벤트까지 취소 요청을 유지한 뒤 한 번만 terminate하도록 수정. 빠른 취소를 통합 검사에 유지.
- **TypeScript 검사 지연:** 실제 진단을 기다리는 기존 통합 검사가 세 번 25초 제한을 초과. 새 작업 폴더와 tsconfig 분리만으로 해결되지 않았음. 상세 tsserver 로그에서 앞선 가상 diff 문서들이 별도 inferred project로 열리고 프로젝트 갱신 요청이 지연되는 것을 확인. TSX diff를 `.ts`로 만들던 제품 오류를 고치고 해당 언어 식별자 검사를 추가. 테스트에서는 소유한 diff 탭을 닫고 실제 진단 대기를 60초로 변경. 시간 제한을 늘렸다는 사실과 원인을 함께 기록하며 성능 해결로 주장하지 않음.
- **재현:** `pnpm extension:build`, `pnpm extension:test`; 외부 Python 환경 준비 후 `node scripts/test-local-project.mjs --checks-only`. 일반 CI의 새 통합 검사는 자체 명령을 사용하고 실제 모델·외부 저장소는 요구하지 않음. 검증마다 작업 폴더와 사용자 프로필을 새로 생성.
- **추가 모델 응답:** [7B SQL 수정](evidence/local-ai/sql-qwen-7b.json)은 59.7초, 16384 문맥으로 정확한 인용과 기대 문자열 수정에 성공. SQL 실행·방언 호환성을 검증했다고 세지 않음.
- **남은 범위:** 모든 언어의 문법/타입 검사, 모델 설명의 의미 정확성, 사용자용 전후 성능 측정, 새 검사 UI의 설치본 조작·전체 실패 조합 검증. 이번 UI 자동화에서는 기존 개발 창이 최소화 상태이며 활성화 재시도도 실패해 새 화면 조작 성공을 주장하지 않음. 기존 로컬 AI 설치본 조작 기록은 앞선 버전의 별도 증거로 유지.
- **수정 후 통합 결과:** 2026-10-16 14:47 KST, 실제 VS Code **25개 통합 검사 통과**. TypeScript 실제 2322 진단, TSX diff 언어 보존, process/shell 종료, 빠른 취소 후 재실행, 미저장·중복 실행 거절, 다른 파일 변경으로 오래된 결과 표시, 백그라운드 제외, 변경된 명령 재검토를 확인. [원자료](evidence/local-ai/vscode-project-checks-integration.json). 로컬 빌드·타입 검사도 통과.
- **교차 운영체제 실패와 수정:** `75b1af2`의 [CI](https://github.com/him55710-sudo/pureobom/actions/runs/38857869088)는 Windows 성공·Ubuntu 실패. 실제 process 명령은 exit 0이었으나 결과가 오래된 것으로 표시됨. 무효화 이유를 기록한 `939f459`의 [재현](https://github.com/him55710-sudo/pureobom/actions/runs/38858101452)에서 `settings changed: terminal`을 확인. 모든 설정 이벤트를 변경으로 취급하던 코드를 실행 관련 설정의 실제 값 해시 비교로 변경. 작업 설정, 해당 OS의 환경·상속·locale, shell 작업의 프로필과 `${config:...}` 참조를 비교하며 값 자체는 출력하지 않음. 터미널 글꼴 변경은 결과를 무효화하지 않고 환경 변수 변경은 무효화하는 실제 검사를 추가.
- **Linux 셸 예제 수정:** `5f6de42`의 CI에서 Ubuntu의 첫 명령·설정 무효화·취소 검사는 통과했으나 shell 예제가 exit 2로 실패. 검증 예제의 `node -e process.exit(0)` 인수에 POSIX 셸의 괄호 해석을 막는 인용이 없었음. VS Code task의 명시적 `quoting: "strong"`을 사용해 수정. 제품은 셸 명령을 임의 변환하지 않고 사용자가 등록한 인용 설정을 보존한다. 실패 상태를 20초 뒤 시간 초과로만 보던 예제도 종료 직후 실제 상태를 확인하도록 개선.
- **최종 교차 운영체제 확인:** `a3e6f84`의 [Verify](https://github.com/him55710-sudo/pureobom/actions/runs/38858730263)에서 **Windows·Ubuntu 모두 성공**. 각 작업 로그에서 핵심 152개, 실제 VS Code 통합 25개, 웹/확장 빌드와 패키지 Worker 검증 성공을 확인. [CI 증거](evidence/local-ai/project-checks-ci.json). 로컬 VSIX·소스 ZIP·데모 ZIP도 생성하고 체크섬·라이선스·번들 독립 실행 검사 통과. 안정 릴리스 0.6.0과 구별한 0.7 개발판이며 공개 릴리스 태그를 새로 만들지 않았다. P4 첫 실행 연결은 검증됐고 P2 의미 정확성·P5 성능 측정 UI·P6 설치 화면 조작 조합은 계속 남아 있다.

## 2026-10-16 · 사용자용 전후 측정 연결

- **목적:** P5의 전후 시간·메모리·출력·검사 근거를 사용자가 확인할 수 있도록 구현. 최적화 제안을 실행 속도 개선으로 가정하지 않는다.
- **실제 변경:** `src/core/benchmark.ts`, `extension/src/benchmarks.ts`, `benchmarkRunner.ts`, `extension/runtime/benchmark.py`, `extension/ui/Benchmarks.tsx`. 기존 등록 process 작업을 재확인한 뒤 준비 1회 + 별도 프로세스 7회 실행. 시간 중앙값·관측 범위·MAD, OS 최대 프로세스 메모리, 출력 SHA-256, 동일 파일의 실제 검사 기록을 로컬 보고서로 제공. 한국어/영어 화면·명령 검토·명시적 실행·취소·JSON 문서 연결. [측정 정의와 한계](BENCHMARKS.md).
- **호스트 제약:** 같은 명령/인수/환경 설정/측정 도구/파일 경로를 다시 확인. 미저장 파일·중복 실행 거절, 검사와 측정 사이 실행 예약 공유, 진행 중 파일 변경으로 취소, 전후 사이 다른 파일·설정 변경으로 기준선 무효화. 대상 파일은 전후 사이에 수정 가능하며 후보 측정 후 추가 수정은 오래된 결과 표시. 출력이나 환경이 다르면 개선률을 계산하지 않음. 셸/배치/백그라운드/입력 변수 및 task 선행 의존성 미지원. 프로젝트 코드의 일반 사용자 권한 실행이며 샌드박스가 아님.
- **실제 프로세스 검증:** Windows에서 기록용 7회 실행, 실제 메모리 수집, exit 7 실패, 4 MiB 출력 한도, 없는 Python 안내, 이미 취소한 요청, 실제 30초 제한 확인. 취소 검사는 손자 프로세스의 파일 heartbeat가 멈추는 것까지 확인. 핵심 테스트 **161개 통과**. Node/Python 단위 검증과 실제 VS Code 검증을 구분한다.
- **통합 검사 준비 실패와 수정:** 첫 전체 실행은 이전 테스트가 복원한 tasks.json을 VS Code가 다시 읽기 전에 다음 작업을 준비해 '설정 변경'으로 거절됨. fixture의 설정·작업 목록 복원 대기를 추가. 다음 단독 검사는 닫힌 TextEditor 참조를 재사용해 실패해 매 편집마다 열린 편집기를 다시 받도록 수정. 변경 감지·재검토 조건을 약화하지 않음. 수정 후 새 측정 전용 VS Code 통합 **5개 흐름 통과**: 기준선/검토 조건, 실제 7회 측정, 파일 저장·검사 근거, 출력 불일치, 빠른 취소·재시작, 다른 파일 변경, 오래된 준비와 실패한 명령.
- **외부 검증 준비 실패:** [최초 기록](evidence/local-ai/itsdangerous-command-benchmark-setup-failure.json). 확장 활성화 뒤 만든 tasks.json의 지연 watcher 이벤트가 이미 실행 중인 pytest를 오래된 결과로 표시했다. 검증용 파일을 VS Code 시작 전에 생성하도록 옮겼고, 제품은 관찰한 변경을 계속 무효화한다. 최초 실패와 후속 성공을 함께 공개.
- **외부 결과와 발견:** 고정 itsdangerous에서 이전에 검토한 qwen2.5-coder:3b 제안 한 건만 재현했다. 새로운 모델 명령을 실행하지 않음. [첫 측정](evidence/local-ai/itsdangerous-command-benchmark-before-memory-fix.json)은 전후 pytest 297개·복구 후 297개 통과, 실행 시간 중앙값 1310.05 → 1494.12 ms(약 14.1% 증가). 다만 Windows 가상환경 python.exe가 실제 인터프리터를 별도 프로세스로 띄우므로 약 4.5 MiB 메모리는 실행기 자체의 값이었다. 이를 실제 Python 작업의 메모리로 해석하면 안 된다.
- **메모리 표시 수정·재검증:** Windows Python 가상환경 실행기와 pyvenv.cfg를 식별하면 메모리 값을 제외하고 화면·보고서에 사유를 남기도록 수정. [Python 문서](https://docs.python.org/3.12/library/venv.html)와 [CPython 실행기](https://github.com/python/cpython/blob/main/PC/venvlauncher.c) 확인. [수정 후 실제 기록](evidence/local-ai/itsdangerous-command-benchmark.json): 전후·복구 후 각 **297개 통과**, 10개 고정 입력/예외/객체 동일성 확인 후 500만 문자열 호출, 전후 각 7회. 시간 중앙값 **1223.69 → 1482.34 ms(약 21.1% 증가)**, 범위 1204.94–1318.73 / 1372.27–1688.70 ms, 출력 일치. 해당 실행의 메모리는 확인 불가로 표시하며 0으로 세지 않음. 제안 미채택·원본 해시 복구·외부 Git 깨끗한 상태 확인. 전후 순차 실행·프로세스 시작 비용 포함이므로 앞선 함수 단위 교대 측정과 수치를 직접 비교하지 않음.
- **공개와 재현:** `scripts/measure-itsdangerous.py`, `node scripts/test-local-project.mjs --benchmark-only`. 원자료의 로컬 경로만 `<workspace>`로 정규화. 보고서에 개인정보·환경 변수 값·원시 성공 출력은 포함하지 않음. 실패와 메모리 해석 오류 자료는 삭제하지 않고 한계를 붙여 보존.
- **검토·남은 범위:** React 스킬 기준으로 폼 레이블, 비동기 unmount/context 방어, 상태 파생, 오류/진행 표시, KO/EN 문구를 검토. 다만 새 화면의 설치본 클릭·키보드·다양한 크기 실제 조작을 완료했다고 세지 않음. 임의 자식 트리 전체 메모리, 모든 언어 도구, 모델 의미 정확성, 외부 입력 고정·통계적 유의성은 보장하지 않음. 전체 P0–P6 완료 보고가 아니다.
- **전체 로컬 검증:** 2026-10-16 15:44 KST, 핵심 161개·실제 VS Code 통합 30개 통과. [통합 원자료](evidence/local-ai/vscode-benchmark-integration.json). 웹 빌드·확장 빌드·VSIX/ZIP 생성·체크섬/라이선스·독립 추출한 분석 Worker 및 Python 측정 Worker 실행 검사 통과. 0.7 개발판이며 공개 0.6.0 릴리스 태그를 교체하지 않았다.
- **교차 운영체제 확인:** `d819c49`를 공개 저장소에 push했고 [Verify 실행](https://github.com/him55710-sudo/pureobom/actions/runs/38863193178)의 Windows·Ubuntu 작업이 모두 성공했다. 각 로그에서 핵심 **161개**, 실제 VS Code 통합 **30개**, 추출한 분석 Worker와 Python 측정 Worker 실행 성공을 확인. [정규화한 CI 원자료](evidence/local-ai/benchmark-ci.json). 실제 모델·외부 프로젝트 자료는 별도이며 설치본의 새 UI 직접 조작까지 검증했다고 주장하지 않는다.

## 2026-10-16 · 새 VSIX 설치·언어 전환·입력 상태 검증

- **설치 검사 구현:** `scripts/test-extension.mjs --installed` / `pnpm extension:test:installed`. 매번 새로운 프로필과 확장 폴더에 VSIX를 CLI로 설치. 별도의 최소 테스트 드라이버만 개발 확장으로 실행하고, 제품은 설치 경로·버전·production 모드·실행 파일 5개의 SHA-256을 검증한다. 기존 실제 VS Code 30개 흐름을 설치본에서도 실행한다. CI의 Windows/Ubuntu에 추가했고 통합 JSON을 별도 artifact로 보존한다.
- **준비 실패:** `vscode.Extension`에 `extensionMode` 속성이 있다고 가정한 첫 빌드는 TS2339로 실패. 실제 활성화의 `ExtensionContext.extensionMode`를 반환하고 그 값을 검사하도록 고쳤다. 테스트 프로필에 확장 자동 갱신을 끄는 설정을 추가해 미등록 개발 게시자의 Marketplace 조회를 피한다. 사용자 프로필은 변경하지 않음.
- **UI 수정:** `LocalAssistant.tsx`, `main.tsx`. 안내를 선택 언어에 맞춰 표시하고 생성 결과의 언어를 보관. 언어 전환 시 진행 요청 취소, 늦은 결과 무시, 다른 언어의 이전 응답 숨김과 재요청 안내. HTML `lang` 동기화. 큰 파일/미지원 파일을 설명 가능·분석 완료로 오해하게 만드는 헤더 문구 수정. React 스킬 기준으로 파생 상태, 비동기 응답과 unmount, 효과 정리, 상태 안내와 레이블을 검토.
- **실제 설치 화면:** [상세 관찰](evidence/local-ai/installed-ui-states.md). 새 VSIX의 한국어/영어 연결 안내, 생성 중 언어 변경→취소→재요청, 완료된 다른 언어 응답 숨김, 29,402바이트 파일 요청 비활성화, 미지원 파일 전환 시 이전 결과 제거를 확인. 약 350px 패널에서 조작. 네이티브 메뉴/화면 밖 버튼의 입력 실패는 재관찰 후 키보드·스크롤로 해결했으며 제품 요청 성공으로 세지 않음.
- **실제 모델 품질:** 7B 영어 요청은 취소 검증에 사용. 3B 한국어 설명은 32.6초로 완료됐지만 상수 한 곳만 인용하고 음수 예외·기본 반환 분기·비교 코드가 빠짐. 코드에 명시되지 않은 원 단위도 붙임. UI 통과와 의미 정확성을 분리하고 후속 P2 개선 대상으로 기록. 영어 모델 설명의 품질이 검증됐다고 주장하지 않음.
- **로컬 검증:** 핵심 **161개**, 웹/확장 빌드 통과. 초기 설치본과 헤더 수정 후 설치본에서 각각 실제 VS Code **30개** 통과. 최종 [설치 통합 원자료](evidence/local-ai/installed-vsix-integration.json)는 VSIX `5912f6a3…`와 production 모드를 기록한다. 네이티브 화면의 VSIX `afad9ed1…`는 헤더 후속 문구 수정 전이며 동일 증거로 혼동하지 않는다. `docs/benchmark.json`은 이 회귀 검사 때 다시 측정된 합성 파서 기록이며 제품 전반의 속도 개선 증거가 아니다.
- **공개 상태:** 구현과 지원 표 수정이 로컬 커밋 `2941b8e`에 저장된 것을 확인했다. 이 기록과 원자료는 후속 커밋으로 함께 공개한다. 공개 안정 릴리스는 여전히 0.6.0, 이번 소스와 VSIX는 0.7 개발판이다. 전체 P0–P6 완료가 아니며 연결 실패/빈 모델 목록의 네이티브 화면, 추가 환경·언어 조합과 의미 품질 검토가 남는다.
