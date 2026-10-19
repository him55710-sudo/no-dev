# 창을 다시 열어 진행 중인 구현에 연결하기

2026-10-20 개발 브랜치의 구현이다. 구현 실행은 설치 패키지에 포함된 별도 Node 프로세스가 유지한다. VS Code 창이나 확장 호스트가 종료되어도 실행 중인 작업·검사·승인 요청을 유지하며, 같은 프로젝트를 같은 편집기 프로필에서 열면 그 작업에 연결한다. **창 닫기는 취소가 아니다. 중지하려면 `작업 취소`를 선택한다.**

연결이 끊겼을 때 화면은 마지막 관측 상태와 연결 오류를 함께 표시한다. 이때 승인·취소·반영 버튼을 비활성화하고 `실행 상태 다시 연결`을 제공한다. 응답 시간 초과만으로 작업이 종료됐다고 표시하거나 같은 구현 요청을 반복하지 않는다. 다시 연결해도 새로운 모델 턴이나 승인을 자동으로 만들지 않는다.

## 실행과 기록의 소유권

- `agent-host.cjs`가 기존 구현 관리자·Codex stdio 연결·검사·파일 반영 트랜잭션을 소유한다. 확장은 인증된 로컬 연결로 상태와 요청을 주고받는다. 계정·모델 연결 방식은 바꾸지 않는다.
- Windows는 named pipe, Linux는 abstract Unix socket의 점유로 프로젝트당 관리 프로세스 하나만 허용한다. 다른 플랫폼의 loopback 포트 대체 경로는 파일 반영 잠금과 다른 포트 범위를 쓴다. 다른 편집기 프로필의 활성 작업을 탈취하지 않는다.
- 프로세스가 연결 주소를 점유한 뒤 사용자 확장 저장소에 임의의 인증 값을 원자적으로 기록한다. 인증 전에는 작업 정보를 보내지 않는다. 이 값은 Webview에 전달하지 않는다. 동일 OS 계정의 악의적인 프로그램까지 막는 보안 경계는 아니다.
- 여러 창의 요청은 관리 프로세스에서 순서대로 처리한다. 승인·취소는 작업 ID, 파일 비교와 반영은 검토 ID도 검사한다. 연결 종료·시간 초과 뒤에는 전송한 요청을 자동 재전송하지 않는다.
- 연결된 화면도 활성 작업도 없으면 약 30초 뒤 관리 프로세스가 종료된다. 승인 대기 중에는 종료하지 않는다. 완료된 작업은 기존 기록에서 다시 열 수 있다.
- 관리 프로세스 자체가 종료된 경우 저장된 활성 작업을 `이전 실행 연결 확인 필요`로 연다. 이전 승인과 검사 결과는 무효화한다. Codex 잔류 프로세스 탐지·종료와 죽은 실행을 새 모델 세션으로 이어 실행하는 기능은 이번 구현에 포함하지 않는다. 파일 반영 도중 관리 프로세스가 죽은 경우에는 기존 저널 복구 경로를 사용한다.

## 확인한 범위

| 검증 | 실제 관측 |
|---|---|
| 자식 프로세스 시험 4개 | 최초 클라이언트 프로세스 종료 후 동일 승인 재연결, 승인 뒤 화면 없이 검사 완료, 검토·반영·undo, 유휴 종료 후 기록 복원, 두 창의 동시 시작 중 하나만 실행, 오래된 요청 거절, 재연결 취소, 인증 실패 시 정보 미전송, 관리 프로세스 강제 종료 후 중단 기록, 응답 없는 활성 주소를 대체하지 않음 |
| 설치본의 독립 VS Code 실행 6회 | 승인 대기 중 창 종료 → 같은 작업·승인 복원 → 실제 검사·검토 → 재시작 후 반영·undo. 파일 3개 중 1개를 반영하고 확장 호스트를 강제 종료한 뒤에도 관리 프로세스가 나머지 반영을 완료. 새 창에서 원본으로 되돌리고 기존 staged/unstaged 변경·HEAD·index 보존 |
| 브라우저 화면 | 실제 React 컴포넌트에 합성 상태를 넣어 연결 오류, 비활성화, 재연결, 취소 표시를 조작. 작은 높이에서 캔버스가 연결 안내를 침범한 문제를 수정 |
| 회귀 | 25개 파일의 214개 시험 순차 실행 통과. 기존 파일 트랜잭션의 중간 종료·부분 undo·충돌 복구 시험도 포함 |

실행 원자료: [설치본 6회 실행](evidence/system-workspace/2026-10-20/managed-installed.json), [회귀 결과](evidence/system-workspace/2026-10-20/managed-regression.json), [화면 관측](evidence/system-workspace/2026-10-20/managed-ui.json). [연결 끊김 화면](evidence/system-workspace/2026-10-20/managed-disconnected.jpg), [연결 후 승인 화면](evidence/system-workspace/2026-10-20/managed-connected.jpg), [취소 화면](evidence/system-workspace/2026-10-20/managed-cancelled.jpg).

추가로 [기존 확장 통합 26개 흐름](evidence/system-workspace/2026-10-20/managed-extension-integration.json), [설계 워크스페이스 통합 30개 흐름](evidence/system-workspace/2026-10-20/managed-design-integration.json), 웹·확장 빌드와 릴리스 패키지 검사를 통과했다. 설치 시험의 VSIX SHA-256은 `56ea33d2582fe02a4e584ce4e9d2e3c600753dda8017be15174cef06e0736397`이다. 설치 시험 뒤 패키지 해시가 동일함을 확인했다.

첫 병렬 회귀 실행에서는 213개 중 Windows 검사 종료 시험 1개가 실패했다. `taskkill /T /F`가 자손 종료를 보고한 뒤 부모에 대해 접근 거부와 종료 코드 255를 반환했고, 제품은 종료 확인 실패를 성공으로 바꾸지 않았다. 이후 해당 PID들은 관측되지 않았으며 단독 시험 2개와 전체 순차 시험 214개가 통과했다. 간헐적인 Windows 종료 확인 문제까지 해결됐다고 주장하지 않는다. [실패와 후속 검사 기록](evidence/system-workspace/2026-10-20/managed-verification-observation.json).

위 설치본 6회와 프로세스 시험의 구현 응답은 명시한 결정적 테스트용 stdio 실행기다. 후속 [실제 Codex 재연결 검증](MANAGED_LIVE_CODEX.md)에서는 Windows의 실제 승인 대기 중 창을 종료하고 동일 프로세스·작업·승인을 이어받아 검사·검토·반영·undo까지 완료했다. Linux/macOS 실기기의 실제 모델 재연결, 네이티브 Webview의 전체 포인터 조작, 전원 손실은 아직 검증하지 않았다. [Windows·Linux CI](https://github.com/him55710-sudo/no-dev/actions/runs/39288714238)는 양쪽 모두 통과했다.

## 재현

```sh
pnpm exec vitest run tests/agent-host.test.ts
pnpm exec vitest run --maxWorkers=1
pnpm build
pnpm extension:build
pnpm extension:package
pnpm extension:recovery-test
```

Linux의 설치 시험은 `xvfb-run -a pnpm extension:recovery-test`로 실행한다. 마지막 시험은 사용자 프로필과 분리한 임시 프로필에 실제 VSIX를 설치하며, 원본 테스트 프로젝트와 기록은 진단을 위해 보존한다. 이 기록은 전체 기획의 완성을 의미하지 않는다.
