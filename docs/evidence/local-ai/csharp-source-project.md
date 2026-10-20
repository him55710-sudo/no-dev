# C# 외부 프로젝트 편집·검사·복구

2026-10-20 KST. [Ardalis GuardClauses](https://github.com/ardalis/GuardClauses/tree/f96b823e4228252b2927cce3effa550c16b558a5)의 고정 커밋 `f96b823e4228252b2927cce3effa550c16b558a5`를 별도 checkout으로 평가했다. [MIT 라이선스](GUARDCLAUSES_LICENSE.txt)가 보고서의 upstream 코드 인용에 적용된다. upstream에는 변경을 제출하지 않았다.

**검증용 경계값 변경을 넣어 기존 테스트가 감지하는지 확인한 연동 검사**다. 실제 발견한 upstream 결함, 사용자 프로젝트 유지보수 요청의 성공, AI 품질 또는 성능 개선으로 집계하지 않는다. 사용자가 지정한 실제 프로젝트의 서식 정리 검증은 [별도 사례](function-format.md)다.

## 실제 실행

Windows, VS Code 1.96.4 개발 호스트, .NET SDK 10.0.402/runtime 10.0.13에서 원래 `net8.0` 테스트 프로젝트를 실행했다. `DOTNET_ROLL_FORWARD=Major`를 사용했으므로 .NET 8 런타임 자체나 모든 upstream 대상 프레임워크를 검증한 것은 아니다.

`src/GuardClauses/GuardAgainstNegativeExtensions.cs`의 제네릭 `Negative<T>`에서 `input.CompareTo(default(T)) < 0`의 숫자 `0`을 `1`로 바꿨다. 실제 Roslyn 분석의 원문 줄·값 선택, C# native diff, 명시적 적용, 미저장 검사 실행 차단, 저장 후 기존 테스트, native undo와 재검사를 수행했다.

| 단계 | 통과 | 실패 | 건너뜀 | 종료 코드 |
| --- | ---: | ---: | ---: | ---: |
| 원본 | 959 | 0 | 0 | 0 |
| 검증용 값 변경·저장 후 | 952 | 7 | 0 | 1 |
| native undo·저장 후 | 959 | 0 | 0 | 0 |

실패 7개는 zero/non-negative int·long·float·double·decimal·TimeSpan 입력을 확인하는 원래 테스트였다. [실행 명령·실패 목록·소스 해시](csharp-source-project.json)에 전후 원자료를 기록했다. 최초 적용은 편집기만 바꾸고 저장하지 않았으며, 미저장 상태에서 테스트 실행은 거절됐다. 최종 원본 바이트 해시가 일치하고 checkout은 clean이다.

## 첫 실패와 수정

[첫 실행](csharp-source-project-first-failure.json)은 대상 값 선택에서 실패했다. 디스크 파일에는 UTF-8 BOM이 있어 14,045자였고, VS Code의 텍스트 모델은 BOM을 제외한 14,044자였다. 검증 스크립트가 디스크 문자열로 계산한 위치를 편집기 규칙과 비교해 한 글자 어긋났다. 프로젝트 테스트나 수정 전에 중단됐으며 이를 제품 파서의 오류로 분류하지 않는다.

`extension/test/csharpSourceProject.ts`를 고쳐 위치·후보·undo 비교는 `doc.getText()`로 하고, 디스크 저장·복구는 원래 Buffer와 해시로 확인한다. 수정 후 위의 전 흐름이 완료됐고, BOM도 보존됐다. 확장 TypeScript 검사를 별도로 통과했다. 일반 핵심/설치 suite를 이 스크립트 변경 때문에 다시 실행한 것으로 표기하지 않는다.

## 재현 및 한계

[fixture 준비와 실행 방법](../../../scripts/fixtures/guardclauses/README.md)을 따른다. 원래 테스트 프로젝트의 명령을 VS Code task로 연결하며 모델과 유료 API는 사용하지 않는다. 최초 SDK·NuGet 의존성 준비에는 다운로드가 필요하다. 실행 중 사용자의 다른 작업 폴더를 수정하지 않는다.

보고서의 `explained: 21/21`은 지원되는 구문 단계를 세는 내부 수치이며 설명 정확도나 비개발자 이해도 점수가 아니다. 함수 설명은 실제 조건식·예외·반환 원문에 연결되어 있지만 도메인 의미·타입·프로젝트 define을 완전히 설명하지 않는다. 실제 사용자 사용성, 모든 .NET/OS 조합, 최적화는 미검증이다. 검토자는 구현한 Codex이며 독립 제3자가 아니다.
