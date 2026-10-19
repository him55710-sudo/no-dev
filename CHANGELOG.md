# Changelog

## 0.7.0 — local AI development preview (unreleased)

- Trace compiler-resolved function values passed as call arguments or JSX props, including hooks and form actions. Preserve distinct source evidence, include these relationships in implementation scope and stored observations, and label them as function passing rather than execution. See [external-app evidence and limits](docs/CALLBACK_RELATIONS.md).
- Include a system-design walkthrough with original screenshots, an evidence manifest and a support matrix. Reproduce two missing server permission guards with a controlled fixture: the real checks fail and applying is rejected; restoring the guards passes all nine checks. Keep this deliberate failure separate from the recorded real-model success; see [the walkthrough](docs/SYSTEM_WORKSPACE_DEMO.md).
- Verify a real Codex continuation of a timed-out external Next app job, including fresh checks, full production compilation with local pricing fixtures, and same-job apply/undo recovery. Preserve the validation-driver failure and blocked browser evidence separately. Include external validation tools in the source archive; see [evidence and limits](docs/LIVE_CONTINUATION.md).
- Continue interrupted, failed or cancelled implementation changes in a fresh worktree and model session. Preserve the previous candidate, require the same design and original files, request fresh approvals and rerun checks before review/apply/undo. Verify managed-host death and installed UI cancellation separately; see [continuation evidence and limits](docs/IMPLEMENTATION_CONTINUATION.md).
- Preserve current search, selection and canvas locations when navigation saves overlap. Merge changed fields, order acknowledgements, retain failed edits for retry and cancel pending layout publication on scope exit. Verify delayed saves and installed-host restoration; retain the initial browser failure separately. See [navigation verification](docs/WORKSPACE_NAVIGATION.md).
- Contain Windows implementation providers and verification commands in per-invocation OS jobs, including detached descendants. Preserve stdio and exit codes, stop leftover writers after launcher or managed-host exit, and retain interrupted jobs for explicit review. See [process lifetime and verification scope](docs/WINDOWS_PROCESS_SCOPE.md).
- Add optional Ollama explanations and multiple exact-range edits in desktop VS Code. Require cloud-disabled loopback service and installed local text models; no paid API or API key fallback.
- Ground citations and edits in unique original source ranges, require changed-source evidence, bound requests, and cancel stale work. Review the native diff and unchecked behavior before explicit apply; use normal editor undo.
- Check proposed JS/TS/JSX/TSX and JSON syntax; parse Python with an isolated local interpreter without executing user code. Other language checks remain unavailable.
- Publish the implementation plan, agent work log, actual Python/model/editor evidence and a failed optimization: itsdangerous tests passed before and after, but the proposed function was slower and was not adopted.
- Add explicitly reviewed project test/build commands through VS Code tasks, with saved-file checks, real exit codes, cancellation and stale-result notices. Validate itsdangerous tests passing, a known regression failing and undo restoring 297 passing tests. See [project checks](docs/PROJECT_CHECKS.md).
- Preserve TSX/JSX source extensions in native rule diffs instead of labeling every preview as TypeScript.
- This is not verified support for every language or automatic optimization. See [local AI setup and limitations](docs/LOCAL_AI.md).
- Add JSONC structure and proposal syntax checks with comments/trailing commas, preserving strict JSON rules. Validate the packaged worker outside project dependencies and isolate each VS Code test profile.
- Publish 28 actual local-model responses across 14 language identifiers with semantic errors and rejected edits included. Choose model context size from bounded request size; do not claim universal quality or measured speedups.

## 0.6.0 — understand the editor's reports

- Connect current-file VS Code diagnostics to a compact summary and the Review view, with provider, severity, original message and exact source navigation.
- Explain four common TypeScript errors in Korean and English while preserving original messages and leaving unknown reports untranslated.
- Distinguish edited reports, reject stale report/file navigation, show empty reports without a pass claim and cap long lists/messages with visible omissions.
- Add a typed shipping example and real TypeScript integration coverage: apply an invalid literal value, inspect error 2322, navigate and undo.
- These are existing editor reports, not a new full-project type checker or pre-apply semantic verification. No scripts, provider commands or automatic fixes are run.

## 0.5.2 — explain cleanup in the correct order

- Keep `finally` separate from the try body and display it after catch in both the story and Markdown export.
- Explain pending returns through enclosing finalizers, keep nested function boundaries intact, and stop describing catch behavior when there is no catch.
- Bound else and finalizer rendering at the same depth as ordinary child steps.
- Add a realistic async save example, semantic/renderer regressions and a VS Code worker/source-link integration check. The restricted simulator does not gain async or try/catch execution support.

## 0.5.1 — from the demo to your own code

- Add shared installation and feedback help to the browser and VS Code panel, plus a next-step card after a browser demo edit.
- Prepare and copy a user-reviewed experience summary locally. Do not attach source/paths, place feedback in URLs, send telemetry or create issues automatically. Link to a bilingual GitHub experience form.
- Keep successful, stuck and unsupported experiences distinct. Add an empty observation sheet and first-use study protocol; no user results are claimed.
- Scope sidebar navigation styles and keep mobile install/export actions reachable.

## 0.5.0 — read the interface, change its words

- Read JSX/TSX elements, component props, text, conditional branches and simple map callbacks as an expandable, source-linked structure in VS Code and the browser.
- Edit static JSX text and quoted attributes with compiler-correct whitespace/entity decoding and inert string-expression replacements. Re-editing and native undo work through the existing checked patch path.
- Distinguish render-time calls from passed event functions. Display spread/complex expressions and truncation limits explicitly. React components are excluded from the calculation simulator.
- Add a React membership-card example, VS Code command, direct browser demo link and multiline text inputs.
- Add 14 core checks and a real TSX editor integration flow. Browser demo history now accurately explains that changes are not saved.

## 0.4.0 — your project's words

- Add Korean/English names for source declarations in the browser and VS Code, without renaming source identifiers.
- Bind terms to lexical symbols so shadowed names keep their own meaning; use custom names in stories, function inputs, rule tables and sentence edits.
- Persist terms per browser workspace or VS Code document URI; isolate demo mode and untitled documents.
- Invalidate pending changes when terminology changes and retain cache entries for unaffected files.
- Cover name binding, sentence edits, reset, input limits and file-switch behavior. Restrict unit-test discovery to the maintained source tests.

## 0.3.0 — open-source preview

- Compare up to 12 input scenarios against the actual pending change in the browser and VS Code.
- Editable input tables and suggested numeric boundary cases; unsupported results remain unavailable.
- Export a bilingual Markdown comparison report without automatic uploads.
- Isolated browser demo mode, a direct first-change walkthrough, and relative assets for static hosting.
- MIT repository license, contributor and security guidance, issue templates and CI definitions.
- Versioned VSIX, source and offline-demo packaging with SHA-256 checksums.

This is a preview, not a production assurance tool. User demand, comprehension gains and retention have not yet been measured.

## 0.2.0 — VS Code prototype

Native editor explanations, source navigation, diff, buffer edits and undo; document version checks and workspace import graph.

## 0.1.0 — browser prototype

Korean/English stories, rules, dependency map, local file import, constrained patches and a restricted AST interpreter.
