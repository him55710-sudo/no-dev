# 설명의 의미 검토용 사례

기존 오류를 확인하는 4개 사례와 새로 작성한 6개 사례다. 전부 이 프로젝트의 MIT 합성 예제이며 실제 외부 프로젝트 검증과 구별한다. `cases.json`의 `review`에는 **모델 실행 전에** 정한 검토 기준을 담았다. 조건 경계, 오류·반환값, 빈 문자열, 비동기 실패, CSS 조건과 데이터 소비 코드의 부재를 확인한다.

실제 모델 평가:

```sh
node scripts/evaluate-explanations.mjs qwen2.5-coder:3b 11435 ko all candidate
node scripts/evaluate-explanations.mjs qwen2.5-coder:3b 11435 en new english
```

Ollama는 클라우드를 끄고 로컬 포트에서 실행해야 한다. `all` 대신 `regression`, `new`, 또는 쉼표로 연결한 사례 ID를 선택할 수 있다. 마지막 인수는 결과 폴더의 설명용 이름이다. 실행마다 새 폴더를 만들고 선택한 각 사례를 **한 번만** 요청한다. 성공한 응답을 얻기 위한 숨은 재시도는 없다. 중간 결과도 매번 저장한다. 실행 시작 때 전송 코드를 한 번 번들로 고정하므로 이후 소스 수정이 진행 중인 평가를 바꾸지 않는다. 원자료에는 프로토콜·전송·번들의 해시, 모델 digest, 응답, 실패 이유가 남는다.

`quoteCoverage`는 사전에 정한 코드 문자열이 인용 안에 들어 있는지만 확인한다. 전체 함수를 그대로 인용하면 설명이 틀려도 이 값은 모두 참일 수 있다. **의미 정확도·테스트 통과·사용자 이해도 점수가 아니다.** 요약과 모든 인용 설명을 함께 읽고 `review`에 대조해야 한다. 형식 거절, 누락, 잘못된 설명을 성공과 함께 보존한다. 모델 응답을 코드에 적용하거나 실행하지 않는다.

처음 10개는 안내 수정 전 기준선과 수정 후 비교에 사용한다. 새 사례는 이전 배송 예제의 숫자만 바꾼 것이 아니라 제어 흐름과 데이터가 다르다. 다만 개발자가 이 사례를 보며 일반 지시를 작성했으므로 통계적 의미의 숨겨진 테스트 집합이나 전체 언어 정확도 인증으로 부르지 않는다. 한국어와 영어 요청은 별도 평가한다.

검토 기준의 언어 의미는 [Python 타입 힌트](https://docs.python.org/3/library/typing.html), [Go 반환문](https://go.dev/ref/spec#Return_statements), [CSS 열 정의](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/grid-template-columns), [JavaScript nullish 연산자](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing)와 실제 원문을 기준으로 한다. 예제의 작은 범위를 전체 프레임워크·브라우저·SQL 방언 동작으로 확대하지 않는다.

English: these are public synthetic fixtures for manual semantic review. The runner freezes its implementation, records one real local inference per selected case, and preserves failures. Quote coverage is a source-string check only; it is not an accuracy score. No generated code is applied or executed.
