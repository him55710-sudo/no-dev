# UX 개편 검증 기록

검증일: 2026-10-20 (Asia/Seoul). 설치 파일: `release/pureobom-0.7.0-ux-preview.vsix`.

## 실제 실행 결과

| 검증 | 결과 | 범위 |
| --- | --- | --- |
| 단위 테스트 | 합계 226개 통과 | 최초 실행 202개 통과. SDK 경로가 없어 시작하지 못한 Go·Java·C# 24개는 로컬 SDK 경로 설정 후 별도 재실행하여 전부 통과 |
| VS Code 통합 테스트 | 46개 시나리오 통과 | VS Code 1.96.4 실제 확장 호스트. 원문 이동, 변경안, 편집 적용·실행 취소, 오래된 변경안 거절, 언어별 분석, 로컬 AI 제안 검사, 프로젝트 검사·측정 |
| 확장 빌드 | 통과 | TypeScript 검사 및 확장·Worker·Webview 번들 |
| 기존 브라우저 앱 빌드 | 통과 | 공유 ScenarioLab의 포커스 변경 포함 |
| VSIX 패키징 | 통과 | manifest 0.7.0, 별도 UX 미리보기 파일명. 패키지의 UI·호스트·Worker 파일과 빌드 산출물 바이트 일치 확인 |

명령: `pnpm test`, `pnpm exec vitest run tests/go-source.test.ts tests/java-source.test.ts tests/csharp-source.test.ts`, `pnpm extension:test`, `pnpm extension:build`, `pnpm build`, `node scripts/package-extension.mjs --output=release/pureobom-0.7.0-ux-preview.vsix`.

Go·Java·C# 검증에는 `test-results/tools`에 준비된 SDK와 `PUREOBOM_TEST_GO`, `PUREOBOM_TEST_JAVA_HOME`, `PUREOBOM_TEST_DOTNET`, `JAVA_HOME`, 해당 SDK의 `PATH`를 실행 프로세스에 지정했습니다. 전역 환경 설정은 변경하지 않았습니다.

실제 호스트 결과: [ux-extension-integration.json](ux-extension-integration.json). 패키지 해시와 바이트 비교 결과: [ux-package-verification.json](ux-package-verification.json).

## UI에서 직접 확인한 흐름

`node scripts/preview-ui.mjs`로 실제 확장 UI 번들과 실제 분석 Worker를 연결한 로컬 하네스를 실행했습니다. VS Code 연결만 모의 구현이며, 원문 이동·네이티브 diff·실제 편집기의 적용/실행 취소는 위 통합 테스트로 따로 확인했습니다. 하네스는 예제 데이터를 메모리에서 수정하며 프로젝트 원본 파일을 저장하지 않습니다.

- 한국어 설명에서 배송비 기능의 입력·조건·반환값을 읽고, 문장/구조 흐름을 전환했습니다.
- 무료 배송 기준 50000 → 70000을 입력하고 현재/변경 후 값, 아직 미적용 상태를 확인했습니다.
- 예시 7개를 실제 Worker로 비교했습니다. 50000, 50001, 69999에서 결과가 0 → 3000으로 달라졌고, 나머지 4개는 같았으며 확인 불가 사례는 없었습니다.
- 변경안을 만든 뒤 입력을 다시 바꾸면 이전 변경안이 제거되는 것을 확인했습니다.
- 규칙 선택 → 입력, 변경안 생성 → 미리보기, 계산 → 결과, 적용 → 성공 알림, 잘못된 숫자 입력 → 오류 안내로 키보드 포커스가 이어짐을 확인했습니다.
- `7만` 입력은 오류로 안내하고 적용하지 않았습니다. `70000`으로 고친 뒤에는 변경안을 만들 수 있었습니다.
- 적용 후 값 갱신과 확인하기로 이동하는 다음 행동을 확인했습니다.
- 360×900 화면에서 한국어·영어 읽기와 한국어 수정·미리보기를 확인했습니다. 페이지 clientWidth와 scrollWidth가 모두 345px로, 페이지 전체의 가로 넘침은 없었습니다. 주요 3단계는 첫 줄, 보조 2도구는 다음 줄에 배치됩니다.
- 넓은 화면에서는 목록과 편집 영역이 나란히 배치되는 것을 확인했습니다. 검증 후 화면 폭 설정을 기본값으로 복원했습니다.
- 브라우저의 수집된 error/warn 로그는 없었습니다.

## 화면 기록

[읽기 화면](ux-reading.png) · [변경 전후 비교 화면](ux-change.png)

## 판단의 한계

이는 기능·레이아웃·상호작용 검증입니다. 비개발자 대상 사용성 실험이나 스크린리더의 실제 음성 출력을 평가한 결과가 아닙니다. 어두운 테마·고대비 테마는 VS Code 테마 변수를 사용하도록 구현했으나 이번 브라우저 화면 검증은 밝은 테마로 수행했습니다. 사용자 평가 과제와 판단 근거는 [UX-DESIGN.md](UX-DESIGN.md)에 기록했습니다.
