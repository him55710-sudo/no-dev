# My project terms · 내 프로젝트 용어

Give an unfamiliar code name a meaning you recognize, without renaming the code. Available in the browser and VS Code from 0.4.

1. Open **My project terms / 내 프로젝트 용어** above the story.
2. Select the original identifier. The menu shows its function scope and source line so identical names can be distinguished.
3. Enter a name in the selected language and choose **Use in explanations / 설명에 적용**.
4. Read the updated story, inputs and rules. For a literal rule, use that term in a sentence edit, then review the code diff as usual.
5. **Reset name / 기본 이름으로** clears only the current language's custom term.

For example, name `freeShippingThreshold` **우리 가게 무료 배송선**, then request **우리 가게 무료 배송선을 75000으로 변경**. The pending change still modifies the numeric literal; `freeShippingThreshold` remains the original code identifier.

## What is stored

| Surface | Storage and lifetime |
| --- | --- |
| Browser workspace | Files, project name and terms in IndexedDB on the current browser origin. Reloads preserve terms. Opening a new project or resetting to the example clears its terms. |
| Browser demo URL | `?demo=shipping` neither reads nor writes saved workspace data; custom terms last only for that page session. |
| VS Code | Local workspace state, keyed by document URI and declaration. Untitled documents keep terms for this session only. Renaming or moving a file does not transfer terms. |

Korean and English terms are independent. Up to 500 declarations may have terms, with 80 characters per language. Terms are not a code change and do not enter native code undo history. Use **Reset name** to clear them. Project ZIP export contains source files, not your local glossary. Explanation reports can contain your custom names; review them before sharing.

## Supported declarations

Top-level named functions and simple variables; parameters and direct local variables of top-level functions or arrow functions. Same-spelled variables in other functions or nested blocks do not inherit the term. Strings, comments, object keys and imported symbols are not renamed. Properties, imports, destructuring and nested declarations are not editable glossary targets in this preview.

Terms follow the declaration's file, named scope, kind and identifier, so inserting lines or changing its literal value preserves the term. Renaming a declaration drops the association. If a new declaration reuses the same identifier, kind and scope, the term also applies to it; check **See declaration** when restructuring code. Duplicate declarations are omitted. The dictionary does not follow symbols across files or refactors.

The TypeScript checker resolves lexical references inside the current source file. No project libraries, dependencies or filesystem are loaded for this binding step. This is not a full project type check. The custom term is supplied by you and does not prove the author's intent or the runtime behavior.

---

설명 위의 **내 프로젝트 용어**에서 이름과 선언 위치를 선택하고 한국어 뜻을 붙일 수 있습니다. 영어로 전환하면 별도의 영어 뜻을 지정합니다. 같은 이름이 다른 함수에서 쓰여도 뜻이 섞이지 않으며 원본 식별자·문자열·주석은 유지됩니다.

브라우저 일반 작업 공간은 새로고침 후에도 저장되고, 새 프로젝트 가져오기·예제 초기화 때 용어도 초기화됩니다. 체험 URL은 저장하지 않습니다. VS Code에서는 현재 작업 공간의 문서별로 저장하며 미저장 새 문서는 세션 한정입니다. 파일 이동·선언 이름 변경을 따라가는 리팩터링 기능은 아닙니다. 같은 범위에 같은 이름의 선언을 다시 만들면 기존 용어가 연결될 수 있으므로 원문을 확인하세요.

용어의 뜻은 사용자가 지정한 해석입니다. 작성 의도나 동작을 검증한 결과로 취급하지 않습니다. 코드 실행 취소와 용어 초기화는 별개이며, **기본 이름으로**를 눌러 현재 언어의 용어를 지울 수 있습니다.
