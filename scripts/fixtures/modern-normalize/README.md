# Pinned external browser-test dependencies

This lockfile belongs to **modern-normalize v3.0.1**, source commit
`3faa07fc91b8ffbe6243bc4f91e880a00185d0a2`. It is an opt-in verification fixture,
not a Pureobom runtime dependency. The upstream tag has no pnpm lock, so the
first install resolved its dependency ranges and this file preserves that result.

Clone the upstream source into `test-results/projects/modern-normalize`, copy
this lockfile there, and install from that explicit directory:

```powershell
git clone --depth 1 --branch v3.0.1 https://github.com/sindresorhus/modern-normalize.git test-results/projects/modern-normalize
Copy-Item scripts/fixtures/modern-normalize/pnpm-lock.yaml test-results/projects/modern-normalize/pnpm-lock.yaml
pnpm --dir test-results/projects/modern-normalize --ignore-workspace install --prod=false --ignore-scripts --frozen-lockfile
pnpm extension:build
node scripts/test-web-source-project.mjs
```

Requires Node 24, pnpm 11.25.0 and a locally installed Chrome. VS Code 1.96.4
is downloaded by the harness if missing. `--ignore-workspace` is required to
avoid selecting the parent Pureobom workspace. Installation needs network
access; the browser fixture is served locally. Keep port 8080 free.

On Linux, use `cp` for the copy and `xvfb-run -a node scripts/test-web-source-project.mjs`
if no graphical display is available. The published external-project observation
is Windows only; this is not a claim that the browser suite passed on Linux.

The harness checks the source commit, unchanged tracked files and dependency
lock, creates a fresh VS Code profile and a task only when none exists, and
restores the CSS and removes its task afterward. Lock comparison normalizes
CRLF/LF for Git checkout portability; evidence records the actual byte hash.
The generated lock remains untracked in the external checkout.

The task runs **all 54 original Chrome tests**, including upstream failures and
eight TODO tests without `expect` calls. TestCafe's pass count is not an assertion
coverage score. The VS Code harness succeeds only if the deliberate box-sizing
regression adds the expected failing test and undo restores the baseline failure
set and counts. It does not require or manufacture a green upstream baseline.

See [the full evidence and limitations](../../../docs/evidence/local-ai/web-source-project.md).
