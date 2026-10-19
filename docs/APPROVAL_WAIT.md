# 구현 실행 시간과 승인 대기

2026-10-20. 실제 Codex CLI 0.163.0-alpha.10.2와 설치한 0.7 VSIX를 연결한 외부 Next 앱 작업에서 승인 검토 시간이 기존 15분 구현 제한에 함께 포함되는 문제를 확인했다. 현재 팀 권한 구현과 추가 검사 파일까지 생성됐지만 모델 turn이 시간 초과로 종료됐다. 제품의 독립 검사·검토·반영·undo에는 도달하지 않았다.

[실패 기록](evidence/system-workspace/2026-10-20/installed-next-timeout.json)과 [화면](evidence/system-workspace/2026-10-20/installed-next-timeout.jpg)을 보존한다. 모델이 말한 고정 검사 9개 통과는 이 실패 기록에서 제품의 독립 검사 성공으로 간주하지 않는다. 원본의 추적 파일·HEAD·index·Git 상태가 그대로였고, 작업 복사본의 고정 검사·package.json·잠금 파일 해시도 유지됐다. 생성된 일곱 파일의 후보 해시는 기록에 남겼다.

## 수정한 동작

`CodexAppServer`는 실행 중 소비한 시간을 monotonic clock으로 계산한다. 처리되지 않은 승인 요청이 하나라도 있으면 실행 타이머를 멈추고, 마지막 요청이 처리되면 남은 시간부터 이어간다. 클라이언트의 허용·거절뿐 아니라 서버가 요청을 해소하는 `serverRequest/resolved`도 처리한다. 원래의 15분 실행 한도, 취소 처리, workspace-write와 on-request 정책은 유지한다.

`tests/agent-protocol.test.ts`는 실제 자식 프로세스와 stdio를 사용한다. 승인 대기가 전체 실행 예산보다 길어도 완료할 수 있는지, 두 요청 중 하나만 처리했을 때 계속 대기하는지, 대기 중 취소와 늦은 응답 거절, 서버의 요청 해소, 승인 뒤 실제 실행 시간 초과를 확인한다. 승인 전·후 실행 시간을 합하면 한도를 넘는 peer는 실패해야 하므로, 승인마다 예산을 초기화하는 오류도 구분한다. [실행 결과](evidence/system-workspace/2026-10-20/approval-timeout-tests.json)에 10개 통과를 기록했다. 이는 프로토콜 회귀 검증이며 수정 설치본의 전체 실제 모델 흐름 성공을 대신하지 않는다.

[관련 실행·복구 검사 13개](evidence/system-workspace/2026-10-20/approval-related-tests.json)와 확장 타입 검사·빌드·패키징도 통과했다. [수정 설치본의 다섯 단계 복구 검증](evidence/system-workspace/2026-10-20/approval-installed-recovery.json)은 재시작 후 검토·반영·undo, 반영 도중 실제 호스트 강제 종료, 다음 시작에서 원본과 staged/unstaged 변경 복원을 확인했다. 설치 파일 SHA-256은 `7e52db81873321c9cca6563b4521a9fdffb9ab7645806307be4c7588fc61c4f6`이다. 이 검증의 실행기는 결정적 프로토콜 fixture이며 외부 모델 품질이나 브라우저 포인터 조작의 증거는 아니다.

## Windows 접근 문제의 범위

해당 실제 모델 실행에서는 작업 복사본의 파일 읽기·수정에 명령별 승인이 반복해서 필요했다. 다만 종료 후 새 App Server 연결의 `command/exec`로 같은 cwd와 workspaceWrite 정책을 지정한 읽기 검사는 exit 0으로 성공했다. [직접 검사 기록](evidence/system-workspace/2026-10-20/compact-worktree-sandbox.json)을 보존한다. 보안 모드 변경이나 ACL 수동 변경은 하지 않았다. 이 결과만으로 모델 도구 경로의 접근 실패 원인이 해결됐다고 볼 수 없다.

[공식 App Server 문서](https://learn.chatgpt.com/docs/app-server#sandbox-read-access)는 workspaceWrite의 쓰기 경로와 읽기 정책을 구분한다. [공식 Windows 안내](https://learn.chatgpt.com/docs/windows/windows-sandbox#check-sandbox-read-access)는 접근 실패 시 실제 권한 설정과 Windows 파일 권한을 확인하도록 안내한다. 구현 타이머 수정과 이 환경 문제를 같은 수정으로 주장하지 않는다.

수정 설치본의 [후속 실제 모델 검증](INSTALLED_NEXT_FLOW.md)은 검사 명령 승인 요청을 처리한 뒤 독립 검사·검토·반영·재분석·되돌리기까지 완료했다. 이 실행에서는 일반 파일 수정에 반복 승인이 발생하지 않았지만 esbuild의 상위 폴더 읽기 때문에 검사 명령에는 개별 승인이 필요했다. 실행 성공을 모든 Windows 환경의 읽기 권한 문제가 해결됐다는 증거로 사용하지 않는다.
