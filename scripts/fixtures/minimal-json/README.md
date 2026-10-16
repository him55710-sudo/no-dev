# Optional minimal-json Java regression

Use this fixture for actual upstream library tests and VS Code edit/check/undo evidence. It is separate from the default product test count. See [results and limitations](../../../docs/evidence/local-ai/java-source-project.md).

Prerequisites: Node 24, the root project's frozen pnpm dependencies, a built extension, and Temurin JDK 25.0.4.1+1. Set `PUREOBOM_TEST_JAVA_HOME` or `JAVA_HOME` to the absolute JDK directory. The first VS Code test run downloads VS Code 1.96.4.

From the Pureobom repository:

```sh
git clone --depth 1 --branch 0.9.5 https://github.com/ralfstx/minimal-json.git test-results/projects/minimal-json
git -C test-results/projects/minimal-json rev-parse HEAD
# Must be 5518c876226ae07f8291d6b41209bc3c979f4a55
node scripts/run-minimal-json-tests.mjs test-results/projects/minimal-json test-results/minimal-json-setup.json --setup
pnpm extension:build
node scripts/test-java-source-project.mjs
```

The setup command downloads the four SHA-256-pinned jars in `dependencies.json` from Maven Central and runs the unchanged library tests. Later runs require those exact local jars and do not download dependencies. Upstream production/test files are compiled to a new ignored directory each run. The JDK compatibility adapter uses `--release 8` and opens `java.lang`/`java.io` only in the upstream test JVM for original Mockito 1.10.19. It does not run the performance module or Maven packaging/API-compatibility plugins and is not the original Maven build.

The VS Code harness requires a clean fixed checkout. It creates a temporary process task, verifies the baseline, changes `MAX_NESTING_LEVEL` from 1000 to 1 through Pureobom, verifies 13 failures, undoes/saves, and verifies baseline recovery. It checks no implicit save and blocks checks on unsaved edits. Outputs are `test-results/java-source-project.json` and the latest task report `test-results/java-source-project.events.jsonl` (despite its suffix, a single JSON object). It removes its task configuration and verifies a clean checkout. On headless Linux prefix the VS Code harness with `xvfb-run -a`; that external project flow has only been executed on Windows so far.

The project's [MIT notice](../../../docs/evidence/local-ai/MINIMAL_JSON_LICENSE.txt) is preserved. No upstream files or published repositories are modified permanently. This fixture is a known regression and recovery test, not a model-quality or optimization benchmark.
