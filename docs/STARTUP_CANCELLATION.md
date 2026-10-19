# 초기 연결 중 취소와 실제 종료 확인

## 재현한 문제

구현 작업은 Git 작업 복사본을 만든 뒤 Codex 실행기를 초기화하고 로그인 상태를 조회한다. 이전에는 모델 실행의 `run()`에만 취소 처리가 연결돼 있었다. 따라서 `initialize` 또는 `account/read`에 응답하지 않는 실행기는 취소를 눌러도 요청의 제한 시간이 끝날 때까지 살아 있었다.

실제 관리 호스트와 별도 Git 작업 복사본에서 응답하지 않는 결정적 테스트 실행기를 띄웠다. 실행기는 자신의 PID와 연속 쓰기 파일을 남기고 표준 입력이 닫혀도 계속 살아 있도록 했다. 초기화·로그인 조회 두 경우 모두, 취소 뒤 5초 안에 종료를 확인하는 [수정 전 검사](evidence/startup-cancel-before.json)가 실패했다. 실제 Codex나 외부 모델을 실행한 검사는 아니다.

첫 수정으로 초기 연결에 취소를 전달하자 두 종료 검사는 통과했다. 하지만 종료 시점까지 검사 범위를 넓히니 로그인 조회 취소에서 **프로세스가 살아 있는데도 `cancelled` 상태가 먼저 전달되는 문제**가 드러났다. [중간 수정의 실패](evidence/startup-cancel-early-status.json)도 보존한다.

## 최종 동작

- 실행기 초기화와 로그인 조회에도 취소 신호를 연결한다. 각 비동기 응답 뒤에 취소 여부를 다시 확인해, 늦은 응답으로 모델 실행을 시작하지 않는다.
- 취소를 받으면 `cancelling` 상태를 유지하고 실행 프로세스의 종료를 기다린다. 종료 확인 뒤에만 `cancelled` 상태를 기록하고 전달한다.
- 종료를 확인하지 못하면 실패와 해당 오류를 남긴다. 취소 완료 상태로 덮지 않는다.
- 모델 실행이 시작된 뒤에는 기존 승인 취소·실행 중단 경로를 사용한다. 준비 단계의 취소 리스너는 그 전에 해제한다.
- 연결 준비와 취소 진행을 사용자에게 문장으로 표시한다. 새 코드 반영이나 자동 재시도를 시작하지 않는다.

회귀 검사는 실제 호스트를 통과한 취소 상태, 프로세스 부재, 연속 쓰기의 정지, 모델 턴을 시작하지 않은 사실, 빈 승인·검사 목록, 저장된 취소 기록, 원본 파일·Git 상태 보존을 확인한다. 취소 완료 이벤트를 받는 시점에도 실행기가 살아 있지 않은지 별도로 검사한다. 실패 시 정리는 테스트가 소유한 호스트 핸들과 중지 파일을 사용한다.

## 앞선 시간 초과와 구분

함수 설명 작업 중 전체 회귀에서 발생했던 [8개 실패](evidence/function-regression-initial.json)의 공통 원인을 이번 수정으로 확정하지 않는다. 같은 함수 설명 커밋 `0a5140c`의 [Windows·Ubuntu CI](https://github.com/him55710-sudo/no-dev/actions/runs/39331664538)는 모두 성공했고, Windows 전체 회귀 259개도 통과했다. 이전 실패 기록은 유지한다.

Windows 실행 경로의 임시 사본에 구간 기록을 넣어 네 개의 짧은 Node 실행을 측정했다. [첫 측정](evidence/startup-timing-initial.json)에서 실행 파일 준비는 약 0.56–0.91초였다. 이때 이전 15초 이상의 초기화 지연은 재현되지 않았다. 관측은 stderr 수신 시점 기준이며, OS 수준 프로파일링이나 과거 시간 초과 원인의 증명은 아니다. 실행·취소 제한 시간을 늘리거나 Windows 프로세스 관리 방식을 바꾸지 않았다.

앞으로 관리 호스트 검사가 시간 초과하면 마지막 상태와 상태 전환 시간을 오류에 포함한다. CI는 전체 검사 JSON과 관리 호스트 관측 파일을 항상 업로드하도록 했다. 승인 대기 검사가 실패해도 해당 테스트의 관리 호스트에 다시 연결해 실행을 취소하고, 창 연결만 닫아 작업을 남기지 않도록 했다.

## 검증 및 재현

최종 취소 처리와 상태 전환 수정 후 [관련 검사 37개](evidence/startup-cancel-regression.json)가 통과했다. 여기에는 관리 호스트, 프로토콜, 기록 복구, 프로세스 수명, 검사 프로세스 종료가 포함된다.

전체 회귀에서도 [261개 검사](evidence/startup-full-regression.json)가 모두 통과했다. [호스트 관측 기록](evidence/startup-host-observations.json)에서 두 새 사례는 취소 요청 뒤 각각 1,058ms·1,068ms에 종료 확인과 최종 기록 저장을 마쳤다. 이 값은 해당 합성 실행의 관측이며 모든 환경에 대한 응답 시간 보장은 아니다. 최신 계측 스크립트의 [실행 결과와 소스 해시](evidence/startup-timing.json)도 별도로 남겼다.

앱·확장 빌드, [설계 호스트 검사 39개](evidence/startup-design-host.json), VSIX 패키징과 [설치본 여섯 차례 실행](evidence/startup-installed-recovery.json)이 통과했다. 설치본에서는 승인 대기 상태를 유지한 창 재시작, 검토·반영·undo, 일부 파일 반영 뒤 확장 호스트 강제 종료와 실제 파일 상태 복구를 확인했다.

추가로 실제 설치 폴더의 `agent-host.cjs`를 사용해 [두 초기 연결 취소 검사](evidence/startup-installed-cancel.json)를 다시 통과했다. 이 실행은 소스에서 새로 만든 호스트 대신 설치된 번들을 띄웠다. [설치 호스트·VSIX 해시](evidence/startup-installed-host.json)와 [해당 상태 기록](evidence/startup-installed-observations.json)을 함께 보존한다. 새 테스트 실행 경로를 추가한 뒤 타입 검사도 통과했다. 설치 파일을 사용하는 호스트 검사이며 네이티브 Webview 포인터 조작이나 실제 모델 품질의 증거는 아니다.

```powershell
pnpm exec vitest run tests/agent-host.test.ts -t 'cancels a stalled' --maxWorkers=1
pnpm exec vitest run tests/agent-host.test.ts tests/agent-protocol.test.ts tests/agent-recovery.test.ts tests/owned-process.test.ts tests/agent-verification.test.ts --maxWorkers=2
node scripts/check-process-startup.mjs
```

설치 호스트의 같은 취소 사례를 확인하려면 아래처럼 실제 설치 폴더의 번들을 지정한다. 나머지 호스트 테스트는 시험용 짧은 유휴 종료 시간을 전제로 하므로 이 두 사례만 선택한다.

```powershell
$env:PUREOBOM_TEST_AGENT_HOST = '<실제 확장 설치 폴더>\out\agent-host.cjs'
pnpm exec vitest run tests/agent-host.test.ts -t 'cancels a stalled' --maxWorkers=1
Remove-Item Env:PUREOBOM_TEST_AGENT_HOST
```

시작 시간 측정 명령은 현재 `ownedProcess.ts`의 임시 계측본만 사용하며 제품 코드를 수정하지 않는다. 소스 해시와 실행 구간을 `test-results/startup-timing.json`에 남긴다. 느린 환경의 모든 시작 실패, 다른 OS의 프로세스 수명 보장 또는 전체 제품 완성을 입증하는 검사는 아니다.

[Windows 실행 수명 관리](WINDOWS_PROCESS_SCOPE.md) · [관리 호스트](MANAGED_AGENT_HOST.md) · [전체 구현 기준](SYSTEM_WORKSPACE_STATUS.md)
