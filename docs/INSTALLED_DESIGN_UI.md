# 설치된 설계 화면 검증

설치한 VSIX의 `design.js`와 `design.css`를 그대로 브라우저에 열고, 화면 요청을 실제 Production 확장 호스트의 `DesignWorkspace.handleRequest`에 전달한다. 설계와 작업 상태를 흉내 내는 화면 모의 연결을 사용하지 않는다. 브라우저에서 `acquireVsCodeApi`의 전송 부분만 테스트용 loopback HTTP 연결로 대체한다.

이 경로는 설치 번들·실제 상태 저장·Git 작업 공간·검사·검토·반영·되돌리기를 함께 확인한다. **VS Code Webview 자체의 DOM, CSP, 포인터/키보드 전달은 증명하지 않는다.** 합성 실행기 검증과 실제 모델 검증을 구별한다. 2026-10-20에는 [실제 Codex와 외부 Next 앱의 전체 흐름](INSTALLED_NEXT_FLOW.md)을 완료했으며, 그 과제의 결과를 모델 품질 전반으로 일반화하지 않는다.

## 재현

Node와 pnpm, Git이 준비된 저장소 루트에서 실행한다. Windows PowerShell 예시:

```powershell
pnpm extension:build
pnpm extension:package
$env:PUREOBOM_DESIGN_UI = '1'
pnpm extension:design-ui-test
```

스크립트는 OS 임시 폴더에 `tests/fixtures/installed-recovery`를 복사하고 별도의 Git 저장소, VS Code 1.96.4 프로필, 확장 설치 경로를 만든다. 출력된 `INSTALLED UI BROWSER` 주소를 브라우저에서 연다. 주소의 토큰을 외부에 공유하지 않는다. 테스트 전송 서버는 `127.0.0.1`에만 바인딩하며 정확한 Host, POST Origin과 content type을 검사한다. 이 서버와 드라이버는 VSIX에 포함하지 않는다.

1. `업무 기능 만들기`에서 `프로젝트 공유 권한`을 만들고 `policy.js`, `service.js`, `ui.js`를 연결한다. 트리의 기능 이름을 두 번 눌러 세 파일을 탐색한다.
2. 원하는 동작에 viewer 조회 허용·수정 거절, owner/editor 편집 유지, 직접 수정 요청 403과 데이터 보존을 적는다. 유지 조건과 완료 기준을 각각 한 줄씩 작성한다.
3. `설계만 저장` 후 `저장 v1`과 초안 안내 제거를 확인한다. 역할과 목적을 임시로 수정하고 `초안 버리기`를 누른 뒤 확정 값으로 복원되는지 확인한다.
4. 정책과 조건을 수정해 새 초안을 만든다. `Codex 연결 확인` 결과가 **deterministic installed-recovery protocol fixture**인지 확인한다. 전송/실행 동의와 `test` 검사를 선택하고 `이 프로젝트에 보관`을 누른다.
5. `저장하고 구현`을 눌러 설계 v2와 초안 안내 제거를 확인한다. 합성 작업 공간의 세 파일에 한정된 파일 변경 요청을 허용한다. 고정된 stdio 실행기가 파일을 변경하고 실제 `node --test test.js`가 실행된다.
6. 검사 로그와 변경 파일을 읽고 각 기준의 근거를 기록한다. 합성 `ui.js`는 함수 반환값만 제공하므로 실제 앱 화면 기준은 미확인으로 남긴다. 이 미확인 항목을 인지하는 선택을 하고 검토 기록을 저장한다.
7. `검토한 변경 반영` 후 세 파일과 구조의 갱신, 원하는 동작의 보존을 확인한다. `이번 변경 되돌리기` 후 코드와 구조가 돌아오고 설계 v2는 유지되는지 확인한다.
8. 테스트 표시줄의 `검증 종료·기록 저장`을 누른다. 성공한 요청, 작업 상태, 원래 추적 파일의 해시, HEAD·index·Git 상태를 확인한 뒤 호스트와 서버가 종료된다. 보고서는 `test-results/installed-design-ui.json`에 복사된다.

마지막 버튼은 호스트 동작과 원본 복원을 검사한다. 초안 안내의 실제 제거와 화면 배치는 별도로 DOM/스크린샷으로 확인해야 한다. 보고서의 `originalRestored: true`만으로 화면 전체에 결함이 없다고 판정하지 않는다. 실행 제한은 60분이며 수동 브라우저 조작이 필요하므로 일반 CI에는 포함하지 않는다.

로컬 Git 저장소 경로를 인수로 주는 실제 모델 모드는 `PUREOBOM_RUN_CODEX=1`과 검토한 `PUREOBOM_CODEX_PATH`를 추가로 요구하고, 전달한 저장소를 임시 폴더로 복제한다. 복제에는 커밋된 파일만 들어가며 의존성 설치는 별도로 준비해야 한다. 아래 2026-10-16 합성 화면 검증에는 실제 모델을 사용하지 않았다. 이후 [경로 문제로 실패한 실행](EXTERNAL_NEXT_BROWSER.md)과 [승인 대기 시간 초과](APPROVAL_WAIT.md)를 거쳐 2026-10-20의 [실제 모델 전체 흐름](INSTALLED_NEXT_FLOW.md)을 통과했다. 실패한 실행을 성공으로 덮어쓰지 않고 별도 기록을 보존한다.

## 실제 Codex 승인 대기 중 창 재연결

Windows의 실제 모델 모드에서 `PUREOBOM_RECONNECT_UI=1`을 추가하면 같은 프로젝트·프로필을 사용하는 두 번의 설치 호스트 실행을 연결한다. 첫 화면에서 `저장하고 구현`을 실행한 뒤 실제 승인 요청이 나타나면, 아직 승인하지 않은 상태로 테스트 표시줄의 `승인 대기 중 창 재시작 검증`을 누른다.

첫 호스트는 작업 ID·작업 공간·승인 내용과 해당 프로젝트의 관리 프로세스 및 직접 자식 Codex app-server의 PID·생성 시각을 기록하고 종료한다. 다음 호스트는 모두 동일한지 대조한다. 확장 호스트 PID는 달라야 한다. 기록만 복원하거나 새 모델 프로세스를 시작한 경우는 이 검사를 통과하지 못한다. 관측은 해당 복제 프로젝트의 프로세스로 한정하며 프로세스를 종료하거나 인계하지 않는다.

다음 `INSTALLED UI BROWSER` 주소로 이동한 후 같은 승인을 검토하고 구현·검사·검토·반영·되돌리기를 끝낸다. `reconnection.json`과 최종 보고서의 `reconnection`에 전후 관측이 보존된다. 재연결 검사만 통과해도 전체 흐름을 완료하기 전에는 `검증 종료·기록 저장`이 성공하지 않는다. 이 선택 모드는 Windows의 실제 Codex 실행에만 적용하며, 합성 실행기와 다른 플랫폼은 기존 별도 검사 경로를 사용한다.

2026-10-20에는 [실제 Codex와 외부 Next 앱](MANAGED_LIVE_CODEX.md)에서 같은 승인·프로세스를 유지하고 전체 흐름을 완료했다. 모델 구현 요청은 한 번만 발생했으며 브라우저 요청 오류는 없었다.

## 2026-10-16 결과

| 확인 범위        | 결과와 근거                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 실제 설치 여부   | VS Code 1.96.4 / Windows, Production 모드, 설치 경로 및 VSIX의 host·worker·JS·CSS 해시 일치                                     |
| 화면 조작        | 기능 생성, 세 코드 대상 연결, 설계 v1 저장, 새 초안 버리기, 실행 연결·선택 보관, v2 저장 및 구현 시작                           |
| 실제 변경과 검사 | `policy.js`, `service.js`, `ui.js` 변경. 고정 `test.js` 해시 불변. 실제 Node 검사 5개 통과                                      |
| 검토             | 검증 에이전트가 여섯 항목에 근거를 기록하고 확인, 실제 사용자 앱 화면 항목 하나는 미확인 유지. 인간 참가자의 사용성 검증이 아님 |
| 반영·재분석      | 변경한 세 파일의 분석 해시 갱신, 화면의 구조 수 21→22, 기준 관측 `unchanged`→`changed`, 설계 목표 보존                          |
| 되돌리기         | 모든 원래 추적 파일의 SHA-256, HEAD·index·Git 상태 복원. 분석 파일 해시 복원, 구조 수 22→21, 목표와 설계 v2 보존                |
| 초안 회귀        | 저장만 하기·버리기·저장 후 구현의 세 경로에서 `설계 초안` 영역 0개. 버리기 후 목적 입력이 확정된 빈 값으로 복원                 |

[호스트 원본 기록](evidence/system-workspace/2026-10-16/installed-design-ui.json), [수정 전 기록](evidence/system-workspace/2026-10-16/installed-design-ui-before-fix.json), [대조 검증 요약](evidence/system-workspace/2026-10-16/installed-design-ui-verification.json), [반영 화면](evidence/system-workspace/2026-10-16/installed-design-ui-applied.jpg), [되돌림 화면](evidence/system-workspace/2026-10-16/installed-design-ui-undone.jpg)을 함께 보관한다.

## 발견한 초안 안내 결함

수정 전 설치 번들에서는 구현 시작으로 호스트의 초안이 제거되어도 비활성 초안 안내와 잘못된 충돌 안내가 화면에 남았다. 그때도 호스트의 반영·되돌리기 검사는 통과했으므로 해당 기록을 UI 성공으로 취급하지 않는다.

`DraftNotice`와 인접한 `SpecEditor`가 같은 `spec.id`를 React key로 사용했다. [React의 공식 key 규칙](https://react.dev/learn/rendering-lists#rules-of-keys)에 따라 형제 컴포넌트의 식별자를 `draft:<id>`와 `editor:<id>`로 구분했다. 같은 전송 코드와 확장 호스트를 유지하고 새 UI 번들만 설치한 뒤 세 초안 경로와 전체 구현 흐름을 다시 확인했다.

수정 전/후 host·worker·CSS 해시는 같고 UI JS 해시만 다르다. 수정 후 VSIX SHA-256은 `74c326cc527b8b5f6c19fde1c5c35ca8de06012903f2ad8dacb6e7a593cb2729`다. 이것은 해당 설치 파일의 식별값이며 이후 재패키징의 zip 메타데이터까지 같은 해시를 보장하지 않는다.
