# Installed recovery fixture

This is a deterministic installation/recovery test, not a real AI implementation demo. The initial policy intentionally permits viewer edits; `test.js` expresses the desired behavior and fails before the controlled change.

`scripts/test-installed-recovery.mjs` copies these files to an OS temporary directory outside the repository. It installs the actual VSIX in a separate VS Code profile and sets that **test profile's** `pureobom.codexPath` to Node. The extension's normal `app-server --listen stdio://` invocation then runs the explicitly labeled `app-server` fixture. That peer waits for a real approval response and changes only three known files. There are no network requests or model credentials.

The driver uses the same validated request handler as the Webview. Six separate VS Code launches exercise a live approval across window exit, persisted review, native diff, design/dirty-buffer conflicts, apply, and undo. Killing the test extension host during a file transaction now leaves the managed worker running: the next window verifies completion and explicitly undoes it. This does not claim that the managed worker itself crashed. Separate `agent-host` and `agent-recovery` tests cover worker death and partial transaction recovery. The installed product's location, Production mode, and bundle hashes (including `agent-host.cjs`) are checked on every launch.

Connection preflight calls initialize/account in the original isolated fixture without starting a model turn. Overlapping connection requests must launch only one peer. Execution choices persist across the six launches and are reused through their exact stored revision. The fixture refuses implementation turns outside its generated worktree.

Run after building and packaging:

```sh
pnpm extension:build
pnpm extension:package
pnpm extension:recovery-test
```

On Linux, run the last command under `xvfb-run -a`. The report is `test-results/installed-recovery.json`. Temporary test repositories and profiles are preserved for diagnosis; the test does not modify the user's normal VS Code profile. A missed interruption checkpoint fails the test and is not automatically retried. This does not prove mouse/keyboard navigation or external-model quality.
