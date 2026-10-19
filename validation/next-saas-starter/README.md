# 외부 Next.js 앱의 설계 변경 검증

배포되는 코드 발췌의 [upstream MIT 라이선스](LICENSE.upstream.txt)는 아래 고정 커밋의 원문을 보존한다. 공통 사용자 검토 자료는 [관찰 계획](../../docs/USER_STUDY.md)에 따라 생성하며, 새로운 모델 실행이나 참가자 결과를 뜻하지 않는다.

대상은 [Next.js SaaS Starter](https://github.com/nextjs/saas-starter/tree/6e33e58b1e553a41fe22e6b941a7229a002de361)의 고정 커밋 `6e33e58b1e553a41fe22e6b941a7229a002de361`이다. upstream은 MIT 라이선스이며 Vercel의 저작권 고지를 유지한다. 앱을 새 합성 예제로 대체하지 않는다. 실제 `app/(login)/actions.ts`, 팀 조회 API, 대시보드 React 컴포넌트, JWT, Drizzle, 원본 SQL migration을 사용한다.

이 upstream에는 테스트 명령이 없어서 **독립 인수 검사 환경을 추가**한다. 이를 upstream의 기존 검사로 설명하지 않는다. `prepare.mjs`는 `package.json`과 `pureobom-validation/`만 만들고 앱 구현을 바꾸지 않는다. 원본 패키지 설치와 추가 검사 도구 설치는 풀어봄의 `node_modules`를 찾을 수 없는 별도 디렉터리에서 수행한다. pnpm 패키지 캐시는 재사용할 수 있지만 다른 프로젝트의 설치 폴더를 연결하지 않는다.

## 확인할 변경

현재 팀의 owner만 팀 구성원을 초대·제거할 수 있다. member는 조회하고 제한 이유를 확인할 수 있다. 계정 전체의 `users.role`이나 다른 팀의 owner 권한이 현재 팀의 `team_members.role`을 대체할 수 없다. 직접 서버 액션 호출도 같은 정책을 사용한다. 정상 owner의 브라우저 FormData 요청은 동작해야 한다.

고정 인수 검사 9개는 실제 팀 조회, member의 두 변경 거절과 데이터 보존, owner의 두 변경 허용, 다른 팀 대상 거절, 미인증 거절, 양쪽 역할의 React 화면을 확인한다. 일반 검사 통과를 새로운 제품의 모든 요구사항 충족으로 해석하지 않는다.

## 2026-10-20 설치 UI 전체 흐름

[실행 기록](../../docs/INSTALLED_NEXT_FLOW.md)은 실제 Codex가 설치 화면에서 시작한 설계에 따라 7개 파일을 변경하고, 제품 독립 검사·기준별 검토·반영·새 파일 재수집·되돌리기까지 완료한 사례다. 같은 후보를 독립 설치한 복제본에서 고정 검사 9개·추가 권한 21개·기존 기능 회귀 18개·타입 검사와 실제 브라우저/PostgreSQL로 확인했다. 분석 파일 수는 52→55→52로 변했고 설계 목표와 원본을 보존했다. 네이티브 Webview 전달, production build와 운영 인증/결제 전체는 별도 미검증이다.

후속 [실제 Codex 재연결 검증](../../docs/MANAGED_LIVE_CODEX.md)은 Windows의 승인 대기 중 편집기를 종료하고 같은 프로세스·작업·승인을 이어받았다. 다른 후보 8개 파일의 검사·검토·반영·undo, 고정 9개·타입 검사와 추가 실행한 50개 검사(고정 9개 포함)를 확인했다. 이 후보의 앱 브라우저 동작은 앞선 후보의 증거와 구분해 미확인으로 남겼다.

## 2026-10-16 실행 결과

[원본 기준](../../docs/evidence/system-workspace/2026-10-16/external-next-baseline.json)은 9개 중 5개 통과·4개 실패, skip 0개였다. [준비 patch](../../docs/evidence/system-workspace/2026-10-16/external-next-baseline.patch)는 검사 환경·잠금 파일만 추가하며 앱 코드는 그대로다.

[실제 모델 실행](../../docs/evidence/system-workspace/2026-10-16/external-next-validation.json)에서 기존 앱 소스 50개를 분석해 작업을 만들었고, UI·서버 액션·팀 조회·공통 권한·추가 검사/설정의 **6개 파일**이 바뀌었다. 제품이 직접 실행한 고정 검사 **9/9**, 타입 검사, 검토자가 별도로 실행한 추가 회귀 검사 **25/25**가 통과했다. 고정 검사 두 파일·선택한 명령·잠금 파일은 바뀌지 않았다. [실제 변경 내용](../../docs/evidence/system-workspace/2026-10-16/external-next-change-review.json)을 확인할 수 있다.

검토자는 이 검증을 수행한 Codex 에이전트이며 사람의 사용성 시험이 아니다. 파일 범위·추가 검사 내용을 확인하고, 브라우저 상호작용·인증/계정/결제 전체 회귀·의존성 설치 명령의 독립 기록은 **미확인으로 보존**했다. 이 조건을 명시적으로 수락한 임시 원본에서 반영→기존 코드의 변경 감지→되돌리기→기준 복원·Git clean까지 통과했다. 현재 드라이버의 반영 후 분석은 baseline 파일 집합을 사용하며 새 파일 전체의 재수집까지 입증하지 않는다.

별도 [Next HTTP 실행](../../docs/evidence/system-workspace/2026-10-16/external-next-http.json)에서는 실제 개발 서버의 팀 API가 임시 세션·SQL 데이터로 200을 반환했다. 서버와 DB는 종료했다. Windows·Ubuntu 제품 CI도 [수정 커밋](https://github.com/him55710-sudo/no-dev/actions/runs/38888491018)에서 모두 성공했으나 외부 모델 실행은 CI에 포함되지 않는다.

## 재현

Node 24, pnpm 11.25.0, Git을 사용한다. `<external>`은 다른 프로젝트의 `node_modules` 아래에 있지 않은 새 폴더여야 한다. 저장소의 문서·의존성·실행 명령은 먼저 검토한다.

1. `git clone https://github.com/nextjs/saas-starter.git <external>` 후 해당 폴더에서 `git checkout --detach 6e33e58b1e553a41fe22e6b941a7229a002de361`.
2. 해당 폴더에서 `pnpm install --frozen-lockfile --ignore-scripts`로 upstream 잠금 파일을 검증한다.
3. 풀어봄 저장소에서 `node validation/next-saas-starter/prepare.mjs <external>`.
4. 외부 폴더에서 `pnpm install --ignore-scripts`. 이 단계는 테스트 의존성을 추가하므로 잠금 파일을 갱신한다. 실행 증거에 보존한 baseline patch를 사용하면 그 실행의 잠금 파일을 그대로 재현할 수 있다.
5. 외부 폴더에서 `pnpm test`와 `pnpm run typecheck`. 원본은 새 인수 기준을 아직 충족하지 않으므로 실패를 기록한다. 실제 실패와 검사 준비 자체의 오류를 구별한다.
6. 외부 폴더의 준비 파일을 로컬 Git 커밋으로 보관한다. upstream에 push하지 않는다.
7. 풀어봄 저장소에서 `PUREOBOM_RUN_CODEX=1`, 필요하면 `PUREOBOM_CODEX_PATH`를 설정하고 대화형 터미널로 `node scripts/test-external-design.mjs <external>`.

실제 모델 사용 단계는 외부 모델 전송과 실행이 명시적으로 선택된 경우에만 실행한다. 일반 CI에 자동으로 넣지 않는다. 에이전트가 분리 작업 복사본에 의존성을 설치하고 UI·서버 액션·필요한 공통 정책을 바꾸게 한다. 승인 요청은 출력된 내용을 읽고 기존 CLI 검증과 같은 `{ "id": "...", "decision": "accept" }` 형식으로 응답한다.

독립 검사가 끝나면 실제 diff와 출력, 범위 밖 파일을 확인한다. 출력된 `decisionTemplate`에 기준별 결과·근거와 필요한 경로 확인을 작성하여 `{ "action": "review", "decision": ... }`로 전달한다. 스크립트는 검토 기록 저장, 원본 반영, 재분석의 변경 감지, 되돌리기, 기준 복원과 원본 Git 상태를 검사한다. 설계 목표는 유지한다. 실행 기록은 외부 폴더 옆 `implementation-runs/run-*/report.json`에 남는다.

별도의 준비된 임시 복사본에서 `node validation/next-saas-starter/serve.mjs <external>`을 실행하면 실제 Next 개발 서버와 임시 SQL DB를 켜고, 서명한 테스트 세션으로 `/api/team`을 HTTP 호출한다. 팀·멤버 결과를 검증한 뒤 해당 프로세스와 DB를 종료한다. Next는 시작하면서 `.next`를 만들고 `tsconfig.json`을 자동 수정할 수 있으므로 실제 사용자 프로젝트나 진행 중인 구현의 원본에서 함께 실행하지 않는다. 이는 production build 성공을 뜻하지 않는다.

### 실제 브라우저 확인

브라우저 모드는 실제 PostgreSQL 실행 파일이 있는 폴더를 `PUREOBOM_TEST_POSTGRES_BIN`으로 지정해야 한다. 예를 들어 PowerShell에서 `$env:PUREOBOM_TEST_POSTGRES_BIN = 'C:\path\to\pgsql\bin'`을 설정한다. `initdb`, `pg_ctl`, `postgres`를 사용해 새 임시 클러스터를 만들며, 기존 DB나 시스템 서비스를 사용하지 않는다. 무작위 비밀번호의 SCRAM 인증과 `127.0.0.1` 바인딩을 사용하고 종료 시 해당 클러스터만 중지한다. 실행 파일은 저장소나 VSIX에 포함하지 않는다.

`serve.mjs <external> --interactive`는 HTTP 시작 검사가 통과한 뒤 서버를 유지한다. 출력된 `/sign-in` 주소와 합성 계정으로 실제 로그인·대시보드를 조작할 수 있다. `member@fixture.invalid`는 현재 팀 member이면서 계정 전역 role이 owner이고, `owner@fixture.invalid`는 현재 팀 owner이면서 계정 전역 role이 member이다. 출력된 비밀번호는 임시 DB에만 쓰는 테스트 값이다. 실제 계정이나 결제를 연결하지 않는다.

터미널에 `snapshot`을 입력하면 구성원·초대·활동 로그의 SQL 상태를 기록한다. `stop`은 마지막 상태를 `<external>`의 상위 폴더 `next-browser-report.json`에 저장하고 서버와 DB를 종료한다. 60분 후에도 종료한다. 보고서는 SQL 기록과 HTTP 시작 검사만 증명하므로 실제 브라우저의 버튼 상태·로그인·요청 결과는 별도의 DOM 관측과 스크린샷으로 남긴다. 이 모드 역시 Next의 자동 파일 변경이 가능한 별도 임시 복사본에서 사용한다.

[설치 설계 화면 드라이버](../../docs/INSTALLED_DESIGN_UI.md)에 준비한 로컬 Git 저장소를 전달하면 실제 모델 변경을 설치 UI에서 시작할 수 있다. 원본 소스의 복제본을 만들고, 되돌리기 후에도 보존되는 `.pureobom/` 설계 메타데이터만 복제본의 `.git/info/exclude`에 추가한다. 앱의 추적 파일·잠금 파일·HEAD·index 보존 검사는 그대로 유지한다. 이 Git 제외 설정을 앱 원본의 변경이나 설계 삭제로 구현하지 않는다.

2026-10-17에는 저장된 실제 모델의 변경 후보를 별도 복사본에서 실행했다. 고정 검사 9개·추가 검사 22개·타입 검사와 PostgreSQL 18.6에서 실제 로그인, member 화면 제한, owner의 초대·제거 및 SQL 상태를 확인했다. 설치 UI에서 시작한 해당 모델 작업은 Windows의 긴 실행 파일 경로 문제를 수정하다 시간 초과로 실패했다. 이 별도 앱 검증을 설치 UI의 검토·반영·undo 성공으로 합치지 않는다. [실패·브라우저 검증과 경로 수정 기록](../../docs/EXTERNAL_NEXT_BROWSER.md)을 참고한다.

## 인증·계정·결제 코드의 독립 회귀 검사

`PUREOBOM_TEST_POSTGRES_BIN`을 지정한 뒤 풀어봄 저장소에서 `node validation/next-saas-starter/run-account-regressions.mjs <external>`을 실행한다. `<external>`은 의존성을 독립 설치한 별도 Git 복제본이어야 한다. 진행 중인 에이전트 작업 복사본에서는 실행하지 않는다. 검사 파일과 설정은 그 복제본의 `pureobom-regression/`에 복사되며 앱 코드·고정 인수 검사·잠금 파일·기존 test 명령을 수정하지 않는다. 결과는 복제본 상위 폴더의 `account-regressions.json`에 저장하므로 변경 전후 결과를 따로 보관한다.

18개 검사는 실제 앱 액션, bcrypt, JWT, PostgreSQL에서 로그인·가입·초대 가입·계정 정보·비밀번호·로그아웃·계정 삭제, checkout 요청 구성·반환 처리, 잘못된 webhook 서명 거절과 서명된 구독 취소 처리를 확인한다. Next의 요청 쿠키와 redirect는 테스트가 제공하고 Stripe의 원격 SDK 메서드는 명시적인 응답 fixture를 반환한다. 해당 결제 검사에서는 예상하지 않은 HTTPS 요청을 거절한다. 실제 Stripe 결제, 운영 인증 환경, 브라우저 인증 전체 흐름을 검증한 것으로 해석하지 않는다.

## 검증 경계

- 고정/추가 인수 검사는 [PGlite](https://pglite.dev/docs/pglite-socket)와 loopback TCP socket을 사용한다. 실제 브라우저의 동시 요청에서는 prepared statement 오류와 연결 종료가 발생하여 PGlite 브라우저 시도를 완료로 처리하지 않았다. 브라우저 모드는 실제 PostgreSQL을 요구한다. 비대화형 HTTP 시작 검사만 PGlite를 사용할 수 있다.
- 인수 검사에서는 Next의 요청 cookie 접근자를 제공한다. 세션 서명·검증, 사용자 조회, 서버 액션, DB 변경은 앱 코드다. 별도 브라우저 기록에는 실제 로그인과 owner의 HTTP Server Action이 포함된다. member의 직접 거절과 다른 팀 경계는 인수 검사에서 확인했으며 브라우저 버튼 차단만으로 주장하지 않는다.
- 인수 검사의 UI 부분은 React 서버 렌더링이다. 별도 기록은 실제 외부 앱 브라우저 조작을 확인한다. 네이티브 설치 Webview와 실제 모델의 전체 검토·반영 흐름은 여전히 별도다.
- Stripe를 호출하거나 실계정·실데이터를 사용하지 않는다. 전체 Next production build, 결제, 운영 인증, 네트워크 경계는 이 검사의 통과 범위에 포함하지 않는다.
- `test`와 `typecheck`를 선택한다. 제품의 다른 검사 실패·미실행 상태를 자동 통과시키지 않는다. 테스트 구성·기대값 해시를 고정하고 구현 뒤 동일함을 확인한다.
- 작업 복사본은 실행 샌드박스와 다르다. 분리 Git 작업 공간의 생성·검토·반영 경로를 시험하는 것이며, 운영 권한 보안 감사로 주장하지 않는다.

## 실제 이어하기와 로컬 가격 fixture를 사용한 전체 빌드

[실제 Codex 이어하기 기록](../../docs/LIVE_CONTINUATION.md)은 시간 초과로 남은 일곱 파일을 새 작업에서 이어 구현하고 고정 9개·추가 33개·기존 기능 18개와 타입 검사, 같은 작업의 반영/복원을 확인한다. 최초 검증 드라이버 실패와 수정 후 복구를 분리해 보존한다. 이 후보의 브라우저 조작은 미확인이다.

`build.mjs`는 OS 임시 폴더 아래 `pureobom-production-<식별자>/project`라는 독립 Git 복제본만 받는다. 필요한 의존성을 이 복제본에서 설치하고, 진행 중인 구현의 원본이나 작업 복사본과 분리한다. Git clone 뒤에는 검토한 후보의 추가·수정 파일을 복사하고 각 파일의 SHA-256을 검토 기록과 비교해야 한다. clone만으로 미커밋 후보 변경이 복사되지는 않는다. 변경 전후 결과를 비교할 때는 원본과 후보를 구분한 보고서 이름을 사용한다.

```powershell
$env:PUREOBOM_TEST_POSTGRES_BIN='C:\path\to\pgsql\bin'
node validation/next-saas-starter/build.mjs '<임시 pureobom-production-식별자/project>' candidate-controlled-build
node validation/next-saas-starter/serve.mjs '<같은 빌드 복제본>' --production
# 실제 브라우저를 함께 조작하려면 --interactive를 추가한다.
```

빌드는 실제 PostgreSQL과 Next production 컴파일러·페이지 생성을 사용한다. `/pricing`에 필요한 실제 Stripe SDK의 GET 가격·상품 응답만 로컬 HTTP fixture로 제공하고, 예상하지 않은 Stripe 쓰기는 전송 전에 거절한다. 시험용 값만 사용하며 실제 Stripe 연결·결제·운영 인증은 검증하지 않는다. 일반 글꼴 다운로드 등은 기존 Next 경로를 사용할 수 있어 전체 네트워크 격리로 설명하지 않는다. 보고서와 로그는 복제본 상위 폴더에 저장된다. 공개할 때는 임시 Next preview 토큰을 제외한다.

`serve.mjs --production`은 기존 `.next/BUILD_ID`를 읽고 `next start`를 실행한다. 그 ID를 빌드 보고서와 비교해 같은 결과물임을 확인한다. HTTP 시작 검사는 실제 member JWT로 팀 API를 호출한다. `--interactive` SQL 스냅샷만으로 브라우저 클릭·화면 표시까지 확인했다고 주장하지 않는다.
