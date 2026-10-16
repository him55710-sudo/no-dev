# HTML/CSS 원문 읽기와 실제 Chrome 검사

2026-10-16, Windows 11 · Node 24.19.0 · VS Code 1.96.4 · Chrome 실행 파일 155.0.8059.79 · TestCafe 3.7.6. [원자료](web-source-project.json), [재현 명령과 의존성 잠금](../../../scripts/fixtures/modern-normalize/README.md), [upstream MIT 라이선스](MODERN_NORMALIZE_LICENSE.txt).

대상은 [modern-normalize v3.0.1](https://github.com/sindresorhus/modern-normalize/tree/3faa07fc91b8ffbe6243bc4f91e880a00185d0a2), 소스 커밋 `3faa07fc91b8ffbe6243bc4f91e880a00185d0a2`다. annotated tag 자체의 object ID와 구분한다. 브라우저 테스트 파일과 HTML은 수정하지 않았다.

## 확인한 흐름

실제 VS Code 개발 호스트에서 `test/page/with-css.html`의 요소·속성·문구와 `modern-normalize.css`의 선택자·선언을 읽었다. 한국어/영어 원문 설명 트리와 편집 범위를 JSON에 남겼다. HTML은 읽기만 확인했으며 HTML 변경 후 브라우저 동작 검사로 확대 해석하지 않는다.

CSS의 `box-sizing: border-box`를 `content-box`로 바꾸는 **의도적인 오류**를 만들었다. 원문 줄 이동 → native CSS diff → 정확한 값 하나 적용 → 미저장 실행 거절 → 저장 → 전체 Chrome 검사 → 편집기 undo·저장 → 동일 검사 순서다. 미리보기는 원본을 바꾸지 않았고 적용도 자동 저장하지 않았다. 모델이나 API를 사용한 제안, 최적화 성공 사례가 아니다.

| 상태 | pass | fail | skip | task 종료 |
| --- | ---: | ---: | ---: | ---: |
| 원본 | 47 | 7 | 0 | 1 |
| border-box → content-box | 45 | 9 | 0 | 1 |
| undo·저장 후 | 47 | 7 | 0 | 1 |

새 실패는 **box-sizing**과 **hr 높이** 검사다. 기존 실패 7개를 유지한 채 2개가 추가됐고, undo 후 원래 실패 집합·개수로 돌아왔다. 원본/복구 SHA-256은 `b4ad31da9b1b17de182a08e4c39159496574d90a82464c6d5afeda7133f0e110`, 변경본은 `fb02ed98c9072d373ddfb6da2cefad6a1a572c85014956653e427ccddfa480db`다. CSS 표시 51개·편집 가능 값 31개, HTML 표시 81개를 읽었고 표시 한도에 도달하지 않았다. 각 실행 뒤 남은 전용 Chrome 프로세스 6개씩을 정리했고 최종 8080 포트와 검증용 Chrome이 남지 않았음을 확인했다.

54개에는 `expect` 호출이 없는 TODO 테스트 **8개**가 포함돼 있다. 원본 통과 47개를 47개 동작이 검증됐다는 뜻으로 쓰지 않는다. TypeScript AST로 테스트별 `expect` 호출 유무를 목록화했으며 런타임 assertion 개수나 커버리지 점수는 아니다. 두 원본 Chrome 파일 전체를 필터 없이 실행했다.

## 원본부터 있던 7개 실패

| 파일/테스트 | 기대값과 관측값의 차이 |
| --- | --- |
| rules·validation: text decoration | `underline dotted rgb(0, 0, 0)` 기대, `underline dotted` 관측 |
| rules·validation: clickable appearance | `-webkit-appearance`의 `button` 기대, `undefined` 관측 |
| rules: search appearance | `textfield` 기대, `undefined` 관측 |
| rules: outline offset | `0px` 기대, `-2px` 관측. 원본 CSS도 `-2px`를 선언 |
| validation: bold weight | `900`이 아니기를 기대하지만 원본 CSS 없는 페이지도 `900` 관측 |

이 환경의 원본 기대 불일치다. 통과하도록 upstream 테스트를 바꾸거나 실패한 테스트를 제외하지 않았다. 복구 후에도 원래 실패 7개는 남는다. 제품은 실제 task 실패와 종료 코드 1을 표시한다. 검사 개수와 추가 실패 비교는 이 개발 검증 harness가 JSON에서 읽으며, 제품 UI가 모든 테스트 실행기의 출력 형식을 해석하는 기능은 아니다.

## 준비·실행 중 발견한 문제

- 부모 workspace 때문에 첫 pnpm 설치가 외부 의존성을 설치하지 않았다. 외부 경로와 `--ignore-workspace --prod=false --ignore-scripts`를 명시해 557개 패키지를 설치했다. upstream의 범위 버전을 최초 해석한 잠금 파일을 공개하며 재현은 `--frozen-lockfile`을 사용한다. 테스트용 의존성을 제품 런타임에 추가하지 않았다.
- 첫 독립 실행은 테스트 7개 실패와 JSON의 exitCode 1에도 프로세스가 0으로 종료됐다. TestCafe의 `async-exit-hook 1.1.2`가 `beforeExit`를 고정 0으로 처리하는 것을 소스에서 확인했다. 서버/브라우저 정리와 파일 기록을 기다린 뒤 명시적인 종료 코드를 전달하도록 adapter를 고쳤다. 후속 실제 VS Code task에서 종료 코드와 JSON 값을 대조한다.
- 첫 편집기 실행은 Chrome 연결 2분 제한으로 실패했다. 남아 있던 검증용 Chrome을 정확한 임시 프로필로 식별해 정리하고, Electron crashpad pipe 상속도 제거했다. 다음 실행의 원본 검사는 끝났지만 변경본에서 같은 연결 실패가 재발했다. 실패 원자료를 두 건 모두 남겼다.
- TestCafe가 전역 임시 디렉터리의 프로필을 재사용하고 이전 Chrome이 살아 있는 것을 관찰했다. 매 실행마다 고유 임시 디렉터리를 먼저 만들도록 수정했다. Windows에서는 기본 정리 후 남은 Chrome도 해당 실행의 고유 프로필 경로에 일치하는 프로세스만 종료한다. 사용자 Chrome 프로필과 창은 대상에 넣지 않는다.

## 재현 범위와 제한

[검증 harness](../../../scripts/test-web-source-project.mjs)는 고정 커밋·변경 없는 원본·의존성 잠금을 먼저 확인한다. 별도 VS Code 프로필을 열고 기존 tasks.json이 없을 때만 임시 생성해 끝에 제거한다. 원본 복구와 처음 git 상태를 대조하며 실패 시에도 CSS를 복구한다. 외부 checkout에는 최초 설치로 생긴 untracked `pnpm-lock.yaml`이 남으므로 완전히 빈 git status라고 표현하지 않는다.

[브라우저 실행 adapter](../../../scripts/run-modern-normalize-tests.mjs)는 upstream `http-server .` 대신 `127.0.0.1:8080`에서 정확히 두 HTML과 CSS 세 파일만 제공한다. 제공한 파일 내용은 upstream 그대로다. 서버는 directory listing이나 임의 파일 경로 접근을 제공하지 않는다. TestCafe의 [실행 API](https://testcafe.io/documentation/402655/reference/testcafe-api/runner/run)와 [JSON reporter](https://testcafe.io/documentation/402656/reference/testcafe-api/runner/reporter)를 사용하며 전체 실행은 300초 한도다.

확인한 외부 환경은 Windows·Chrome 한 조합이다. Firefox·Safari·다른 Chrome 버전, 전체 접근성·모바일 화면·시각적 완성도·렌더링 성능을 검사한 것은 아니다. 이 사례에서는 stylelint와 upstream `test:all`도 실행하지 않았다. 의존성/VS Code 설치에는 네트워크가 필요하지만 이 고정 파일 검사에는 유료 API나 Ollama가 필요 없다. 공개 0.6.0/Pages는 그대로이며 0.7 개발 소스의 근거다.
