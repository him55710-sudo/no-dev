# 시스템 설계 공개용 사이트 패키지

2026-10-20. 현재 개발 브랜치의 정적 웹 빌드는 단일 파일 편집기로 시작한다. 공개용 사이트에서는 **실제 시스템 설계 변경의 성공·실패 기록**을 첫 화면으로 배치하고, 기존 체험은 `reader.html`로 유지한다. 기록을 실제 제품의 대화형 실행으로 오인하게 만들지 않는다.

## 준비된 결과물

```sh
pnpm demo:record
pnpm build
pnpm pages:package
pnpm pages:preview
```

- `release/site/`: 업로드할 정적 사이트. 첫 화면과 `workspace-demo.html`은 실제 실행 기록, `reader.html`은 기존 코드 읽기·규칙 비교 체험이다.
- `release/pureobom-0.7.0-site.zip`: 같은 사이트의 압축 파일.
- `release/site-evidence.json`: 각 파일과 ZIP의 SHA-256, 진입 주소, 검증 범위.

기존 개발 빌드 `dist/`와 기존 데모 ZIP은 그대로 유지한다. 사이트 패키저는 프로젝트 안의 `release/site`에 생성 표시가 있는 경우에만 그 디렉터리를 다시 만든다. 심볼릭 링크와 다른 출력 경로를 거절하고, 네 HTML 진입점의 로컬 링크가 `/no-dev/` 하위 경로 안의 실제 파일로 연결되는지 확인한다. 라이선스·제3자 고지를 함께 포함한다.

GitHub의 수동 `Publish browser demo` 워크플로는 테스트와 근거 대조를 거친 빌드·사이트 패키징 후 이 디렉터리를 배포하도록 변경했다. 일반 CI는 패키징까지 확인하고 Ubuntu 실행의 `system-design-site` 아티팩트에 ZIP과 해시 기록을 제공한다. 워크플로 수정이나 push만으로 배포를 시작하지 않는다.

## 실제 브라우저 확인

[패키지 원자료](evidence/pages-package.json)의 최종 ZIP은 1,880,546바이트이며 SHA-256은 `3040ceea57c4ce54c8e0d3b338a265475ef3843503feb2ae8d305620fce39a53`이다. 22개 파일과 링크 검사가 통과했다. 브라우저에서는 다음을 확인했다.

- 첫 화면→기존 체험→새 **시스템 설계 실행 기록** 링크의 왕복 이동.
- 원점 루트와 `/no-dev/` 하위 경로 모두에서 코드 분석 Worker 및 7개 입력 비교. 50,000→70,000 변경안은 3개 달라짐, 0개 확인 불가로 표시됨. 하위 경로 시험의 [접근성 상태](evidence/pages-reader-subpath.txt)·[화면](evidence/pages-reader-subpath.jpg)을 보존했다. 이 계산은 기존 제한적 모의 실행이며 새 시스템 구현 시험이 아니다.
- 390×844 뷰포트에서 첫 화면과 실패 섹션 이동. 브랜드가 두 줄로 나뉘는 [초기 문제](evidence/pages-entry-mobile-before.jpg)를 확인한 뒤 수정했다. 수정 후 [첫 화면](evidence/pages-entry-mobile.jpg)·[실패 섹션](evidence/pages-failure-mobile.jpg)을 확인했고 문서 너비와 스크롤 너비는 모두 375px였다. 스크롤바를 제외한 실제 내용 너비이며, 모든 모바일 브라우저 검증을 의미하지 않는다.
- 데스크톱 뷰포트로 복원했고, 하위 경로 체험의 브라우저 오류·경고 로그는 없었다.

![공개용 첫 화면](evidence/pages-entry-desktop.jpg)

하위 경로 검증 명령:

```sh
pnpm exec vite preview --outDir release/site --base /no-dev/ --host 127.0.0.1 --port 4177 --strictPort
```

## 아직 공개하지 않은 것

확인 시점에 GitHub API의 `him55710-sudo/no-dev`는 `has_pages: false`였다. 이번 기록은 로컬 패키지·브라우저 확인이며 공개 URL에서의 배포 확인이 아니다. 새 GitHub Pages 사이트를 활성화하는 것은 기존 코드 push와 별도의 공개 설정 변경이므로 공개 여부를 확인한 뒤 진행한다. 공개했다면 실제 배포 URL에서 다시 확인하고 그 실행 ID·커밋을 기록해야 한다.

VS Code 네이티브 Webview 조작, 새 실제 모델 구현, 사람의 사용성 시험을 이 페이지 검증으로 대체하지 않는다. [전체 상태](SYSTEM_WORKSPACE_STATUS.md)와 [원래 실행 범위](SYSTEM_WORKSPACE_DEMO.md)를 함께 유지한다.
