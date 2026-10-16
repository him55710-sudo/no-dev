# 외부 Next.js 앱의 설계 변경 검증

대상은 [Next.js SaaS Starter](https://github.com/nextjs/saas-starter/tree/6e33e58b1e553a41fe22e6b941a7229a002de361)의 고정 커밋 `6e33e58b1e553a41fe22e6b941a7229a002de361`이다. upstream은 MIT 라이선스이며 Vercel의 저작권 고지를 유지한다. 앱을 새 합성 예제로 대체하지 않는다. 실제 `app/(login)/actions.ts`, 팀 조회 API, 대시보드 React 컴포넌트, JWT, Drizzle, 원본 SQL migration을 사용한다.

이 upstream에는 테스트 명령이 없어서 **독립 인수 검사 환경을 추가**한다. 이를 upstream의 기존 검사로 설명하지 않는다. `prepare.mjs`는 `package.json`과 `pureobom-validation/`만 만들고 앱 구현을 바꾸지 않는다. 원본 패키지 설치와 추가 검사 도구 설치는 풀어봄의 `node_modules`를 찾을 수 없는 별도 디렉터리에서 수행한다. pnpm 패키지 캐시는 재사용할 수 있지만 다른 프로젝트의 설치 폴더를 연결하지 않는다.

## 확인할 변경

현재 팀의 owner만 팀 구성원을 초대·제거할 수 있다. member는 조회하고 제한 이유를 확인할 수 있다. 계정 전체의 `users.role`이나 다른 팀의 owner 권한이 현재 팀의 `team_members.role`을 대체할 수 없다. 직접 서버 액션 호출도 같은 정책을 사용한다. 정상 owner의 브라우저 FormData 요청은 동작해야 한다.

고정 인수 검사 9개는 실제 팀 조회, member의 두 변경 거절과 데이터 보존, owner의 두 변경 허용, 다른 팀 대상 거절, 미인증 거절, 양쪽 역할의 React 화면을 확인한다. 일반 검사 통과를 새로운 제품의 모든 요구사항 충족으로 해석하지 않는다.

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

## 검증 경계

- 테스트 DB는 [PGlite](https://pglite.dev/docs/pglite-socket)와 loopback TCP socket이다. 앱의 Postgres 클라이언트·Drizzle·SQL을 실제 실행하지만 일반 PostgreSQL 서버의 모든 동시성·운영 동작을 증명하지 않는다.
- Next의 요청 cookie 접근자만 검사에서 제공한다. 세션 서명·검증, 사용자 조회, 서버 액션, DB 변경은 앱 코드다. HTTP로 보낸 Next Server Action이나 실제 로그인 화면까지 검증한 것은 아니다.
- UI 검사는 실제 컴포넌트의 React 서버 렌더링이다. 브라우저·설치 Webview의 마우스 및 키보드 전체 흐름은 별도다.
- Stripe를 호출하거나 실계정·실데이터를 사용하지 않는다. 전체 Next production build, 결제, 운영 인증, 네트워크 경계는 이 검사의 통과 범위에 포함하지 않는다.
- `test`와 `typecheck`를 선택한다. 제품의 다른 검사 실패·미실행 상태를 자동 통과시키지 않는다. 테스트 구성·기대값 해시를 고정하고 구현 뒤 동일함을 확인한다.
- 작업 복사본은 실행 샌드박스와 다르다. 분리 Git 작업 공간의 생성·검토·반영 경로를 시험하는 것이며, 운영 권한 보안 감사로 주장하지 않는다.
