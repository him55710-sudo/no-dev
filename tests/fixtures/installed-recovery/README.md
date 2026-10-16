# Installed recovery fixture

This is a deterministic installation/recovery test, not a real AI implementation demo. The initial policy intentionally permits viewer edits; `test.js` expresses the desired behavior and fails before the controlled change.

`scripts/test-installed-recovery.mjs` copies these files to an OS temporary directory outside the repository. It installs the actual VSIX in a separate VS Code profile and sets that **test profile's** `pureobom.codexPath` to Node. The extension's normal `app-server --listen stdio://` invocation then runs the explicitly labeled `app-server` fixture. That peer waits for a real approval response and changes only three known files. There are no network requests or model credentials.

The driver uses the same validated request handler as the Webview. Five separate VS Code launches exercise persisted review, native diff, design/dirty-buffer conflicts, apply, undo, and recovery after killing the test extension-host process during an actual file transaction. The installed product's location, Production mode, and bundle hashes are checked on every launch.

Run after building and packaging:

```sh
pnpm extension:build
pnpm extension:package
pnpm extension:recovery-test
```

On Linux, run the last command under `xvfb-run -a`. The report is `test-results/installed-recovery.json`. Temporary test repositories and profiles are preserved for diagnosis; the test does not modify the user's normal VS Code profile. A missed interruption checkpoint fails the test and is not automatically retried. This does not prove mouse/keyboard navigation or external-model quality.
