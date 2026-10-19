# Rust 외부 프로젝트 편집·검사·복구

2026-10-20 KST. [humantime 2.3.0](https://github.com/chronotope/humantime/tree/7994b7129851ea3b0e5df8bee67870898e52fa1c), 커밋 `7994b7129851ea3b0e5df8bee67870898e52fa1c`의 원래 단위 테스트와 문서 예제 테스트를 실행했다. 보고서의 upstream 원문 인용에는 [MIT 라이선스](HUMANTIME_LICENSE.txt)를 적용한다. upstream 소스·테스트를 각색하거나 변경을 제출하지 않았다.

**정상적인 상수를 의도적으로 바꾸어 기존 테스트가 감지하는지 확인한 연동 검사**다. 실제 발견한 upstream 결함, 모델 수정 품질, 성능 향상으로 세지 않는다. 사용자가 지정한 실제 프로젝트의 서식 정리 결과는 [별도 평가](function-format.md)다.

## 실제 편집기 실행

Windows, VS Code 1.96.4 개발 호스트, 제품 커밋 `7df2ee6`에서 `src/duration.rs`의 `Parser<'_>::parse_unit`을 읽었다. 정수 시간 변환 분기의 `n.mul(3600)`에서 **L261의 네 글자만 `3601`로 변경**했다. 분수 시간의 다른 `3600`이나 테스트 기대값은 바꾸지 않았다.

원문 줄 이동, 한국어/영어 구조 설명, native Rust diff, 명시적 적용, 미저장 상태 검사 거절, 저장 후 실제 Cargo task, native undo·저장·재검사를 확인했다. 최초 적용은 편집기에만 반영되고 디스크 원본은 그대로였으며, 최종 원본 바이트 해시와 clean checkout을 대조했다.

| 단계 | 단위 테스트 통과/실패 | 문서 테스트 통과/실패 | 전체 통과/실패 | 종료 코드 |
| --- | ---: | ---: | ---: | ---: |
| 원본 | 38 / 0 | 4 / 0 | 42 / 0 | 0 |
| 검증용 값 변경·저장 | 32 / 6 | 2 / 2 | 34 / 8 | 101 |
| native undo·저장 | 38 / 0 | 4 / 0 | 42 / 0 | 0 |

건너뜀·필터링은 모두 0개다. 실패는 시간 단위·복합/분수 입력·왕복 변환 단위 테스트 6개와 `Duration`/`parse_duration` 문서 예제 2개다. 원본과 복구 파일 SHA-256은 `ffef134290916ee01befbd0464d3c413790878a7231352b83304766f08acf888`로 일치한다. [명령·원문 범위·한/영 설명·실패 목록·세 단계 결과](rust-source-project.json)를 공개한다.

## 환경과 준비 실패

Rust 1.90.0의 `x86_64-pc-windows-gnu` 도구와 `llvm-tools`를 검증 폴더에 설치했다. `Cargo.lock`으로 의존성을 고정하고 `cargo test --all-features --no-fail-fast --locked --offline --color never`를 사용했다. 이 실행은 기본 feature만의 별도 검사나 다른 OS/SDK 조합 검사가 아니다. upstream의 일부 왕복 검사는 난수를 사용하므로 실행 시간·실패 순서가 항상 같지는 않다.

첫 준비 과정은 GNU dlltool 경로 누락, dlltool subprocess 오류, LLVM 도구 파일 이름을 잘못 가정한 harness 오류, GNU 링커의 한글 경로 해석 실패, PowerShell 플래그 목록 조립 오류로 중단됐다. [다섯 시도의 진단·원자료 해시](rust-source-project-setup.json)를 보존한다. 모두 native 편집과 원래 테스트 실행 전의 준비 실패이며 제품 파서 오류나 프로젝트 테스트 실패로 집계하지 않는다.

LLVM의 동일 `llvm-ar` 바이너리를 `llvm-dlltool` 이름으로 연결하고 포함된 `rust-lld`와 정확한 개별 인자를 지정한 뒤 원본 42개가 통과했다. 실제 편집기에서도 같은 설정으로 전후·복구를 완료했다. 이는 프로젝트 테스트를 실행하기 위한 설정이며, 풀어봄의 Rust 읽기·값 수정은 해당 SDK를 호출하지 않는다. [재현 안내와 잠금 파일](../../../scripts/fixtures/humantime/README.md)에 과정과 범위를 기록했다. 모델·유료 API는 사용하지 않았고 최초 도구·의존성 준비에는 다운로드가 필요했다.

## 판정의 한계

`explained: 174 / total: 328`은 원문 구문 지원 개수이며 설명 정확도 점수가 아니다. 긴 바인딩 원문은 줄임표로 표시하고 match의 각 분기 원문은 별도로 남긴다. 튜플 내부 계산의 의미·타입·도메인 이유를 설명한 것으로 간주하지 않는다. 원문 읽기와 단일 값 편집이 실제 라이브러리의 기존 검사와 연결된다는 근거이며, 모든 Rust 코드의 안전한 수정·컴파일·소유권 확인·최적화를 보증하지 않는다.

검토자는 구현한 Codex이며 독립 제3자가 아니다. 이 외부 프로젝트 검사는 Windows 개발 호스트 실행이다. [Windows·Ubuntu 제품 CI](rust-source-ci.json)의 핵심 258개·개발/설치 각 54개는 별도 suite이며 이 외부 Cargo 검사를 포함하지 않는다.
