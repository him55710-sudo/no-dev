# 원문 데이터 읽기와 수정 · JSON / JSONC

0.7 개발판의 브라우저와 데스크톱 VS Code에서 사용할 수 있다. 이 기능은 JSON 파서로 **실제로 저장된 키 경로·자료형·값·원문 줄**을 표시한다. Ollama, 모델 다운로드, API 키가 필요 없다. 공개 안정 릴리스 0.6.0의 기능으로 설명하지 않는다.

`{"retryLimit": 3, "enabled": false}`에서 확정할 수 있는 것은 숫자 `3`과 참·거짓 값 `false`가 저장됐다는 사실이다. 실제로 재시도가 세 번 실행되는지, `enabled`가 무엇을 끄는지는 이 데이터를 읽는 코드를 확인해야 한다. 여러 모델이 이 소비 동작을 추측했던 [실제 실패 기록](evidence/local-ai/semantic-review.md)을 바탕으로 추가한 경로다. 로컬 AI 탭의 모델 응답 자체가 정확해졌다는 의미는 아니다.

## 사용 순서

1. `.json` 또는 `.jsonc` 파일을 열고 **풀어봄: 현재 파일 설명 열기 / Pureobom: Explain current file**를 실행한다. [retry.jsonc 예제](../examples/local-ai/semantic/retry.jsonc)를 사용할 수 있다.
2. **문장으로 읽기 / Story**에서 저장된 값과 경로를 읽는다. 검색은 표시된 키 경로·값을 대상으로 한다. **원문 / Source**은 해당 줄을 연다.
3. 문자열·숫자·참거짓의 **값 바꾸기 / Edit value**를 선택한다. 숫자는 단위 없는 JSON 표기로 입력하고, 직접 수정의 문자열에는 바깥 큰따옴표를 붙이지 않는다.
4. 변경안을 만든 뒤 전체 원문 diff를 확인하고 명시적으로 적용한다. VS Code에서는 일반 undo로 되돌릴 수 있다. 브라우저는 메모리의 파일을 바꾸며 변경 기록에서 되돌린다. 체험 모드는 새로고침하면 초기화된다.

문장 요청은 키 경로 전체와 새 값 하나를 받는다. 예: `change $["enabled"] to true`, `$["retryLimit"]를 4로 변경`. 문자열 요청은 `change $["name"] to "new name"`처럼 새 값을 큰따옴표로 감싼다. 임의의 기능 생성이나 구조 변경 요청은 이 입력의 범위가 아니다.

## 보존하는 것과 범위

- 한 값의 원문 범위만 교체한다. 그 밖의 주석·공백·키 순서·개행·URL·끝 쉼표는 다시 직렬화하지 않는다. JSONC는 주석과 끝 쉼표를 허용하고 JSON은 엄격한 문법을 검사한다.
- 숫자는 JavaScript `Number`로 변환하지 않는다. `9007199254740993`, `-0`, 긴 소수와 지수 표기를 그대로 보여 주고 입력한 숫자 표기를 보존한다. 데이터를 읽는 다른 프로그램의 정밀도나 범위는 별도 문제다.
- 같은 객체의 중복 키는 모두 표시하고 해당 값과 하위 범위의 직접 수정을 막는다. 이스케이프 표기만 다른 같은 이름도 중복으로 처리한다. 어떤 키가 소비 프로그램에서 우선하는지 결정하지 않는다.
- 문자열·숫자·참거짓만 같은 자료형으로 수정한다. `null`, 키 이름, 객체·목록 전체는 원문에서 수정한다. 문법 통과가 소비 프로그램의 정상 동작을 보증하지 않는다.
- 표시 범위는 최대 300개 항목·12단계 깊이다. 긴 값의 미리보기는 200자, 경로는 최대 256자로 줄이고 생략 기호를 붙인다. 4096자를 넘는 원문 값은 직접 수정하지 않는다. 표시 제한은 전체 입력을 스트리밍 파싱한다는 뜻이 아니며, 기존 파일 크기 제한도 적용된다.
- 미리보기 후 파일이 바뀌거나 이미 적용한 변경안이면 적용을 거절한다. 신뢰하지 않은 VS Code 작업 공간에서는 읽기와 원문 이동이 가능하고 수정은 불가능하다.

[JSON 표준의 중복 키·숫자 상호운용성 설명](https://www.rfc-editor.org/rfc/rfc8259.html)과 [Microsoft jsonc-parser](https://github.com/microsoft/node-jsonc-parser)를 참고했다. 오류가 있어도 부분 트리를 반환할 수 있으므로 파서 오류 목록까지 확인하며, 속성 이름을 JavaScript 객체에 대입하지 않는다.

## 검증과 한계

핵심 검사는 [json-facts.test.ts](../tests/json-facts.test.ts), 실제 편집기 검사는 [integration.ts](../extension/test/integration.ts)에 있다. 원문 위치, 중복 키, Unicode·CRLF·CR 개행, 큰 숫자, 이스케이프 문자열, 잘못된 숫자, 표시 한도와 오래된 수정안을 검사한다. VS Code에서는 모델 없이 숫자 `3000`을 `9007199254740993`으로 미리보기·적용·undo하고 JSONC 주석·URL·끝 쉼표와 나머지 원문이 보존되는지 확인한다.

브라우저 실제 조작에서는 배송 체험의 `package.json`에서 버전 문자열 `1.0.0 → 1.1.0`의 미리보기·적용·undo, 한국어/영어 전환, 검색과 원문 이동을 확인했다. 390px 폭의 [한국어 화면](evidence/local-ai/json-facts-browser-ko-narrow.png)과 [영어 화면](evidence/local-ai/json-facts-browser-en.png)을 보존했다. 작업 중 발견한 이전 언어 알림 잔류는 언어별 문구를 저장하고 표시 시 선택하도록 수정한 뒤 다시 확인했다. 원문 문자열과 프로젝트 이름은 번역하지 않는다. 이 관찰은 네이티브 VS Code 화면 클릭이나 모든 장치의 접근성 인증이 아니다.

재현: `pnpm test`, `pnpm build`, `pnpm extension:build`, `pnpm extension:test`, `pnpm extension:package`, `pnpm extension:test:installed`. 설치 검사는 새 프로필의 VSIX·production 모드·런타임 해시를 확인한다. 일반 통합 검사의 별도 AI 사례는 제어된 HTTP 응답이며 실제 모델 정확도를 측정하지 않는다.

2026-10-16 로컬 결과: 핵심 169개, [개발 VS Code](evidence/local-ai/json-facts-development-integration.json)와 [설치 VSIX](evidence/local-ai/json-facts-installed-integration.json) 각각 같은 31개 흐름 통과. 설치본 SHA-256은 `2607c8e56093a8bba493286419fbfcd3611ce18b71438f823a46aa4efa5dd92e`. 웹·확장 빌드, VSIX/소스 ZIP/데모 ZIP의 체크섬·라이선스·독립 추출 Worker 검사도 통과했다.

English: the development preview now reads literal JSON/JSONC data without a model, links values to source, and edits one string, number or boolean with explicit preview/apply/undo. Numeric spelling and unrelated source text are preserved. Duplicate-key ranges are read-only. Consumer behavior, schema validation, cross-file usage and optimization remain separate work; this is not a claim that model explanations are reliable in every language.
