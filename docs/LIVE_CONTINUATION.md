# 실제 Codex의 중단 작업 이어하기

2026-10-20. 이전 설치 UI 실행에서 시간 초과로 실패한 외부 Next.js 앱 작업을 새 복사본·새 모델 세션으로 이어 구현했다. 고정 검사와 별도 회귀 검사, 전체 Next 빌드, 원본 반영과 되돌리기를 확인했다. 최초 검증 드라이버는 반영 후 분석에서 실패했고, **같은 작업에 다시 연결해 복구를 완료했다**. 실패 보고서를 성공으로 덮어쓰지 않는다.

## 작업과 실제 변경

- 보존된 실패 작업: `acc7e12c-ca3f-4f88-a486-c5b6c8ea9db2`. [원래 시간 초과 기록](evidence/system-workspace/2026-10-20/installed-next-timeout.json)은 그대로다.
- 이어한 작업: `f7fe4327-8044-44bd-9ffa-0213c103aee4`. 모델 실행 전 기존 부분 변경 7개 파일의 해시가 새 작업 복사본과 일치함을 관측했다. 새 승인 4개와 독립 검사를 사용했다.
- 최종 후보도 7개 파일이다. 중단 전 후보에서 실제로 더 바뀐 파일은 대시보드와 추가 권한 검사다. 제거 성공 후 SWR 명단 갱신·성공 메시지를 추가하고, 권한 철회·위조된 팀 필드 등의 검사를 보완했다.
- 현재 팀의 `team_members.role`을 UI와 서버 액션에서 사용한다. 다른 팀 구성원 제거, 잘못된 FormData ID, 실제 제거 없이 성공 활동을 남기는 경로를 거절한다.

[요약과 해시](evidence/system-workspace/2026-10-20/continuation-live-summary.json), [실제 모델·승인·검토·최초 실패 기록](evidence/system-workspace/2026-10-20/continuation-live-report.json), [동일 작업의 반영 확인·되돌리기](evidence/system-workspace/2026-10-20/continuation-live-recovery.json)를 함께 읽는다. 구현 응답은 실제 Codex이며, 검토자는 검증 에이전트다. 사람의 사용성 평가가 아니다.

## 확인 범위

| 실행 | 결과와 범위 |
|---|---|
| 배포된 관리 호스트의 독립 검사 | 변경하지 않은 인수 검사 9/9, skip 0; typecheck exit 0 |
| 별도 복제본의 추가 권한 검사 | [33/33, skip 0](evidence/system-workspace/2026-10-20/continuation-extra-retry.json). 실제 액션·쿼리·SQL·React 정적 렌더링을 검사한다 |
| 기존 기능 회귀 | [18/18, skip 0](evidence/system-workspace/2026-10-20/continuation-account-regressions.json). 실제 PostgreSQL·bcrypt·JWT·계정 액션을 사용하며 요청 context와 Stripe 원격 응답은 fixture다 |
| 변경 전후 전체 Next 빌드 | [원본](evidence/system-workspace/2026-10-20/continuation-build-baseline.json)과 [후보](evidence/system-workspace/2026-10-20/continuation-build-candidate.json) 모두 exit 0. 실제 Next 컴파일러와 페이지 생성을 실행한다. Stripe 가격·상품 GET 응답만 로컬 시험 서버가 제공한다 |
| 빌드한 앱의 HTTP | [실제 production 서버](evidence/system-workspace/2026-10-20/continuation-production-http.json)의 팀 API가 합성 member 세션으로 200을 반환한다. 후보의 BUILD_ID와 일치한다 |
| 반영·재분석·복원 | 같은 작업의 후보 7개 파일 반영 해시 확인, 분석 52→55→52, 관측 changed→unchanged. 원본 추적 파일 57개·Git HEAD/index/status·저장 설계·이전 부분 변경 보존 |

이번 실제 앱의 브라우저 로그인·초대·제거·동적 명단 갱신은 **미확인**이다. 새 탭 연결이 두 번 시간 초과됐고, 기존 검증 탭 연결은 도구의 URL 보안 정책에 거절됐다. [시도 기록](evidence/system-workspace/2026-10-20/continuation-browser-attempt.json)을 남겼으며 우회하지 않았다. 정적 React 렌더링과 HTTP 시작 검사를 브라우저 상호작용 성공으로 설명하지 않는다. 앞선 다른 후보의 브라우저 증거도 이 후보의 증거로 합치지 않는다.

검토 기록에서 화면 동작 `acceptance:4`, 운영 인증·결제 및 외부 요청 전체 `invariant:0`, 독립적인 설치 전체 감사 `invariant:2`를 미확인으로 유지했다. 미확인 상태의 반영을 명시적으로 선택한 **시험용 원본**에만 반영하고 되돌렸다. 원격 앱 배포나 upstream push는 하지 않았다.

## 실패와 드라이버 수정

1. 키를 주지 않은 원본의 일반 `pnpm build`는 `/pricing` 데이터 수집에서 실패했다. [출력](evidence/system-workspace/2026-10-20/continuation-build-baseline-missing-key.txt)을 보존했다. 이를 후보 코드의 회귀로 분류하지 않는다.
2. 첫 로컬 가격 fixture 빌드는 Windows의 `NODE_OPTIONS` 경로 처리 때문에 실패했다. [실패 기록](evidence/system-workspace/2026-10-20/continuation-build-preload-path-failure.json)을 보존하고 preload 경로를 슬래시로 정규화했다.
3. 추가 권한 검사의 첫 독립 실행은 PGlite 초기화 hook의 30초 제한에 걸려 33개가 실행되지 않았다. [실패 보고서](evidence/system-workspace/2026-10-20/continuation-extra-initial.json)와, `--hookTimeout 120000`만 지정한 33개 통과를 구별한다. 후보 파일이나 기대값을 바꾸지 않았다.
4. 최초 이어하기 드라이버는 저장된 업무 기능을 구조에 투영하지 않고 분석해서 반영 후 `reconnect`를 반환했다. 제품은 이미 `projectFeatures`를 적용하고 있었다. 드라이버에 같은 단계를 추가하고 `.mts` 및 인수 검사 파일도 수집하도록 맞췄다. 반영 전 기준 상태를 확인하고, 후속 검증 실패 시에도 관리 호스트의 undo로 복원하도록 보완했다.
5. 이미 반영된 작업은 새 모델을 실행하지 않고 `recover-live-continuation.mjs`로 다시 연결했다. 저장 기능을 포함한 분석에서 55개 파일과 changed를 확인하고, 같은 검토의 undo 후 52개·unchanged·모든 원본 해시를 확인했다. 최초 드라이버 exit 1과 복구 드라이버 exit 0은 별도 결과다.

실제 Next 빌드는 성공했지만 운영 Stripe 연동을 입증하지 않는다. fixture는 실제 Stripe SDK의 가격·상품 GET을 loopback 서버로 돌리고 예상하지 않은 Stripe 쓰기 요청을 전송 전에 거절한다. 일반 Next 글꼴 다운로드는 별도 네트워크 경로를 사용할 수 있으며, 전체 네트워크 격리 도구가 아니다. 생성된 Next preview 토큰은 공개 보고서에서 제외했다. 빌드가 자동 변경한 `tsconfig.json`은 시험 복제본에만 있다.

## 재현

배포된 VSIX의 SHA-256은 `3361845dccb2c09c6dc004ba64c5b477bba345ce3dac8df9ba3d9867b82c85b4`다. 이번 변경은 검증 드라이버·문서·소스 배포 구성에 한정되며 확장 런타임은 바꾸지 않았다. [외부 앱 준비와 검사 환경](../validation/next-saas-starter/README.md)을 먼저 준비한다.

보존된 실제 설치 UI 검증 실행의 디렉터리와 실패/취소/중단 작업 ID가 필요하다. 파일 경로·내용과 확정 설계가 달라진 원본에는 이어하지 않는다.

```powershell
$env:PUREOBOM_RUN_CODEX='1'
$env:PUREOBOM_CODEX_PATH=(Get-Command codex).Source
node scripts/test-live-continuation.mjs '<보존된 pureobom-installed-ui 실행 폴더>' '<중단된 작업 UUID>'
```

승인 요청을 개별 검토하고, 검사 후 출력되는 기준별 검토 양식을 채운다. 검토 전에는 자동 반영하지 않는다. 결과는 해당 실행의 `continuation-runs/run-*/report.json`에 기록된다. 이미 반영된 상태에서 드라이버가 실패했다면 아래 명령으로 **같은 작업**의 해시·분석을 확인하고 되돌릴 수 있다. 완료된 작업을 재실행하는 명령은 아니다.

```powershell
node scripts/recover-live-continuation.mjs '<실패 보고서가 있는 continuation-runs/run-* 폴더>'
```

전체 빌드와 production HTTP 재현은 외부 앱 안내의 로컬 가격 fixture 절차를 따른다. 이 CLI 검증은 설치된 UI의 새 조작이나 네이티브 Webview 검증을 대신하지 않는다.
