# GuardClauses C# source integration fixture

This runs the original upstream net8.0 tests while changing one known boundary through the actual VS Code extension. It is a regression-detection check, not an optimization or model-quality claim.

- Repository: https://github.com/ardalis/GuardClauses
- Commit: `f96b823e4228252b2927cce3effa550c16b558a5`
- License: MIT; see the upstream LICENSE at that commit.
- Source: `src/GuardClauses/GuardAgainstNegativeExtensions.cs`
- Known change: the `0` in `input.CompareTo(default(T)) < 0` becomes `1`.
- Local environment: Windows, VS Code 1.96.4, .NET SDK 10.0.402/runtime 10.0.13. The upstream target remains net8.0; `DOTNET_ROLL_FORWARD=Major` permits execution on the available newer runtime. This is not evidence of a native .NET 8 runtime run or every upstream target framework.

Install the SDK from Microsoft's official distribution and check its published archive hash. Clone the upstream repository into ignored `test-results/projects/guardclauses`, check out the exact commit, and verify `git status --porcelain` is empty. Set `PUREOBOM_TEST_DOTNET` to the absolute SDK `dotnet` executable. Do not reuse a checkout with valuable local edits.

```powershell
$env:PUREOBOM_TEST_DOTNET = 'C:\path\to\dotnet.exe'
pnpm install --frozen-lockfile
pnpm extension:build
node scripts/test-csharp-source-project.mjs
```

The harness creates an isolated VS Code profile and temporary process task, then removes only its task file. The task runs `scripts/run-guardclauses-tests.mjs` against the original test project with `--framework net8.0 -p:TargetFrameworks=net8.0 -p:GeneratePackageOnBuild=false`. SDK `--artifacts-path` keeps generated build files outside the checkout. NuGet dependencies are restored into an ignored local cache; initial preparation requires network access.

The editor check reads source, selects the exact literal, runs the original tests, previews a native C# diff, applies without saving, checks the unsaved-test gate, saves, runs the expected failing tests, uses native undo, saves, and reruns the original tests. It checks source SHA-256 restoration and a clean checkout. On failure it restores the original source bytes before closing. Reports are `test-results/csharp-source-project.json` and `.events.json`; TRX files are under `test-results/guardclauses-checks/`.

The temporary task runs reviewed upstream build/test code. Source reading and literal preparation use only the fixed Roslyn helper and do not run this task automatically. Public evidence must record original failures, failed assertions, runtime policy, commands and recovery separately.
