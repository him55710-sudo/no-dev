# 설치본의 언어·취소·파일 상태 확인

2026-10-16, Windows / VS Code 1.96.4. 새로운 사용자 프로필·확장 폴더에 0.7.0 개발 VSIX를 CLI로 설치하고 네이티브 창을 클릭·키보드로 조작했다. 개발 확장 경로는 사용하지 않았다. `examples/shipping.py` 복사본과 크기/미지원 상태 검증용 파일만 사용했다. Ollama 0.40.5는 루프백 11435에서 클라우드 비활성화 상태로 실행 중이었다.

관찰한 VSIX SHA-256: `afad9ed1fbc19ec7306dbf807922c8dcd645464006a0435766858ab51717baa3`.

| 흐름 | 직접 관찰한 결과 |
| --- | --- |
| 새 설치본 열기 | 약 350px 폭의 패널에서 한국어 로컬 AI, 실제 프로젝트 검사, 전후 측정 영역이 나타남. 탭 줄바꿈과 폼 스크롤 가능 |
| 연결·언어 전환 | 실제 설치 모델 7B/3B 목록. `로컬 전용 설정을 확인했습니다.`가 영어 전환 후 `Local-only mode confirmed.`로 바뀜 |
| 진행 중 언어 변경 | 7B 영어 설명 요청의 작업 중 상태에서 한국어로 전환. 작업 중 표시가 사라지고 재요청 버튼 활성화. 이전 영어 결과가 표시되지 않음 |
| 취소 뒤 재요청 | 3B를 선택해 한국어 설명 재요청. 실제 응답 32.6초, 인용 1개, 수정 제안 없음. 소스 편집은 하지 않음 |
| 완료 응답의 언어 변경 | 영어로 전환하면 한국어 응답을 숨기고 `The previous response was generated in Korean. Send a new request for an English explanation.` 표시 |
| 큰 파일 | 29,402바이트 Python 파일을 열면 24,000바이트 한도, 조건 안내, 비활성화된 요청 버튼 표시. 이전 파일 결과 없음 |
| 미지원 파일 | `notes.txt`로 전환하면 파일 열기 안내로 돌아오고 이전 파일의 모델 응답·요청 폼 없음 |

## 실제 모델 응답의 한계

한국어 요약은 “이 코드는 주문의 총 금액에 따라 배송비를 계산하는 간단한 예시입니다. 무료 배송 기준이 50,000원 이상일 경우 배송비는 0원입니다.”였다. 인용은 `FREE_SHIPPING_THRESHOLD = 50_000`과 `SHIPPING_FEE = 3_000` 두 상수뿐이다. 음수 입력의 `ValueError`, 기준 미만에서 기본 배송비를 반환하는 분기와 실제 비교 코드가 빠졌다. 원 단위도 원본에 지정돼 있지 않다. 화면 동작 성공이며 설명 정확성 통과로 세지 않는다.

## 발견과 후속 수정

- 이전 설치 창에서 언어를 바꿔도 적용 안내가 한국어로 남는 것을 관찰했다. 현재 UI는 안내를 언어별 값으로 보관하고 선택 언어로 표시한다.
- 생성 결과에 응답 언어를 기록하며, 언어 변경 시 진행 요청을 취소하고 늦은 결과를 무시한다. 영어 화면에 이전 한국어 결과를 그대로 보여 주지 않는다. 문서의 HTML `lang`도 동기화한다.
- 큰 파일의 요청 버튼은 올바르게 막혔지만 헤더는 `Local AI explanation available`이라고 표시했다. 미지원 파일에서도 `Analyzed locally`로 표시됐다. 관찰 **후** 각각 `No built-in syntax explanation`, `Waiting for a supported file`로 바꿨다. 위 네이티브 관찰 VSIX보다 이후의 문구 변경이며 빌드와 후속 설치 통합 검증으로 구별한다.
- 네이티브 메뉴의 별도 창 때문에 한 번의 언어 옵션 클릭이 거절됐다. 창 상태를 다시 확인한 뒤 키보드로 선택했다. 화면 밖 버튼의 첫 클릭도 실행되지 않아 스크롤 후 다시 확인했다. 이를 제품 생성 실패나 성공한 요청으로 세지 않는다.

## 자동 검사와 구별

`pnpm extension:build`, `pnpm extension:package`, `pnpm extension:test:installed`로 새 VSIX를 매번 별도 프로필에 설치한다. 제품의 경로·버전·실제 production 모드와 런타임 파일 5개의 SHA-256이 VSIX 내용과 같은지 확인한 뒤 실제 VS Code 통합 30개 흐름을 실행한다. 테스트 진입점만 별도의 개발 확장이며 제품은 설치본이다. [설치 통합 원자료](installed-vsix-integration.json).

자동 검사의 AI 응답은 제어된 HTTP fixture다. 위 클릭 검증은 실제 Ollama이며, 실제 프로젝트 검사·측정 **실행 버튼**을 클릭한 기록은 아니다. 명령 실행·실패·취소·전후 측정은 설치본 통합 검사와 외부 프로젝트 원자료가 별도로 검증한다. 연결 실패/빈 모델 목록의 네이티브 화면, 영어 응답의 의미 정확성, Linux 네이티브 조작과 모든 언어 조합을 검증했다고 주장하지 않는다.

English: a fresh installed preview was checked with native Windows UI actions for Korean/English notices, cancellation on language change, hiding a response generated in another language, oversized input and unsupported files. A real 3B Korean explanation completed but omitted important branches. Automated installed-VSIX integration uses controlled AI fixtures and is separate from these UI observations.
