# 로컬 AI 검증 자료 · 2026-10-16

현재 자료는 자동 연결 검사, 실제 모델 응답, 외부 프로젝트 연동과 성능 측정을 구별한다. 공개 소스와 합성 예제만 사용했다. 사용자 비공개 코드·키·개인정보는 포함하지 않았다.

| 자료 | 실제 확인 내용 | 해석 한계 |
| --- | --- | --- |
| [Python 설명](python-explain.json) | Ollama 0.40.5, qwen2.5-coder:3b, 한글 설명과 원문 인용 | 합성 배송 예제 1회, 의미 정확성 전체 보장 아님 |
| [Python 수정](python-edit.json) | 무료 배송 기준 변경 제안, 원문 일치 확인 | CLI 제안 생성; 편집기 적용 검사와 별도 |
| [한국어 요청 보강 후 설명](python-explain-language-guard.json) | 기본 요청을 한국어로 바꾸고 한국어 문장 최소 검사 후 실제 모델 재실행, 10.9초 | 한국어 응답은 받았지만 파일 주석만 요약해 배송비 계산 설명이 부족함. 설명 품질 성공 사례로 세지 않음 |
| [VSIX 설치본 화면](installed-ui.md) | 별도 설치 프로필에서 실제 Ollama 연결 → 한국어 수정 요청 → diff → 명시적 적용 → 디스크 무저장 확인 → Ctrl+Z → 영문 UI 전환 | 합성 Python 예제 1건. 모델 설명의 부정확한 시제도 관찰. 영어 모델 응답 검증과 별도 |
| [언어별 28회 응답과 의미 검토](language-review.md) | 14개 언어 식별자의 합성 파일에 실제 설명·수정 요청. SQL 수정 1건은 원문 근거 불일치로 거절 | CSS·JSONC 등의 틀린 설명, JS의 잘못된 확인 항목, Python/Go 설명 누락 발견. 형식 통과를 의미 정확성으로 세지 않음 |
| [VS Code 통합](vscode-controlled-integration.json) | 19개 실제 VS Code 검사. 새 AI 검사는 제어된 HTTP 응답으로 다중 편집·undo·오래된 제안·취소·문법 오류 적용 거절 확인 | 새 AI 3개 사례는 실제 모델 추론이 아님 |
| [JSONC 보강 후 VS Code 통합](vscode-jsonc-integration.json) | 새 테스트 프로필에서 20개 검사. JSONC 미저장 문서·문법 오류·undo 검사 추가 | 제어된 AI HTTP 검사와 실제 모델 응답 기록은 별도 |
| [프로젝트 검사 기능의 외부 연동](itsdangerous-project-checks.json) | VS Code task로 pytest 실행: 297개 통과 → 의도적인 오류로 실패(exit 1) → undo·저장 후 297개 통과. 미저장 실행 차단 확인 | 모델 제안이 아닌 검토한 고정 오류를 넣은 검사. UI는 종료 코드만 기록하고 이 개발 검증 스크립트가 JUnit XML에서 개수를 읽음 |
| [프로젝트 검사 보강 후 VS Code 통합](vscode-project-checks-integration.json) | 실제 VS Code 통합 25개. 실제 process/shell 성공·실패, 미저장·중복 실행 차단, 다른 파일 변경, 빠른 취소·재실행, 명령 변경 시 재검토 | 합성 명령으로 검사 연결을 확인. 외부 Python 프로젝트 기록과 별도 |
| [최종 Windows·Ubuntu CI](project-checks-ci.json) | `a3e6f84`에서 각 OS 핵심 152개·VS Code 통합 25개와 패키지 Worker 검사 성공. 실제 설정값 변경과 셸 인용 수정 포함 | 실제 모델·외부 프로젝트 테스트는 CI 밖의 별도 기록. 모든 언어/환경 보장 아님 |
| [보강 전 외부 사례](itsdangerous-before-citation-guard.json) | 실제 Ollama + VS Code + itsdangerous 전후 297개 테스트 성공 | 품질 검토에서 관련 없는 import 인용과 불필요한 조건 발견. 성공한 최적화로 세지 않음 |
| [보강 후 외부 사례](itsdangerous-integration.json) | 변경-인용 연결 검증 후 실제 Ollama + VS Code + Python 문법 검사 + 전후 297개 테스트 + 원본 복구 | 여전히 불필요한 조건이 있어 성능 측정을 추가함 |
| [성능 원자료](optimization-benchmark.json) | 실제 제안 전후, 입력·예외·객체 동일성 10개 확인, 사례별 15회 × 10만 호출, 교대 순서와 워밍업 | 단일 함수·PC 측정. 문자열 입력에서 약 24~38% 느림. 제안 미채택 |

외부 프로젝트는 [Pallets itsdangerous](https://github.com/pallets/itsdangerous), 태그 2.2.0의 커밋 `096c8d42545d3b68ea21a4f890fb2b2d8979c0bd`, `src/itsdangerous/encoding.py`다. 보고서의 원문 인용에는 해당 프로젝트의 [BSD 라이선스](ITSDANGEROUS_LICENSE.txt)가 적용된다. upstream 저장소에 변경을 제출하지 않았고 검증 복사본은 원본으로 복구했다.

환경: Windows, Python 3.12.10, VS Code 1.96.4, Ollama 0.40.5, RAM 약 32GB, NVIDIA MX450 2GB. 모델 digest는 각 보고서에 있다. 소요 시간에는 모델 로드 상태에 따른 차이가 있을 수 있다. pytest 전체 소요 시간은 함수 최적화 수치로 사용하지 않는다.

## 재현

사용자용 전후 측정 기능의 실제 자료도 추가했다. [최초 설정 실패](itsdangerous-command-benchmark-setup-failure.json), [실행기 메모리를 잘못 해석할 수 있었던 첫 측정](itsdangerous-command-benchmark-before-memory-fix.json), [실행기 메모리 제외 후 재측정](itsdangerous-command-benchmark.json). 전후·복구 후 pytest 각 297개를 확인했고 같은 제안의 실행 시간은 두 차례 모두 늘었다(약 14.1%, 21.1%). 최종 기록은 Windows 가상환경 실행기 때문에 메모리 비교가 없다. 이 숫자는 전체 명령·프로세스 시작을 포함하며 앞선 함수 단위 교대 측정과 다르다. [측정 방식](../../BENCHMARKS.md).

같은 고정 외부 저장소와 Python 환경에서 `node scripts/test-local-project.mjs --benchmark-only`로 재현한다. Ollama는 필요 없으며 이미 검토한 특정 변경 한 건만 재현한다. tasks.json은 없을 때만 VS Code 시작 전에 생성하고 검증 종료 후 제거한다. 다른 파일은 덮어쓰지 않는다.

1. 프로젝트의 Node/pnpm 의존성과 Ollama를 설치한다. `OLLAMA_NO_CLOUD=1`, `OLLAMA_HOST=127.0.0.1:11435`로 Ollama를 실행하고 `qwen2.5-coder:3b`를 내려받는다. 기본 포트를 쓴다면 아래 검증 스크립트의 `PUREOBOM_PROJECT_PORT` 환경 변수를 지정한다.
2. `git clone --depth 1 --branch 2.2.0 https://github.com/pallets/itsdangerous.git test-results/projects/itsdangerous` 후 위 커밋인지 확인한다. 스크립트도 커밋과 깨끗한 작업 트리를 확인한다.
3. `python -m venv test-results/python-venv`. Windows에서는 `test-results/python-venv/Scripts/python.exe`, macOS/Linux에서는 `test-results/python-venv/bin/python`으로 `-m pip install pytest==8.3.5 freezegun==1.5.1 flit_core==3.12.0`, 이어서 `-m pip install --no-build-isolation --no-deps -e test-results/projects/itsdangerous`를 실행한다.
4. `pnpm extension:build` 후 `node scripts/test-local-project.mjs`. 별도 VS Code 프로필에서만 작업하며 결과는 `test-results/local-project-report.json`에 저장된다. Linux의 그래픽 세션이 없으면 `xvfb-run -a node scripts/test-local-project.mjs`를 사용한다. 실제 모델 테스트는 일반 CI에서 자동 실행하지 않는다.
5. `python scripts/benchmark-local-proposal.py`는 검토한 특정 변경만 허용한다. 모델이 다른 변경을 반환하면 먼저 코드를 검토해야 하며, 스크립트는 알 수 없는 제안을 실행하지 않는다. 결과는 `test-results/local-optimization-benchmark.json`이다.

단일 파일 추론만 확인하려면 `node scripts/probe-local-assistant.mjs examples/shipping.py python qwen2.5-coder:3b 11435 explain`. 이 명령은 수정 내용을 적용하거나 실행하지 않는다. 모델 출력은 반복 실행마다 달라질 수 있으며, 현재 결과가 미래 실행의 성공을 보장하지 않는다.

프로젝트 검사 기능만 재현하려면 같은 고정 외부 저장소·Python 가상 환경을 준비하고 `pnpm extension:build`, `node scripts/test-local-project.mjs --checks-only`를 실행한다. Ollama는 필요 없다. 검증용 tasks.json은 없을 때만 임시 생성하고 끝나면 지운다. 실제 편집기로 고정 오류를 적용·저장해 실패를 확인하고 undo·저장 후 다시 검사한다. 종료 후 외부 복사본의 `git status --porcelain`이 빈 결과인지 확인했다.
