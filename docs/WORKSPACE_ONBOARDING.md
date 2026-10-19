# 설치 후 시스템 설계로 시작하기

2026-10-20. 설치 README와 사이드바 제목이 기존 단일 파일 도구를 중심으로 설명하고, 개발판 도움말이 예전 저장소의 릴리스로 연결되던 문제를 정리했다.

## 바뀐 시작 경로

- 사이드바와 명령 팔레트의 **시스템 설계 시작 안내**는 VS Code의 기본 Walkthrough를 연다. 별도 웹 서버나 모델 없이 설치본의 Markdown 네 개를 읽는다.
- 프로젝트 열기·구조 탐색, 기능 선택·설계 작성, Git/Codex/검사 준비, 검토·반영·복구를 순서대로 설명한다. 실제 프로젝트 열기·설계 화면·실행기 설정 명령으로 연결한다.
- 안내의 체크 표시는 열람·명령 실행 기록으로 명시한다. 프로젝트의 검사 통과나 자연어 목표 충족을 대신하지 않는다.
- 확장 설명·사이드바·설치 README를 시스템 설계 중심으로 바꾸고, 기존 단일 파일 도구의 범위를 별도 구분한다. 시스템 설계 안내는 한국어로 제공한다.
- 현재 소스·버그·피드백·개발판 설치 링크는 `no-dev`로 연결한다. 과거 0.6 배포 링크는 과거 기록으로 유지한다. 공개되지 않은 0.7 설치 파일을 이미 다운로드할 수 있다고 안내하지 않는다.

사용자 순서: [시작 안내](SYSTEM_WORKSPACE_START.md). 구현 방식 참고: [VS Code Walkthrough contribution](https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs).

## 검사 중 수정한 항목

제품 링크 검사 하나가 이전 저장소 경로를 기대해 실패했다. 현재 `no-dev` 경로와 기존의 고정 목적지·본문 미포함 조건을 확인하도록 수정했고 관련 검사 5개가 통과했다.

첫 설치 검사는 `package.json` 전체 해시에서 실패했다. 설치된 파일에 VS Code의 `__metadata`가 추가됨을 확인했다. 이를 제외한 **전체 manifest 내용 일치**와 설치 출처 `vsix`를 검사한다. 실행 번들·안내 파일·번역·README는 여전히 바이트 해시로 비교한다. 후속 실행은 검사 스크립트에서 설치 파일 목록을 예제 프로젝트 목록에 잘못 넣어 준비 단계에서 실패했으며, 두 목록을 수정한 뒤 다시 실행했다. 두 실패를 제품 실행 성공으로 계산하지 않는다.

## 검증 범위

[설치 실행 기록](evidence/onboarding-installed-recovery.json): Windows / VS Code 1.96.4의 새 프로필에 VSIX를 설치한 뒤 여섯 차례 독립 실행을 마쳤다. 첫 실행에서 `pureobom.getStarted`가 `Welcome` 탭을 열고 설계·작업 상태를 바꾸지 않는 것을 확인했다. 이후 승인 대기 재연결·검토·반영·재시작 뒤 undo와 반영 도중 강제 종료·재연결 복구를 확인했다. 검사한 원본 6개 파일과 Git HEAD/index 및 staged/unstaged 변경을 보존했다.

최종 VSIX는 1,845,625바이트이며 SHA-256은 `2bd014e1a87b94786c8e406745ac6a2f3780c2443edd818ac64120929bd37959`이다. 앱·확장 빌드와 패키지 검사가 통과했다. 안내 파일 네 개는 VSIX·소스 ZIP에서 현재 소스와 바이트 단위로 비교한다. 설치 manifest는 VS Code가 붙인 설치 정보만 제외하고 전체 비교한다. 실행 로그의 인증 공급자 대기·mutex 경고와 한 차례 종료 뒤 file-watcher crash는 이 명령·복구 검사의 실패로 이어지지 않았지만, 네이티브 화면 전체의 정상 동작 증거로 삼지 않는다.

재현:

```sh
pnpm exec vitest run tests/feedback.test.ts
pnpm build
pnpm extension:build
pnpm extension:package
pnpm extension:recovery-test
pnpm release:package
pnpm release:check
```

이 검증은 설치된 확장의 명령 호출과 호스트 상태를 확인한다. 네이티브 Walkthrough의 버튼을 마우스로 누르거나 모든 Markdown 배치를 시각 검수한 결과는 아니다. 재시작·검토·반영·undo 시험의 구현 실행기는 명시적인 로컬 결정적 fixture이며 새 외부 AI 실행이 아니다. 전체 기획의 나머지 검증은 [상태 표](SYSTEM_WORKSPACE_STATUS.md)에 유지한다.
