# Pinned sqlc SQLite regression

External MIT project: https://github.com/sqlc-dev/sqlc at `c69308b521a50f92fee48ae623702c5550c49d95`. Target: `examples/authors/sqlite/query.sql`. The unchanged upstream `TestAuthors` creates and retrieves one author. It checks errors, but logs rather than asserts the complete author contents. This is one example test, not sqlc's full suite.

```sh
git clone --filter=blob:none --sparse https://github.com/sqlc-dev/sqlc.git test-results/projects/sqlc
git -C test-results/projects/sqlc checkout c69308b521a50f92fee48ae623702c5550c49d95
git -C test-results/projects/sqlc sparse-checkout set examples/authors/sqlite internal/sqltest internal/sql/sqlpath internal/sqlite3ext internal/migrations
```

Use Go 1.27.2 and official sqlc 1.31.1. Set absolute `PUREOBOM_TEST_GO` and `PUREOBOM_TEST_SQLC` executable paths. The checked Windows x64 archive is [sqlc_1.31.1_windows_amd64.zip](https://github.com/sqlc-dev/sqlc/releases/download/v1.31.1/sqlc_1.31.1_windows_amd64.zip), 15,284,588 bytes, SHA-256 `352711fa7dcb05dcdfefca0ad71b2c9a74fd090f8d7fc609419de4cbc725429f`, matched to the official release asset digest. Do not use that digest for another platform. No system PATH change is required. Initial Go dependencies need the network; versions/checksums come from upstream modules.

```sh
pnpm extension:build
node scripts/test-sql-source-project.mjs
```

The launcher requires a clean pinned checkout, creates an isolated VS Code 1.96.4 profile and reviewed process task, then removes its temporary task configuration. The runner creates a local-only sqlc configuration with just the original SQLite schema/query/generator fields. It does not use the repository's cloud configuration or other DB targets. `sqlc generate` regenerates the example; `go test -json -tags examples -count=1 ./authors/sqlite` runs from the nested `examples` module. The three original generated Go files and exact line endings are restored after every task.

The editor harness selects SQLite, prepares `LIMIT 1 → LIMIT 0`, opens native diff, applies without saving, verifies the unsaved-check block, saves and runs the same task. The regression fails with `sql: no rows in result set`; native undo and save restore the passing test. Raw reports: `test-results/sql-source-project.json` and `.events.json`. The SQL and checkout must be restored cleanly.

Preparation failures: running from the repository root missed the nested examples module; sparse checkout without `internal/migrations` missed an imported package. Both were corrected using the upstream module and its actual dependencies. No upstream code or assertions were changed.
