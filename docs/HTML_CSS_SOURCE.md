# HTML/CSS 원문 읽기와 값 수정

기능 소스 `20de714`의 [Windows·Ubuntu CI](https://github.com/him55710-sudo/pureobom/actions/runs/38888312338): 각 핵심 200개, 개발/설치 각 38개, 패키지 도구 실행 통과. [상세 원자료](evidence/local-ai/web-source-ci.json).

0.7 개발 소스의 기능이다. 공개 안정판 0.6.0과 기존 Pages 데모에는 아직 반영되지 않았다. 브라우저와 데스크톱 VS Code의 공통 분석 Worker에서 동작하며 API 키·Ollama·별도 언어 실행기가 필요 없다.

## 읽기 범위

- HTML: 원문에 위치가 있는 요소·속성·문구와 원문 줄. 파서가 구조를 보정할 수 있으며 원문에 없는 html/head/body 래퍼는 생략한다. 문구가 실제로 보이는지, 요청이 어떻게 처리되는지, 접근성이 적절한지는 확인하지 않는다.
- CSS: 선택자·앳 규칙·정확한 선언 값·`!important`. `repeat(auto-fit, minmax(...))`를 고정 열 개수로 설명하지 않는다. 선택자 매칭·상속·우선순위·브라우저 지원·최종 계산값·성능은 실제 페이지에서 별도 확인해야 한다.
- 원문은 데이터로만 파싱한다. 스크립트 실행, HTML 렌더링, 외부 스타일·이미지·폰트·URL 요청을 하지 않는다. 원문의 태그 문자열도 UI에서는 텍스트로 표시한다.

[parse5의 위치/진단 기능](https://parse5.js.org/interfaces/parse5.ParserOptions.html)과 [CSS Tree](https://github.com/csstree/csstree)를 사용한다. CSS Tree는 오류 복구를 지원하므로 [파싱 문서](https://github.com/csstree/csstree/blob/master/docs/parsing.md)의 오류 콜백과 토큰 닫힘 검사를 함께 사용한다. 파싱 통과는 HTML 적합성 검사나 CSS 속성값 전체의 유효성 검사가 아니다.

## 수정 범위

HTML은 일반 텍스트와 `alt`, `title`, `placeholder`, `aria-label`, `aria-description`의 값 하나를 수정한다. `&`, `<`, `>`와 속성의 따옴표를 인코딩한다. script·style·title/textarea 등 특수 텍스트 영역, template, SVG/MathML 내부, URL·이벤트 핸들러는 직접 수정 대상이 아니다. 파서가 합쳐 원문 범위가 모호한 텍스트도 제외한다. title 요소의 텍스트와 title 속성은 서로 다른 대상이다.

CSS는 선언 값 하나를 수정한다. 주변 공백, 주석, 다른 선언, `!important`는 원문 그대로 남긴다. 값 내부에 주석이 있으면 직접 수정을 제공하지 않는다. 새 선언이나 `!important`를 끼워 넣는 입력, 닫히지 않은 토큰, 알려진 속성 문법과 맞지 않는 값은 거절한다. 사용자 정의 속성·변수·새 속성의 검사는 제한적이며 미래 CSS는 거절되거나 해석하지 않은 원문으로 남을 수 있다.

원문 오류가 보고되면 수정 버튼을 막는다. HTML 조각의 doctype 생략은 허용한다. 문장 요청에는 표의 이름 전체(`@위치` 포함)와 큰따옴표로 감싼 새 값 하나를 사용한다. CSS 값은 `"24px"`처럼 단위도 넣는다. 직접 값 입력란에서는 CSS 값 자체를 입력한다.

1. [HTML 예제](../examples/local-ai/source.html) 또는 [CSS 예제](../examples/local-ai/source.css)를 연다.
2. 문구/값 옆 **바꾸기**를 선택한다.
3. 변경안을 확인한다. VS Code에서는 HTML/CSS 언어가 유지된 native diff가 열린다.
4. **적용**을 눌러 편집기에 반영한다. 저장은 별도이며 되돌리기를 지원한다.
5. 실제 페이지에서 결과를 확인한다. 원문 변경 뒤 오래된 변경안은 재사용할 수 없다.

## 한도와 재현

파일 128 KiB, 표시 300개 항목·12단계, 미리보기 240자, 수정 값 4096자 한도다. 잘린 미리보기로 원문을 대체하지 않는다. 브라우저의 일반 파일 가져오기 한도 512 KiB와 별도다. Sass/Less·템플릿 언어 전체 지원은 아니다.

`tests/web-source.test.ts`는 Unicode/CRLF, 엔티티/따옴표, 중복 속성과 오류 복구, 재배치된 텍스트, 주석·공백·중요도 보존, 반복 선언, 정밀 숫자, 구문 탈출 입력, 한도, 한국어/영어 inert UI와 편집 비활성화를 검사한다. `extension/test/webSource.ts`는 실제 편집기의 원문 이동·diff·적용·재분석·undo·오래된 제안 거절을 검사한다. `scripts/check-release.mjs`는 저장소 밖으로 추출한 Worker에서 파서를 실행한다.

```powershell
pnpm exec vitest run tests/web-source.test.ts
pnpm build
pnpm extension:build
pnpm extension:test
pnpm extension:package
pnpm extension:test:installed
pnpm release:package
pnpm release:check
```

전체 통합 검사에는 기존 Python/Go 기능의 실행기도 필요하다. HTML/CSS 파싱 자체에는 필요하지 않다. [외부 modern-normalize 검증](evidence/local-ai/web-source-project.md)은 실제 VS Code에서 CSS 값 변경 후 Chrome 검사 실패가 7개에서 9개로 늘고 undo 후 원래 7개로 복구되는 것을 확인했다. 원본부터 있던 실패와 assertion 없는 TODO 8개를 공개한다. HTML은 원문 읽기만 확인했으며 전체 렌더링·접근성·모든 브라우저·모델 설명의 의미 정확성 검증은 남는다. 구현·실패·검증 결과는 [작업 기록](AGENT_WORKLOG.md)에서 추적한다.

마지막 CSS 주석/반복 선언 식별자 수정 후 [설치 통합 38개](evidence/local-ai/web-source-final-installed-integration.json)가 통과했다. VSIX `88761109…`의 production 모드와 7개 런타임 해시를 확인했다. [실제 한국어/영어 화면](evidence/local-ai/web-source-native.md)의 설치본은 이 후속 수정 전이며 별도 해시로 기록했다.
