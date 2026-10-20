# 설치된 네이티브 Webview의 시작·통신 검증

2026-10-20. 설치된 0.7 개발판의 실제 VS Code Webview에서 JavaScript 시작, 호스트 상태 수신 뒤 캔버스 위치 저장, 탭 닫기·다시 열기를 확인한다. 기존 [브라우저 전송 검증](INSTALLED_DESIGN_UI.md)과 달리 `acquireVsCodeApi`, Webview HTML/CSP, 설치된 JS/CSS를 대체하지 않는다. 마우스·키보드 입력, 화면 모양, 모든 CSP 경로, 전체 네이티브 구현 흐름을 검증하는 검사는 아니다.

## 관찰 방법

`extension/test/nativeDesignStartup.ts`는 별도 설치 검사 드라이버에서 실제 제품의 `handleRequest`를 관찰한다. 들어온 요청을 기록한 뒤 기존 함수를 그대로 호출하며 결과·오류를 바꾸지 않는다. 관찰 구간에는 드라이버가 이 처리기를 직접 호출하지 않는다. 제품 파일과 Webview에 검사 스크립트를 삽입하지 않는다.

1. 실제 `pureobom.openWorkspace` 명령으로 설치 제품의 설계 탭을 연다.
2. React 진입점의 effect가 실제 `acquireVsCodeApi`로 보내는 `ready` 요청을 기다린다. 정적 HTML이나 확장 호스트의 분석 성공만으로 이 단계를 통과시킬 수 없다.
3. 호스트의 프로젝트 키·탐색 세대와 일치하는 `saveNavigation` 요청을 기다린다. 초기 React Flow 캔버스의 맞춤 배치가 저장되는 것으로, Webview가 호스트 상태를 받아 실제 캔버스 코드까지 실행한 근거다. 사용자가 노드를 드래그했다는 뜻은 아니다.
4. VS Code의 탭 API로 해당 `TabInputWebview`를 닫고 제품 명령으로 다시 연다. 새 `ready` 요청, 저장된 탐색 위치·설계 보존, 구현 작업 없음과 요청 오류 없음을 확인한다.

이 관찰은 설치 복구 검사 첫 단계에 포함되며, 이후 기존 승인 대기·재연결·검토·반영·되돌리기·반영 중 강제 종료 복구 검사를 계속한다. 이후 작업 조작은 기존처럼 호스트 요청 처리기를 직접 호출한다. 전체 복구 시험을 네이티브 사용자 입력 시험으로 확대하지 않는다.

## 실행 결과

Windows / VS Code 1.96.4 / Production 확장 모드. VSIX SHA-256은 `0fad84f815e10fb2239f6d147dea1e190b5f3ce9d425b038587a7b7a49165685`이며, 설치된 호스트·Worker·JS/CSS·안내 파일이 VSIX와 같은 바이트인지 기존 설치 검사에서 확인한다. 이 변경은 검사 드라이버에만 들어가며 제품 번들은 바꾸지 않는다.

실제 탭 종류는 `mainThreadWebview-pureobom.design`이다. 첫 실행에서 다음 요청을 관찰했다. 시간은 이 실행의 관찰 시작 기준이며 성능 기준이나 사용자 소요 시간이 아니다.

| 경과 시간 | 실제 Webview 요청      | 관찰                                  |
| --------- | ---------------------- | ------------------------------------- |
| 1,012ms   | `ready`, ID 1          | 설치된 React 진입점 시작              |
| 1,658ms   | `saveNavigation`, ID 2 | 현재 프로젝트·세대 0, 캔버스 1개 저장 |
| 1,999ms   | `ready`, ID 1          | 탭 닫기 뒤 새 Webview 시작            |

요청은 모두 완료됐고 설계·탐색 위치가 보존됐다. 이 구간의 구현 작업은 0개다. [전체 설치 검사 기록](evidence/native-webview-installed-recovery.json)의 첫 `phases` 항목에 `nativeWebviewStartup`으로 보관한다. 뒤의 복구 결과는 같은 보고서에서 별도로 확인한다.

동일 실행의 여섯 단계도 모두 완료됐다. 승인 대기 후 새 호스트 연결, 실제 검사·검토·반영, 재시작 후 되돌리기, 원본 세 파일 중 하나가 바뀐 시점의 검사 호스트 강제 종료, 새 호스트의 반영 완료·되돌리기를 확인했다. 원본 여섯 파일과 staged/unstaged 변경·HEAD·index가 보존됐다. 강제 종료 단계의 exit 1은 의도한 중단이며, 이후 복구까지 확인한 전체 드라이버의 종료 코드는 0이다. 결정론적 실행 fixture를 사용했으므로 실제 모델 실행 근거가 아니다.

## 재현

현재 빌드·VSIX가 준비된 저장소에서 `pnpm extension:recovery-test`를 실행한다. 제품을 바꿨다면 먼저 `pnpm extension:build`와 `pnpm extension:package`를 수행한다. 임시 프로젝트, 별도 VS Code 프로필과 확장 설치 경로를 사용하며 개발 중 원본 프로젝트나 사용자의 기존 프로필을 수정하지 않는다. 결과는 `test-results/installed-recovery.json`에 저장된다.

Windows와 Ubuntu CI의 기존 설치 복구 단계에서도 이 검사를 실행한다. 다른 OS에서의 결과는 해당 실행 기록이 통과한 뒤에만 주장한다. 소스 코드가 있다는 사실, Windows 통과 또는 브라우저 대체 전송 결과만으로 다른 환경의 네이티브 실행을 통과로 표시하지 않는다.
