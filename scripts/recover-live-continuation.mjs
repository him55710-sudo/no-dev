// Finish an already-applied disposable validation job. Never launches a model.
// Keep the failed report intact; report recovery under a separate filename.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

assert.ok(process.argv[2], "Pass the preserved continuation run directory");
const run = resolve(process.argv[2]);
assert.match(
  relative(tmpdir(), run),
  /^pureobom-installed-ui-[\w-]+[/\\]continuation-runs[/\\]run-[\w-]+$/,
);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const failed = await json(resolve(run, "report.json"));
assert.ok(failed.error && failed.resumedId && failed.reviewDecision);
assert.equal(
  resolve(failed.previousRun, "continuation-runs", run.split(/[/\\]/).at(-1)),
  run,
);
const source = resolve(failed.previousRun, "project");
assert.equal(resolve(failed.source), source);
const config = await json(resolve(failed.previousRun, "configuration.json"));
assert.equal(config.realProvider, true);
assert.equal(resolve(config.source), source);
const storage = resolve(
  failed.previousRun,
  "profile/User/globalStorage/pureobom-local.pureobom/implementation-jobs",
);
const runtime = resolve(run, "recovery-client.cjs");
await build({
  stdin: {
    contents: `export {ManagedImplementationJobs} from './extension/src/agent/managedJobs'; export {loadJobWorkspace,reviewJobWorkspace} from './extension/src/agent/gitWorkspace'; export {analyzeStructure} from './src/workspace/analyze'; export {projectFeatures} from './src/workspace/features'; export {observeSpec,specDocumentSchema} from './src/workspace/spec';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: runtime,
  bundle: true,
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  target: "node24",
});
const {
  ManagedImplementationJobs,
  loadJobWorkspace,
  reviewJobWorkspace,
  analyzeStructure,
  projectFeatures,
  observeSpec,
  specDocumentSchema,
} = createRequire(import.meta.url)(runtime);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hostPath = resolve(run, "agent-host.cjs");
assert.equal(hash(await readFile(hostPath)), failed.artifact.hostSha256);
const exec = promisify(execFile);
const git = async (...args) =>
  (
    await exec("git", ["-C", source, ...args], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const documentBytes = await readFile(resolve(source, ".pureobom/specs.json"));
const document = specDocumentSchema.parse(JSON.parse(documentBytes));
const spec = failed.originalRecord.specSnapshot;
assert.deepEqual(
  document.specs.find((item) => item.id === spec.id),
  spec,
);
const analysis = async () => {
  const paths = [
    ...new Set(
      (
        await git(
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        )
      )
        .split("\0")
        .filter(
          (path) =>
            path &&
            !path.startsWith(".") &&
            /\.(?:[cm]?[jt]sx?|jsonc?|md|py|go|rs|java|cs|html|css|sql)$/.test(
              path,
            ),
        ),
    ),
  ].sort();
  const base = await analyzeStructure(
    await Promise.all(
      paths.map(async (path) => ({
        path,
        content: await readFile(resolve(source, path), "utf8"),
      })),
    ),
  );
  return projectFeatures(base, document.features ?? []);
};
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  failedReport: resolve(run, "report.json"),
  previousId: failed.previousId,
  resumedId: failed.resumedId,
  artifact: failed.artifact,
  scope:
    "Reattach to the same already-applied job, restore saved business features in validation analysis, verify applied bytes, and undo. No provider restart or new implementation.",
};
const jobs = new ManagedImplementationJobs(storage, hostPath, () => {});
const reportPath = resolve(run, "post-apply-recovery.json");
let error;
try {
  await jobs.restore(source, failed.resumedId);
  assert.equal(jobs.state.phase, "applied");
  assert.equal(jobs.state.reviewId, failed.review.id);
  assert.deepEqual(jobs.state.reviewDecision, failed.reviewDecision);
  report.appliedHashes = {};
  for (const file of failed.review.files) {
    const actual = await readFile(resolve(source, file.path)).then(
      hash,
      (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    assert.equal(actual, file.afterHash, file.path);
    report.appliedHashes[file.path] = actual;
  }
  const applied = await analysis();
  report.applied = {
    files: applied.files,
    observation: observeSpec(spec, applied),
  };
  assert.equal(report.applied.observation.status, "changed");
} catch (caught) {
  error = caught;
  report.error = String(caught);
} finally {
  try {
    if (jobs.state?.phase === "applied") await jobs.undo(jobs.state.reviewId);
    assert.equal(jobs.state?.phase, "undone");
    report.originalHashes = {};
    for (const [path, expected] of Object.entries(config.originalHashes)) {
      const actual = hash(await readFile(resolve(source, path)));
      assert.equal(actual, expected, path);
      report.originalHashes[path] = actual;
    }
    assert.equal((await git("rev-parse", "HEAD")).trim(), config.originalHead);
    assert.equal(await git("diff", "--cached"), config.originalIndex);
    assert.equal(await git("status", "--porcelain"), config.originalStatus);
    assert.deepEqual(
      await readFile(resolve(source, ".pureobom/specs.json")),
      documentBytes,
    );
    assert.equal(jobs.savedSpec, JSON.stringify(spec));
    const old = await loadJobWorkspace(storage, failed.previousId, source);
    assert.deepEqual(await reviewJobWorkspace(old), failed.partial);
    const undone = await analysis();
    report.undone = {
      files: undone.files,
      observation: observeSpec(spec, undone),
    };
    assert.equal(report.undone.observation.status, "unchanged");
    report.originalRestored = true;
    report.previousPartialPreserved = true;
    report.savedDesignPreserved = true;
  } catch (caught) {
    error ??= caught;
    report.recoveryError = String(caught);
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  jobs.dispose();
}
if (error) throw error;
console.log(
  JSON.stringify({
    reportPath,
    phase: "undone",
    appliedFiles: report.applied.files.length,
    restoredFiles: report.undone.files.length,
    originalFiles: Object.keys(report.originalHashes).length,
    originalRestored: true,
  }),
);
