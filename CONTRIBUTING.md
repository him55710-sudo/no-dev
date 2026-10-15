# Contributing to Pureobom

Help someone understand a program and make a change they can check. A small, accurate explanation is more useful than a confident guess.

## Run locally

Use Node.js 24 and pnpm 11.25.0. Run `pnpm install --frozen-lockfile`, then `pnpm dev`. No accounts, API keys, telemetry service or application backend are needed. `pnpm extension:build` builds the VS Code extension; `pnpm extension:test` launches an isolated VS Code test host (first run downloads VS Code).

Before a PR: run `pnpm test`, `pnpm build`, and `pnpm extension:build`. Run `pnpm extension:test` for changes to document handling, patches, host messages or the extension UI. On Linux use `xvfb-run -a pnpm extension:test`. Check the UI in both languages and at a narrow panel width.

## Useful first contributions

- Add a small JS/TS fixture where the explanation is wrong. Include expected wording and the source line.
- Improve a Korean or English label without changing its meaning. Keep the original code identifier visible.
- Add a realistic scenario to `examples/` with expected results and unsupported cases.
- Fix keyboard navigation or narrow-panel layout, with before/after screenshots.
- Add parser support together with a meaningful counterexample and an explicit unsupported fallback.

Use a focused PR with the problem, resulting behavior, and validation. Do not include real customer code, credentials or screenshots of private workspaces. No contributor agreement or account outside GitHub is required.

## Design constraints

`src/core` owns analysis and editing. Both UIs consume serializable data. Keep TypeScript's parser out of UI bundles; it runs in a Worker. `scenarioModel.ts` and `report.ts` must remain parser-free. Preserve source ranges and check the entire original before applying a patch. Never execute imported code using `eval`, `Function`, shell commands, or network calls. Unsupported computations must remain unavailable, never a fabricated success.

Use the same change and comparison behavior in the browser and VS Code. The host validates document versions; webview input is not trusted. Keep explanations anchored to source. New language support needs a parser and a source-location contract, not a line-by-line replacement dictionary.

## Larger proposals

Describe the user task first, a minimal example, what the feature knows, what it cannot know, and how a user can verify it. Discuss AI adapters, new language parsers and multi-file edits before implementing them. There is no current promise of general code generation or production correctness.

Contributions are licensed under the project's MIT license. Be respectful, address ideas instead of people, and do not post harassment or private information. Maintainers may remove abusive content.
