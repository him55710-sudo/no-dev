# 공개 출시 실행안

제품 전략: [PRODUCT.md](PRODUCT.md). 문구는 준비한 초안이며 외부에 게시하거나 누구에게 보내지 않았다.

## 공개 전

1. 소유할 GitHub 계정·저장소를 정하고 준비된 소스를 공개한다. 실데이터, `.env`, 로그, 테스트 사용자 프로필은 배포에 넣지 않는다.
2. 저장소 URL을 README와 `extension/package.json`의 repository에 넣는다. 게시할 실제 publisher를 확보하기 전 `pureobom-local`을 Marketplace publisher라고 소개하지 않는다.
3. GitHub Actions 결과를 확인한 후 0.4.0을 **prerelease**로 만든다. VSIX·source.zip·demo.zip·SHA256SUMS를 첨부한다.
4. GitHub Pages의 Source를 GitHub Actions로 선택하고 `Publish browser demo`를 실행한다. 실제 배포 주소에서 Worker·비교·내보내기를 확인한 다음 README에 연결한다.
5. GitHub private vulnerability reporting을 켜고 보고 경로가 실제 작동하는지 확인한다. 기여 이슈에 재현 예제·난이도·완료 조건을 쓴다.

## 45초 데모 대본

| 시간 | 화면 | 말/자막 |
| --- | --- | --- |
| 0–5초 | shipping.ts 원본 | “AI가 만든 코드, 직접 고치려니 막혔나요?” |
| 5–12초 | VS Code 이야기·원본 행 이동 | “내 언어로 조건과 동작을 읽습니다.” |
| 12–20초 | 무료 배송 기준 50000 → 70000 | “설명 속 규칙을 바꿉니다.” |
| 20–30초 | 50000·60000·70000 전후 표 | “어느 주문이 달라지는지, 바꾸기 전에 확인합니다.” |
| 30–38초 | 원본 diff·적용·실행 취소 | “실제 코드에 적용하고, 다시 되돌릴 수 있습니다.” |
| 38–45초 | 비교 설명서·실제 공개 주소 | “Pureobom. Read it. Change it. Check it. JS/TS preview · local · MIT.” |

실제로 클릭해 작동한 화면만 촬영한다. 속도를 편집하면 시간 측정이라고 주장하지 않는다. 마지막에 미지원 기능이나 1만 스타 숫자를 성공 실적처럼 넣지 않는다.

## 영문 공개 글 초안

**Show HN: Pureobom — read JS/TS as a story, edit a rule, compare the outcomes**

I built Pureobom for people who can describe the product they want but struggle to inspect the code an AI generates. It is a local VS Code extension with Korean/English explanations, source links, editable rules and before/after input tables. The browser demo needs no account or API key.

Try changing a free-shipping threshold from 50,000 to 70,000. You can see which sample orders change before applying the code edit. Comparisons use a restricted AST interpreter, not arbitrary code execution. Unsupported cases stay unavailable. This preview supports JS/TS and literal/comparison edits; it does not generate entire features or prove correctness.

I would appreciate small, public examples where the explanation or edit is confusing. The project is MIT licensed. [Insert verified repository and demo URLs before posting.]

## 한국어 공개 글 초안

**AI가 만든 코드, 비개발자도 읽고 수정할 수 있게 — 풀어봄**

기획은 할 수 있는데 AI가 만든 코드를 읽고 고치기 어렵다는 문제에서 시작했습니다. VS Code에서 코드를 한국어 설명·규칙 표·연결 지도로 보고, 값이나 비교 조건을 바꾼 뒤 입력별 결과를 비교할 수 있습니다.

무료 배송 기준을 5만 원에서 7만 원으로 바꾸면 어떤 주문이 달라지는지 직접 체험할 수 있습니다. 계정·API 키 없이 로컬에서 동작합니다. 현재는 JS/TS 중심의 공개 시제품이고, 복잡한 기능 생성이나 실제 앱 전체 테스트는 지원하지 않습니다.

작은 공개 예제로 피드백을 주시면 설명과 지원 범위를 개선하는 데 도움이 됩니다. [실제 저장소·데모 주소 확인 후 삽입]

## 출시 후 4주

- 1주차: 동의한 사용자 5명의 첫 사용 관찰. 가장 자주 막히는 단계 한 가지부터 수정.
- 2주차: 실제 사용 예제 20건을 모집하고 미지원·오설명·성공을 구분. 재현 가능한 이슈를 공개.
- 3주차: 영문 데모·README로 한 번의 집중 공개. 커뮤니티 규칙과 홍보 허용 여부 확인. 피드백에 근거로 답변.
- 4주차: 재방문과 두 번째 변경 사례 확인. 검증된 개선과 남은 한계를 변경 기록으로 발행.

자동 게시·대량 메시지·스타 교환은 하지 않는다. README 배지는 실제 CI·릴리스 상태가 생긴 뒤 연결한다.
