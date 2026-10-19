// Opt-in continuation of a preserved, disposable installed-UI validation run.
// Uses the packaged managed host. Never starts in the developer's own project.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { build } from "esbuild";
import JSZip from "jszip";

assert.equal(process.env.PUREOBOM_RUN_CODEX, "1");
assert.ok(
  process.env.PUREOBOM_CODEX_PATH,
  "Pass the reviewed Codex executable.",
);
assert.ok(
  process.argv[2] && process.argv[3],
  "Pass installed validation directory and interrupted job UUID.",
);
const previousRun = resolve(process.argv[2]),
  previousId = process.argv[3];
const tempRelative = relative(tmpdir(), previousRun);
assert.match(tempRelative, /^pureobom-installed-ui-[\w-]+$/);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const config = await json(resolve(previousRun, "configuration.json"));
assert.equal(config.realProvider, true);
const source = resolve(previousRun, "project");
assert.equal(resolve(config.source), source);
const storage = resolve(
  previousRun,
  "profile/User/globalStorage/pureobom-local.pureobom/implementation-jobs",
);
const parent = resolve(previousRun, "continuation-runs");
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, "run-"));
const runtime = resolve(run, "client.cjs");
await build({
  stdin: {
    contents: `export {ManagedImplementationJobs} from './extension/src/agent/managedJobs'; export {jobRecordSchema} from './extension/src/agent/jobs'; export {loadJobWorkspace,reviewJobWorkspace} from './extension/src/agent/gitWorkspace'; export {analyzeStructure} from './src/workspace/analyze'; export {observeSpec,specDocumentSchema} from './src/workspace/spec'; export {projectFeatures} from './src/workspace/features'; export {assertReviewReady} from './src/workspace/review';`,
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
  jobRecordSchema,
  loadJobWorkspace,
  reviewJobWorkspace,
  analyzeStructure,
  observeSpec,
  specDocumentSchema,
  projectFeatures,
  assertReviewReady,
} = createRequire(import.meta.url)(runtime);
assert.match(previousId, /^[a-f0-9-]{36}$/);
const originalRecord = jobRecordSchema.parse(
  await json(resolve(storage, previousId, "job.json")),
);
assert.ok(
  ["interrupted", "cancelled", "failed"].includes(originalRecord.state.phase),
);
assert.ok(originalRecord.specSnapshot);
assert.equal(resolve(originalRecord.source), source);
const oldWorkspace = await loadJobWorkspace(storage, previousId, source);
const partial = await reviewJobWorkspace(oldWorkspace);
assert.ok(
  partial.files.length,
  "This validation requires real preserved partial changes.",
);
const exec = promisify(execFile);
const git = async (...args) =>
  (
    await exec("git", ["-C", source, ...args], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function originalUnchanged() {
  for (const [path, expected] of Object.entries(config.originalHashes))
    assert.equal(hash(await readFile(resolve(source, path))), expected, path);
  assert.equal((await git("rev-parse", "HEAD")).trim(), config.originalHead);
  assert.equal(await git("diff", "--cached"), config.originalIndex);
  assert.equal(await git("status", "--porcelain"), config.originalStatus);
}
await originalUnchanged();
const { version } = await json("extension/package.json");
const bytes = await readFile(`release/pureobom-${version}.vsix`);
const zip = await JSZip.loadAsync(bytes);
const host = await zip.file("extension/out/agent-host.cjs").async("nodebuffer");
assert.deepEqual(host, await readFile("extension/out/agent-host.cjs"));
const hostPath = resolve(run, "agent-host.cjs");
await writeFile(hostPath, host);
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  previousRun,
  previousId,
  source,
  originalRecord,
  partial,
  events: [],
  artifact: { vsixSha256: hash(bytes), hostSha256: hash(host) },
  scope:
    "Real Codex continuation through the packaged managed host; CLI client, not a new installed UI or native Webview test. Prior failure remains a separate result.",
};
const reportPath = resolve(run, "report.json");
const save = () =>
  writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
await save();
console.log(
  JSON.stringify({
    run,
    previousId,
    partialFiles: partial.files.map((f) => f.path),
  }),
);
let finish, finishReview, lastPhase, seedWitness;
const completion = new Promise((done) => {
  finish = done;
});
const reviewed = new Promise((done) => {
  finishReview = done;
});
const seen = new Set();
const jobs = new ManagedImplementationJobs(
  storage,
  hostPath,
  (state, error) => {
    if (error) console.error(JSON.stringify({ connectionError: error }));
    if (!state || state.continuedFrom !== previousId) return;
    if (state.phase !== lastPhase) {
      report.events.push({
        at: new Date().toISOString(),
        id: state.id,
        phase: state.phase,
      });
      console.log(
        JSON.stringify({
          id: state.id,
          phase: state.phase,
          worktree: state.worktree,
          message: state.message.slice(-1600),
        }),
      );
      lastPhase = state.phase;
    }
    if (state.phase === "running" && !seedWitness) {
      seedWitness = Promise.all(
        partial.files.map(async (file) => {
          const actual = await readFile(
            resolve(state.worktree, file.path),
          ).then(hash, (error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          return { path: file.path, expected: file.afterHash, actual };
        }),
      );
    }
    for (const approval of state.approvals) {
      const key = state.id + ":" + approval.id;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(JSON.stringify({ jobId: state.id, approval }));
      }
    }
    if (["review", "failed", "cancelled"].includes(state.phase)) finish(state);
  },
);
const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
  try {
    const value = JSON.parse(line);
    if (value.action === "status")
      console.log(
        JSON.stringify({ state: jobs.state, running: jobs.isRunning }),
      );
    else if (value.action === "cancel") await jobs.cancel(value.jobId);
    else if (value.action === "review") {
      await jobs.reviewDecision(value.decision);
      assertReviewReady(
        jobs.state.assessment,
        jobs.state.checks,
        jobs.state.reviewDecision,
      );
      finishReview();
    } else await jobs.decide(value.id, value.decision, value.jobId);
  } catch (error) {
    console.error(String(error));
  }
});
async function analyzeCurrent() {
  const document = specDocumentSchema.parse(
    await json(resolve(source, ".pureobom/specs.json")),
  );
  assert.deepEqual(
    document.specs.find((spec) => spec.id === originalRecord.specSnapshot.id),
    originalRecord.specSnapshot,
    "The saved design must remain unchanged",
  );
  const paths = (
    await git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
  )
    .split("\0")
    .filter(
      (path) =>
        path &&
        !path.startsWith(".") &&
        /\.(?:[cm]?[jt]sx?|jsonc?|md|py|go|rs|java|cs|html|css|sql)$/.test(
          path,
        ),
    );
  const base = await analyzeStructure(
    await Promise.all(
      [...new Set(paths)].sort().map(async (path) => ({
        path,
        content: await readFile(resolve(source, path), "utf8"),
      })),
    ),
  );
  return projectFeatures(base, document.features ?? []);
}
try {
  await jobs.restore(source, previousId);
  assert.equal(jobs.state.id, previousId);
  assert.equal(jobs.isRunning, false);
  assert.equal(jobs.savedSpec, JSON.stringify(originalRecord.specSnapshot));
  const started = await jobs.resume(source, previousId, {
    executable: process.env.PUREOBOM_CODEX_PATH,
    checks: ["test", "typecheck"],
    allowExternal: true,
    specSnapshot: originalRecord.specSnapshot,
  });
  assert.notEqual(started.id, previousId);
  report.resumedId = started.id;
  await save();
  const final = await completion;
  report.job = final;
  report.seedWitness = await seedWitness;
  await save();
  assert.equal(final.phase, "review", final.message);
  assert.ok(
    final.checks.length === 2 &&
      final.checks.every((check) => check.status === "passed"),
  );
  assert.ok(report.seedWitness?.length);
  for (const file of report.seedWitness)
    assert.equal(file.actual, file.expected, file.path);
  assert.deepEqual(
    await reviewJobWorkspace(oldWorkspace),
    partial,
    "Old partial changes must remain untouched",
  );
  await originalUnchanged();
  const candidate = jobRecordSchema.parse(
    await json(resolve(storage, final.id, "job.json")),
  );
  report.review = candidate.review;
  report.protected = {};
  for (const path of [
    "pureobom-validation/permissions.test.tsx",
    "pureobom-validation/vitest.config.mts",
    "package.json",
    "pnpm-lock.yaml",
  ]) {
    const actual = hash(await readFile(resolve(final.worktree, path)));
    assert.equal(actual, config.originalHashes[path], path);
    report.protected[path] = actual;
  }
  await save();
  console.log(
    JSON.stringify(
      {
        reportPath,
        checks: final.checks,
        assessment: final.assessment,
        decisionTemplate: {
          jobId: final.id,
          reviewId: final.reviewId,
          approvedScopePaths: [],
          reviewedVerificationPaths: [],
          acceptUnverified: false,
          criteria: final.assessment.criteria.map((item) => ({
            id: item.id,
            outcome: "unverified",
            note: "",
            checkNames: [],
          })),
        },
      },
      null,
      2,
    ),
  );
  console.log(
    "REVIEW REQUIRED: inspect the actual candidate and evidence, then send action=review.",
  );
  await reviewed;
  report.reviewDecision = jobs.state.reviewDecision;
  const before = await analyzeCurrent();
  report.before = {
    files: before.files,
    observation: observeSpec(originalRecord.specSnapshot, before),
  };
  assert.equal(report.before.observation.status, "unchanged");
  await save();
  await jobs.apply(final.reviewId);
  assert.equal(jobs.state.phase, "applied");
  const after = await analyzeCurrent();
  report.applied = {
    files: after.files,
    observation: observeSpec(originalRecord.specSnapshot, after).status,
  };
  assert.equal(report.applied.observation, "changed");
  for (const file of candidate.review.files) {
    const actual = await readFile(resolve(source, file.path)).then(
      hash,
      (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    assert.equal(actual, file.afterHash, file.path);
  }
  await jobs.undo(final.reviewId);
  assert.equal(jobs.state.phase, "undone");
  const restored = await analyzeCurrent();
  assert.deepEqual(restored.files, before.files);
  await originalUnchanged();
  assert.deepEqual(await reviewJobWorkspace(oldWorkspace), partial);
  assert.equal(jobs.savedSpec, JSON.stringify(originalRecord.specSnapshot));
  report.undone = {
    files: restored.files,
    observation: observeSpec(originalRecord.specSnapshot, restored).status,
  };
  assert.equal(report.undone.observation, "unchanged");
  report.originalRestored = true;
  report.previousPartialPreserved = true;
  report.finishedAt = new Date().toISOString();
  await save();
  console.log("LIVE CONTINUATION PASSED " + reportPath);
} catch (error) {
  report.error = String(error);
  await save();
  throw error;
} finally {
  // A failed validation assertion must not leave its disposable original applied.
  // Preserve the failure and recover through the same managed transaction.
  if (jobs.state?.phase === "applied") {
    try {
      await jobs.undo(jobs.state.reviewId);
      await originalUnchanged();
      report.cleanupRestoredOriginal = true;
    } catch (error) {
      report.cleanupError = String(error);
      process.exitCode = 1;
    }
    await save();
  }
  input.close();
  jobs.dispose();
}
