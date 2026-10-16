# Python 원문 읽기·수정 · Python source reading

0.7 개발 소스의 **로컬 데스크톱 VS Code** 기능이다. 공개 안정판 0.6.0과 웹 데모에는 없다. 설치된 Python 표준 라이브러리의 AST로 현재 파일을 읽으며 Ollama·모델·API 키가 필요 없다. 사용자 파일을 가져오거나 실행하지 않는다.

## 사용

1. Python 3를 설치하고 `.py` 파일을 VS Code에서 연다. 이번 검증은 CPython 3.12.10과 VS Code 1.96.4에서 했다.
2. 풀어봄 설명을 열면 분기·반복·예외 처리와 원문 위치를 한국어/영어로 볼 수 있다. Python 버전과 설명 한계가 함께 표시된다. 미저장 내용도 읽는다.
3. 규칙 표에서 문자열·숫자·참거짓 한 값을 선택한다. 간단한 요청도 가능하다: `change limit to 9007199254740995`, `enabled를 True로 변경`. 같은 이름이 여러 번 등장하면 표에서 정확한 줄을 선택한다.
4. Python diff를 검토한 뒤 적용한다. 자동 저장하지 않으며 일반 편집기 undo가 가능하다. 파일이 바뀌면 이전 변경안은 사용할 수 없다.
5. 의미·타입·통합 결과는 별도 [프로젝트 검사](PROJECT_CHECKS.md)로 확인한다. 문법을 통과한 값 변경도 프로그램을 망가뜨릴 수 있다.

기본 실행기는 Windows `python`, 그 외 `python3`다. 다른 실행기를 쓰려면 사용자 설정 `pureobom.analysisPython`에 실행 파일의 절대 경로를 지정하고 설명을 새로고침한다. 인자나 셸 명령을 넣는 설정은 아니다. 작업 공간 설정에서 실행 경로를 바꾸지 못하도록 application 범위로 제공한다. 인터프리터 없음·시간 초과·지원하지 않는 문법은 미분석 또는 문법 오류로 표시한다.

## 읽는 범위

- 함수·클래스·중첩 함수, 인자와 자료형 표기, 정의와 본문의 구별. 자료형 표기는 검증된 타입이 아니다.
- if/else, for/async for/while 및 break 없이 정상 종료할 때의 loop else.
- try, 순서가 있는 except, except*, try else, 별도 finally. 바깥 finally가 예정된 반환·제어 흐름을 바꿀 수 있음을 표시한다.
- with/async with, return, raise, 생성기 yield, 대입·주석형 대입, 표현식·가져오기·pass·assert.
- 지원하지 않는 구문은 이름과 원문을 보여 준다. 호출 구현·외부 모듈 초기화·데이터 사용처·사업적 의미나 단위를 추측하지 않는다. 함수가 실행됐다는 뜻도 아니다.

이름과 식은 원문 표기를 유지한다. 식의 연산을 한국어로 전부 풀어 쓰는 기능, Python 용어 사전, 타입 검사·import 연결 지도·실행 시뮬레이터는 제공하지 않는다. 브라우저·원격 VS Code 지원은 없다. 다른 Python 버전의 문법 지원은 실제 선택한 인터프리터에 따른다.

## 수정 범위와 제한

단일 이름에 대입한 문자열·숫자·참거짓 리터럴만 직접 수정한다. 함수 내부 값도 포함한다. 숫자는 JavaScript Number로 바꾸지 않고 원문을 보존하므로 큰 정수, 밑줄, 진수, 지수 표기가 손실되지 않는다. 문자열은 Python 문자열 리터럴로 다시 인코딩해 코드가 되지 않도록 한다. implicit string concatenation은 중간 주석을 지울 수 있어 직접 수정 대상에서 제외한다. bytes·None·컨테이너·호출식·비교 연산은 이 경로의 수정 대상이 아니다.

입력 파일 128KiB, 분석 5초·출력 2MiB 제한. 표시 한도는 400개 구문·12단계·100개 함수·300개 수정 값이고 생략을 알린다. 식 미리보기 240자, 수정 대상 원문 및 새 값 4096자 제한이 있다. 일부 구문의 구조 설명일 뿐 전체 Python 의미 분석이 아니다.

`extension/runtime/python_source.py`를 `-I -S`로 실행한다. `ast.parse` 후 AST를 컴파일해 함수 밖 return 같은 범위 오류도 확인하되 실행하지 않는다. 자식 프로세스의 중단·기한·응답 크기를 호스트가 제어한다. UTF-8 기반 AST 열 위치를 VS Code의 UTF-16 오프셋으로 변환해 Unicode·emoji·LF/CRLF/CR의 정확한 범위를 유지한다. 파싱 성공은 프로그램 안전성이나 동작의 보증이 아니다.

설계 참고: [Python AST 위치와 컴파일 주의점](https://docs.python.org/3.12/library/ast.html), [분기·반복·예외 처리 문법](https://docs.python.org/3.12/reference/compound_stmts.html), [격리 실행 옵션](https://docs.python.org/3.12/using/cmdline.html#cmdoption-I).

## 확인한 근거

- `tests/python-source.test.ts`: 실제 격리 Python 프로세스로 배송 경계·예외, loop else/try else/finally, 중첩 함수·생성기, Unicode 위치, 정확한 큰 정수·문자열 수정, 문법/범위 오류, 사용자 코드 비실행, 한도·실패·취소를 검사한다.
- `extension/test/pythonSource.ts`: 실제 VS Code에서 미저장 Python 설명·원문 선택·요청·diff·명시적 적용·재분석·undo·오래된 변경안 거절, 없는 실행기 안내와 복구를 확인한다.
- [외부 itsdangerous 검사](evidence/local-ai/python-source-project.md): 원본 **297개 통과 → 의도한 잘못된 값으로 38개 실패 → undo·저장 후 297개 통과**. 모델 없는 값 수정과 실제 프로젝트 검사 연결의 근거다. 성능 개선이나 임의 수정의 정확성을 뜻하지 않는다.
- `scripts/check-release.mjs`는 VSIX에서 꺼낸 Python 분석기를 저장소 밖에서 실행해 읽기와 정확한 값 수정을 확인한다. 설치본 검사는 production 모드와 런타임 파일 6개의 해시를 대조한다.
- [실제 설치 화면](evidence/local-ai/python-source-native.md): 한국어/영어 구조 설명, 원문 숫자 수정·Python diff·적용·원문 이동·undo를 클릭/키보드로 확인했다. 발견한 기존 JS/TS 안내와 Python에 맞지 않는 요청 예시를 고쳤다. 화면 기록의 VSIX와 후속 문구 수정 후 설치본 해시를 구분한다.

## English scope

The 0.7 development extension reads the current Python document through an isolated installed interpreter, without importing or executing user code or calling a model/API. It presents supported statement structure and exact source locations in Korean/English. Direct edits cover one assigned string, number or boolean, with native diff, explicit apply, no automatic save, stale-patch rejection and normal undo. Exact numeric spelling and surrounding source are retained.

This is partial static syntax reading, not type checking, dependency resolution, execution simulation or inferred behavior of called functions. It requires local desktop VS Code and Python; the stable 0.6 release and browser demo do not include it. Grammar depends on the selected interpreter. Bounds and unavailable states are visible. Upstream tests caught a deliberate wrong boolean in itsdangerous: 297 pass → 38 failures → 297 pass after undo. That verifies the workflow, not universal correctness or optimization.
