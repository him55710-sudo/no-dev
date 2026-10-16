# 외부 JavaScript 프로젝트 검사: clsx

2026-10-16. [lukeed/clsx](https://github.com/lukeed/clsx)의 v2.1.1, 커밋 `925494cf31bcd97d3337aacd34e659e80cae7fe2`를 별도의 검증 폴더에 가져왔다. [MIT 라이선스](CLSX_LICENSE.txt)를 보존한다. upstream에는 변경을 보내지 않았다.

**풀어봄의 실제 프로젝트 검사 연결**을 확인했다. Ollama 응답이나 성능 개선을 평가한 사례가 아니다. 기존 소스·기존 32개 테스트와 검토한 고정 오류 한 줄을 사용한다. [실제 VS Code 원자료](clsx-project-checks.json).

| 단계 | 실제 결과 |
| --- | --- |
| 원본 `src/index.js`에서 등록 test task 실행 | 32/32 통과, exit 0, 오래된 결과 아님 |
| `if (x = toVal(tmp))`를 `if (false)`로 편집 후 미저장 검사 시도 | 실행 거절 |
| 저장 후 같은 task 실행 | 7/32 통과, 25개 실패, exit 1 |
| VS Code 실행 취소·저장 후 재검사 | 32/32 통과, 원본 SHA-256 복구 |
| 검증 종료 | 임시 tasks.json 제거, 외부 저장소 `git status --porcelain` 빈 결과 |

작업 실행은 제품의 목록 조회→명령 검토 확인→시작→실제 종료 코드 경로를 사용했다. 이 개발 검증은 별도 결과 파일에서 uvu의 실제 출력과 개수를 읽는다. 제품 UI가 모든 테스트 도구의 개별 테스트를 파싱한다고 주장하지 않는다. 네이티브 화면을 사람이 클릭한 사용성 검사와도 다르다.

## 준비 과정에서의 실패

이 PC에는 `npm` 명령이 없어 `pnpm`을 사용했다. 상위 풀어봄 workspace에 묶이는 것을 피하기 위해 외부 폴더에서 `pnpm install --ignore-workspace --ignore-scripts`로 고정된 개발 의존성을 설치했다. 공식 `node bin` 빌드는 현재 Node에서 성공했다.

그러나 공식 `uvu -r esm test`는 Node 24에서 import 구문을 읽지 못해 **테스트 시작 전에 실패**했다. [원자료](clsx-node24-failure.json). 실패한 실행의 테스트 개수는 알 수 없어 null로 남긴다. 소스·테스트를 바꾸지 않고 검증용 VS Code 1.96.4에 포함된 Electron의 Node 20.18.1로 같은 명령을 실행하니 32개가 통과했다. `ELECTRON_RUN_AS_NODE=1`은 그 자식 프로세스에만 전달한다.

이 오래된 런타임은 고정된 외부 프로젝트의 테스트 호환성을 확인하기 위한 격리된 도구다. 풀어봄의 Node 24 요구사항을 바꾸지 않으며 모든 Node 버전과의 호환성을 주장하지 않는다. 현행 런타임의 실패를 없던 일로 취급하지 않는다.

## 재현

Windows에서 실제 확인했다. 다른 운영체제에서 이 외부 사례를 실행했다고 세지 않는다. 일반 CI에는 외부 저장소 다운로드나 이 opt-in 검사를 추가하지 않았다.

```sh
git clone --depth 1 --branch v2.1.1 https://github.com/lukeed/clsx.git test-results/projects/clsx
pnpm --dir test-results/projects/clsx install --ignore-workspace --ignore-scripts
pnpm extension:build
node scripts/test-clsx-project.mjs
```

스크립트는 고정 커밋·깨끗한 작업 트리·대상 소스 해시를 확인하고 새 VS Code 프로필을 만든다. 기존 tasks.json을 덮어쓰지 않는다. 검사 중에는 검증 복사본을 실제로 편집·저장하며 정상 종료에서 undo·저장 복구를 확인한다. 실패 시에도 소스 복구와 임시 설정 정리를 시도한다. 기록은 `test-results/clsx-project-checks.json`에 남는다. 공개 자료에는 개인 작업 공간 경로를 `<workspace>`로 치환했다.
