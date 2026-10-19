# Bundled Rust syntax parser

The desktop worker reads only these local assets. It does not download a parser,
run Cargo/rustc, execute build scripts, expand macros or import project code.

- `tree-sitter-rust.wasm`: official **tree-sitter-rust v0.24.2** release asset,
  https://github.com/tree-sitter/tree-sitter-rust/releases/tag/v0.24.2
- SHA-256: `24c89bd9252255e4aebbcbd7d2d308bd92c86dd95a130fdc80efa49577b8d738`
- Size: 1,118,099 bytes. `LICENSE` is the MIT license from that fixed tag.
- `web-tree-sitter.wasm`: copied at build time from the lockfile-pinned
  **web-tree-sitter 0.27.1** package. The JS binding is bundled into `out/worker.cjs`.
  Both MIT notices are included in `THIRD_PARTY_NOTICES.txt` during packaging.

Normal builds verify the checked-in Rust grammar digest and require no download
of grammar assets. `node scripts/fetch-rust-grammar.mjs` is an optional maintainer
refresh command and verifies the fixed digest before writing the file.

Grammar parsing is not Rust compiler, type, lifetime, ownership, macro, cfg,
module-resolution, behavioral or performance validation. See `docs/RUST_SOURCE.md`.
