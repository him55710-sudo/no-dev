# Windows 구현 실행과 하위 프로세스 종료

관리 프로세스가 종료됐는데 Codex나 검사 명령이 만든 하위 프로세스가 작업 복사본을 계속 수정하면, 중단 표시만으로는 그 복사본을 안전하게 검토할 수 없다. Windows 10 이상에서 각 Codex 연결과 검사 실행을 별도의 Windows Job Object에 넣는다. 실행기와 그 하위 프로세스가 같은 수명을 갖게 하는 변경이다.

## 동작

- `spawnOwnedProcess`가 Windows 기본 PowerShell/.NET으로 작은 네이티브 API 연결부를 실행한다. 별도 실행 파일을 내려받거나 PowerShell 실행 정책을 변경하지 않는다. PowerShell 사용이 제한된 환경에서는 실행 실패로 남기며 보호 없는 실행으로 우회하지 않는다.
- `PROC_THREAD_ATTRIBUTE_JOB_LIST`로 프로세스 생성과 작업 소속을 함께 확정한다. 관리 프로세스가 생성 도중 종료돼도 아직 등록되지 않은 실행기가 먼저 동작하는 틈을 만들지 않는다. 실행은 등록된 프로세스의 스레드를 재개한 뒤 시작한다.
- 작업 핸들은 상속하지 않으며 `KILL_ON_JOB_CLOSE`만 설정한다. 분리 실행된 자손도 이 작업을 벗어나지 못한다. 기록에서 읽은 PID를 이용해 프로세스를 찾아 종료하지 않는다.
- 실행기가 정상 종료해도 남은 자손을 종료하고, 작업의 활성 프로세스 수가 0인지 확인한 다음 종료 코드를 전달한다. Codex의 표준 입출력과 검사 출력·종료 코드를 유지한다.
- 취소하거나 관리 프로세스가 종료되면 소유한 실행 연결부가 종료되고 OS가 해당 작업의 프로세스를 종료한다. UI 창 닫기는 기존처럼 관리 프로세스와의 연결만 끊는다. 진행 중인 승인과 구현을 다시 연결할 수 있다.
- 복원된 중단 작업의 이전 승인·검사는 계속 무효다. 모델 실행을 자동 재시작하거나 중단된 변경을 자동 반영하지 않는다.

## 선택 근거와 범위

Node가 사용하는 [libuv의 Windows 구현](https://github.com/libuv/libuv/blob/v1.52.1/src/win/process.c)은 직접 실행한 자식을 종료할 수 있지만 하위 프로세스가 벗어날 수 있는 작업 플래그를 사용한다. [foreground-child의 watchdog](https://github.com/tapjs/foreground-child/blob/main/src/watchdog.ts)도 검토했으나 이 기능에 필요한 Windows 전체 하위 프로세스 수명 관리의 근거로 삼지 않았다. 별도의 PID 검색·프로세스 목록 추적 대신 OS가 소유권을 유지하는 방식을 적용했다.

API 근거: Microsoft의 [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [생성 시 Job List 지정](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute), [Node 자식 프로세스](https://nodejs.org/api/child_process.html). 이 연결부는 프로젝트의 MIT 라이선스 코드이며 외부 watchdog 코드를 복사하거나 의존성을 추가하지 않았다.

이 기능은 프로세스 수명 관리이며 악의적인 동일 OS 계정 프로그램에 대한 보안 격리가 아니다. PowerShell/.NET 초기화 시간이 추가된다. Linux/macOS는 기존 프로세스 그룹 종료 경로를 유지하며, 이 문서의 강제 종료 보장을 해당 OS로 확대하지 않는다. 전원 손실, 운영 인증·결제 전체, 죽은 모델 세션을 새 세션으로 이어 실행하는 기능은 별도 검증·구현 대상이다.

## 재현

```sh
pnpm exec vitest run tests/owned-process.test.ts tests/agent-host.test.ts tests/agent-protocol.test.ts tests/agent-verification.test.ts --maxWorkers=1
pnpm extension:build
pnpm extension:package
pnpm extension:recovery-test
```

`tests/owned-process.test.ts`는 인자·바이너리 입출력·환경·종료 코드, 생성 실패, 실행기 정상 종료, 실행 연결부 강제 종료, 소유 프로세스 강제 종료를 검사한다. 분리된 자손의 실제 생존 상태와 파일 쓰기 중단을 확인하고, 관계없는 형제 프로세스의 생존도 확인한다. `agent-host` 시험은 EOF를 무시하는 실행기와 분리된 파일 작성기를 사용해 관리 프로세스 종료 후 원본 보존, 승인 무효화, 중단 기록 복원과 모델 요청 미반복을 확인한다. 시험용 작성기는 정리 신호와 수명 제한을 갖지만 종료 판정 기한보다 충분히 길게 실행한다.

`scripts/test-owned-process-live.mjs`는 `PUREOBOM_RUN_CODEX=1`과 선택적인 `PUREOBOM_CODEX_PATH`를 사용해 실제 Codex가 격리된 시험 폴더에서 Node 명령을 실행하는지 검사한다. 승인이 요청되면 실제 명령을 읽고 콘솔에서 명시적으로 결정한다. 설치본 복구 시험과 이 실제 모델 시험은 서로 다른 범위의 증거다.

## 2026-10-20 검증 결과

- [전체 회귀 28개 파일·233개 검사](evidence/system-workspace/2026-10-20/process-scope-regression.json) 통과. 강제 종료 뒤 분리된 작성기 중지, 관계없는 프로세스 보존, 중단 기록 복원과 원본 보존을 포함한다.
- [설치 VSIX의 여섯 번 독립 실행](evidence/system-workspace/2026-10-20/process-scope-installed.json)에서 승인 재연결, 실제 검사, 검토·반영·undo, 확장 호스트 강제 종료 중 반영 지속과 원본·Git 상태 복원을 확인했다. VSIX SHA-256: `6fa7634a706f8d02f371d24a0a0b1b719db11d951a6f7ba0c0997cecde2c975f`.
- [실제 Codex 0.163.0-alpha.10.2](evidence/system-workspace/2026-10-20/process-scope-live.json)가 이 실행 경로 안에서 터미널로 Node 명령을 실행하고 기대한 JSON 파일을 생성했다. 합성 응답이 아니며 명령 종료 코드 0과 파일 내용으로 확인했다. 전체 실제 모델 복구 흐름의 증거로 확대하지 않는다.
- [실제 VS Code 호스트 검사 33개](evidence/system-workspace/2026-10-20/process-scope-design-integration.json), 웹·확장 빌드를 통과했다.

초기 구현에서는 `cmd.exe` 인자 인용 문제를 발견해 수정했다. 이후 [작성기 준비 전 읽기 실패](evidence/system-workspace/2026-10-20/process-scope-host-initial-failure.json), [전체 회귀의 준비 시점·초기 연결 제한 실패 9개](evidence/system-workspace/2026-10-20/process-scope-regression-initial-failure.json)도 보존했다. 작성기 준비를 기다리고 시험용 초기 연결에 제품 연결 검사와 같은 15초를 주었다. 실제 턴 예산 500/1000ms, 제품의 실행 제한, 관측 시간 초과 시 재실행 금지는 유지한다. 수정 후 전체 233개를 다시 실행했다.

[요약과 검증 소스 해시](evidence/system-workspace/2026-10-20/process-scope-verification.json)는 직전 커밋의 Windows CI가 설계 호스트 검사에서 실패했다는 사실도 기록한다. [확보한 실패 로그](evidence/system-workspace/2026-10-20/process-scope-previous-ci-excerpt.txt)는 탐색어 저장 직후 `공유 탐색` 대신 빈 문자열을 관측한 단언 실패다. 호스트 API 시험과 실제 Webview의 동시 탐색 쓰기 가능성을 다음 조사 대상으로 남긴다. 이번 로컬 33개 통과를 그 CI 실패의 해결 증거로 바꾸지 않는다. 새 커밋의 원격 검사와 다른 OS의 실행 수명 처리는 계속 확인할 대상이다.
