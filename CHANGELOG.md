# Changelog

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
