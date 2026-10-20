# Python AST·수정·외부 프로젝트 검사

2026-10-16, Windows · CPython 3.12.10 · VS Code 1.96.4. [원자료](python-source-project.json). 실제 모델 응답이나 자동 최적화 사례가 아니다. 사용한 공개 원문에는 [itsdangerous BSD 라이선스](ITSDANGEROUS_LICENSE.txt)가 적용된다.

대상은 [Pallets itsdangerous](https://github.com/pallets/itsdangerous/tree/096c8d42545d3b68ea21a4f890fb2b2d8979c0bd), 2.2.0 커밋 `096c8d42545d3b68ea21a4f890fb2b2d8979c0bd`의 `src/itsdangerous/url_safe.py`다. 해당 파일을 실제 편집기에서 열고 설치된 Python AST로 클래스 메서드·조건·예외·return을 읽었다. 한국어/영어 설명과 선택한 원문 범위는 JSON 보고서에 보존했다. 표시 한도에 도달하지 않았다.

`load_payload`의 `decompress = False`에서 **False 한 값만 True로 변경**하는 검토된 오류를 준비했다. 압축하지 않은 데이터에도 압축 해제를 시도하게 만드는 변경으로, 좋은 수정안으로 제안한 것이 아니다. source 선택 → Python diff → 명시적 적용 → 재분석 → 저장 → 프로젝트 검사를 실행하고 정상적인 undo·저장으로 복구했다.

| 상태 | 테스트 수 | 실패 | 오류 | task 종료 |
| --- | ---: | ---: | ---: | ---: |
| 원본 | 297 | 0 | 0 | 0 |
| False → True | 297 | 38 | 0 | 1 |
| undo·저장 후 | 297 | 0 | 0 | 0 |

미리보기는 원본을 바꾸지 않았고 적용도 자동 저장하지 않았다. 미저장 상태에서 프로젝트 검사 실행은 거절됐다. 세 task는 `python -m pytest -q --tb=no --junitxml=<outside-workspace>`를 실행했다. 제품은 실제 종료 코드·파일 해시·변경 여부를 표시하고 검증 harness가 새 JUnit 보고서에서 개수를 읽었다. 실행마다 이전 XML을 제거해 오래된 결과를 성공으로 오인하지 않게 했다.

원본/복구 파일 SHA-256은 `4d7db7718099818b3ec71b700d8397e3b5ce12ee9dcb345885b77ade693fb1be`, 변경본은 `71799523cfc821987a37c016675a6239e34e55350a044e2a24b52eae15a11515`다. 종료 후 외부 복사본의 `git status --porcelain`은 비어 있었다. upstream에는 변경을 보내지 않았다. 시간은 task 실행 기록일 뿐 최적화 수치로 비교하지 않는다.

재현은 [기존 환경 준비](README.md#재현)의 고정 itsdangerous checkout과 Python 가상환경을 만든 뒤 `pnpm extension:build`, `node scripts/test-python-source-project.mjs`로 한다. Linux의 그래픽 세션이 없다면 `xvfb-run -a`를 앞에 붙인다. 실제 기록은 Windows이며 이 외부 사례를 Linux에서도 실행했다고 주장하지 않는다. 모델·Ollama는 필요 없다.

스크립트는 정확한 커밋·깨끗한 작업 트리를 확인하며 임시 tasks.json은 없을 때만 VS Code 시작 전에 생성하고 종료 시 제거한다. 별도 VS Code 프로필을 사용하고 보고서를 `test-results/python-source-project.json`에 저장한다. 실패해도 검증 대상 파일을 원본으로 복구한다. 모든 Python 구문·프로젝트·실행기 조합의 지원을 입증하는 사례는 아니다.
