# humantime: unchanged upstream Rust tests

Use a disposable clean checkout of [humantime v2.3.0](https://github.com/chronotope/humantime/tree/7994b7129851ea3b0e5df8bee67870898e52fa1c), commit `7994b7129851ea3b0e5df8bee67870898e52fa1c`. The project is MIT OR Apache-2.0. The report selects the [MIT license](../../../docs/evidence/local-ai/HUMANTIME_LICENSE.txt) for its source excerpts.

This harness deliberately changes the integer hour coefficient from `3600` to `3601`. It tests source reading, exact literal editing, native diff/apply/undo and detection by the original unit and doc tests. It does not discover an upstream bug, test a model, or measure an optimization. Do not point it at a working project with unsaved changes.

From the Pureobom root:

```powershell
git clone --depth 1 --branch v2.3.0 https://github.com/chronotope/humantime.git test-results/projects/humantime
Copy-Item scripts/fixtures/humantime/Cargo.lock test-results/projects/humantime/Cargo.lock
pnpm extension:build
```

The checked-in lockfile fixes the resolved test dependencies. Upstream ignores `Cargo.lock`; its source and tests are not adapted. Prepare those dependencies with `cargo fetch --locked --manifest-path test-results/projects/humantime/Cargo.toml` using the same Cargo cache as the harness. Initial dependency and tool downloads need network access. The measured task uses `--locked --offline --all-features --no-fail-fast`, unit tests plus doc tests, and no benchmark mode.

The recorded Windows environment used Rust **1.90.0 x86_64-pc-windows-gnu**, the `llvm-tools` component and the included LLVM linker. Install them with rustup into `test-results/tools/rust/rustup` and use `test-results/tools/rust/cargo` as `CARGO_HOME`. These are validation tools, not requirements for Pureobom's bundled Rust reader.

```powershell
$rustTools = Join-Path (Get-Location) 'test-results/tools/rust'
New-Item -ItemType Directory -Force -Path $rustTools | Out-Null
$env:RUSTUP_HOME = Join-Path $rustTools 'rustup'
$env:CARGO_HOME = Join-Path $rustTools 'cargo'
# Use an existing rustup executable, or a verified isolated rustup.exe in $rustTools.
rustup toolchain install 1.90.0-x86_64-pc-windows-gnu --profile minimal --no-self-update
rustup component add llvm-tools --toolchain 1.90.0-x86_64-pc-windows-gnu
$cargo = Join-Path $env:RUSTUP_HOME 'toolchains/1.90.0-x86_64-pc-windows-gnu/bin/cargo.exe'
$env:PATH = (Split-Path $cargo) + ';' + $env:PATH
& $cargo fetch --locked --manifest-path test-results/projects/humantime/Cargo.toml
& scripts/fixtures/humantime/run-windows.ps1
```

`run-windows.ps1` sets process-local compiler/doc flags and cache/output paths. It creates the missing `llvm-dlltool.exe` name from the same `llvm-ar.exe` binary inside the isolated toolchain; this is the driver dispatch used by [LLVM's own build](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/tools/llvm-ar/CMakeLists.txt). `rustc -Cdlltool` selects the import-library tool, while the included `rust-lld` handles the workspace's Unicode paths. No registry or permanent PATH changes are needed. This exact configuration does not establish compatibility with every Rust SDK or linker.

The launcher checks the pinned clean checkout, creates only its own `.vscode/tasks.json` with exclusive creation, and removes that configuration in `finally`. VS Code 1.96.4 runs in an isolated profile. `rustSourceProject.ts` expects all 42 upstream tests, verifies unsaved execution is blocked, explicitly saves the candidate, runs the actual process task, then uses native undo, saves and reruns. It compares original disk bytes and checks clean Git status. Emergency restoration in `finally` is not counted as successful native undo.

Results remain in `test-results/rust-source-project.json`. A failed run must be preserved before rerunning. Public records must redact machine-specific paths and keep failed setup attempts separate from the project test results. Review the report before publication.
