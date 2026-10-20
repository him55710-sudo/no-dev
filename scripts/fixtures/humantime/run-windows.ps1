# Run from the repository root after the fixture and isolated Rust toolchain are ready.
$ErrorActionPreference = 'Stop'
$rustTools = (Resolve-Path 'test-results/tools/rust').Path
$env:RUSTUP_HOME = Join-Path $rustTools 'rustup'
$env:CARGO_HOME = Join-Path $rustTools 'cargo'
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'test-results/humantime-target'
$rustBin = Join-Path $env:RUSTUP_HOME 'toolchains/1.90.0-x86_64-pc-windows-gnu/bin'
$llvmBin = Join-Path $env:RUSTUP_HOME 'toolchains/1.90.0-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin'
# LLVM's ar binary selects the dlltool driver by executable name.
$alias = Join-Path $llvmBin 'llvm-dlltool.exe'
if (!(Test-Path -LiteralPath $alias)) {
  Copy-Item -LiteralPath (Join-Path $llvmBin 'llvm-ar.exe') -Destination $alias
}
$rustFlags = @(('-Cdlltool=' + $alias), ('-Clinker=' + (Join-Path $llvmBin 'rust-lld.exe')), '-Clinker-flavor=ld.lld', '-Clink-self-contained=yes')
$env:CARGO_ENCODED_RUSTFLAGS = $rustFlags -join [char]31
$env:CARGO_ENCODED_RUSTDOCFLAGS = $rustFlags -join [char]31
$env:PATH = $rustBin + ';' + $env:PATH
$env:PUREOBOM_TEST_CARGO = Join-Path $rustBin 'cargo.exe'
node scripts/test-rust-source-project.mjs
exit $LASTEXITCODE
