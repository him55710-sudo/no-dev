# React Flow observer backport

`@xyflow/react@12.12.0` is pinned in the lockfile. Its ESM entry points used by
Vite/esbuild are patched through pnpm; the CommonJS/UMD entry is not used by this
application and is not changed. The patch is included in source releases and the
bundled MIT license is retained in the VSIX notice.

The node/pane observer batching is adapted from fpaupier's
[xyflow/xyflow #5999](https://github.com/xyflow/xyflow/pull/5999), commit `17ebf82`.
Measurements are accumulated and published in the next animation frame, identical
pane dimensions do not trigger a new store write, and pending callbacks are
cancelled on cleanup. This does not suppress browser errors.

Pane cleanup uses `disconnect()` even after React clears its DOM ref, following
the diagnosis by Sawmonabo in [#6053](https://github.com/xyflow/xyflow/issues/6053)
and MokiMeow's [#6054](https://github.com/xyflow/xyflow/pull/6054), commit `c7d0fcb`.
The separate `@xyflow/system` extent-observer change is not included here.

Both upstream PRs were still open when inspected on 2026-10-20. This is a local
backport, not an upstream released fix. Re-evaluate it when upgrading React Flow.
`pnpm install --frozen-lockfile` applies the exact patch recorded by pnpm.
