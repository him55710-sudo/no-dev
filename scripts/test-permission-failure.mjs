// Reproduce a missing-server-guard failure through the actual implementation manager.
// The provider is an explicit deterministic fault fixture, never claimed as AI output.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { build } from "esbuild";

assert.ok(
  process.argv[2],
  "Pass a reviewed, prepared external baseline Git repository",
);
const evidence = resolve("docs/evidence/system-workspace/2026-10-20");
const candidate = JSON.parse(
  await readFile(resolve(evidence, "installed-next-candidate.json"), "utf8"),
);
const trace = JSON.parse(
  await readFile(resolve(evidence, "installed-next-ui.json"), "utf8"),
);
const spec = trace.finalSpecs.specs[0];
const run = await mkdtemp(resolve(tmpdir(), "pureobom-failure-demo-"));
const source = resolve(run, "project");
const exec = promisify(execFile);
await exec(
  "git",
  ["clone", "--no-hardlinks", resolve(process.argv[2]), source],
  { windowsHide: true },
);
const git = async (...args) =>
  (
    await exec("git", ["-C", source, ...args], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalPaths = (await git("ls-files", "-z")).split("\0").filter(Boolean);
const originalHashes = Object.fromEntries(
  await Promise.all(
    originalPaths.map(async (path) => [
      path,
      hash(await readFile(resolve(source, path))),
    ]),
  ),
);
for (const file of candidate.review.files) {
  const before = await readFile(resolve(source, file.path)).then(
    hash,
    (error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  assert.equal(before, file.beforeHash, file.path);
}
const faults = structuredClone(candidate.review.files);
const action = faults.find((file) => file.path === "app/(login)/actions.ts");
const guard =
  /    if \(!canManageTeamMembers\(userWithTeam\.teamRole\)\) \{\r?\n      return \{ error: 'Only team owners can (?:remove|invite) team members' \};\r?\n    \}\r?\n/g;
assert.equal(
  [...action.after.matchAll(guard)].length,
  2,
  "Exactly the two recorded server guards",
);
action.after = action.after.replace(guard, "");
const guardsOmitted = {
  path: action.path,
  goodHash: action.afterHash,
  faultHash: hash(action.after),
  count: 2,
};
await copyFile(
  "validation/next-saas-starter/failure-peer.mjs",
  resolve(source, "app-server"),
);
await writeFile(
  resolve(source, ".pureobom-failure.json"),
  JSON.stringify({
    kind: "pureobom-controlled-missing-server-guards",
    files: faults.map(({ path, after }) => ({ path, after })),
  }),
);
await git(
  "-c",
  "user.name=Pureobom Fixture",
  "-c",
  "user.email=fixture@pureobom.invalid",
  "add",
  "--",
  "app-server",
  ".pureobom-failure.json",
);
await git(
  "-c",
  "user.name=Pureobom Fixture",
  "-c",
  "user.email=fixture@pureobom.invalid",
  "commit",
  "-m",
  "Add explicit fault demonstration peer",
);
const baseline = {
  head: (await git("rev-parse", "HEAD")).trim(),
  index: await git("diff", "--cached"),
  status: await git("status", "--porcelain"),
};
const runtime = resolve(run, "runtime.cjs");
await build({
  stdin: {
    contents: `export {ImplementationJobs} from './extension/src/agent/jobs'; export {verifyWorkspace,availableChecks} from './extension/src/agent/verify';`,
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
const { ImplementationJobs, verifyWorkspace, availableChecks } = createRequire(
  import.meta.url,
)(runtime);
const request = {
  id: "controlled-server-guard-failure",
  specId: spec.id,
  specRevision: spec.revision,
  graphRevision: spec.baseline.graphRevision,
  content: spec.content,
  desired: spec.content.desired,
  invariants: spec.content.invariants,
  acceptance: spec.content.acceptance,
  sources: spec.baseline.sources,
  scopePaths: spec.baseline.sources.map((ref) => ref.path),
};
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  run,
  source,
  candidateJob: candidate.jobId,
  provider: "Controlled deterministic stdio fault peer; NOT AI",
  guardsOmitted,
  originalHashes,
  events: [],
  scope:
    "Actual implementation manager, actual locked external-app tests, failed-check apply rejection, restored-candidate positive control. CLI harness, not a new browser or native Webview run.",
};
let complete, lastPhase;
const completion = new Promise((done) => {
  complete = done;
});
const jobs = new ImplementationJobs(resolve(run, "jobs"), (state) => {
  if (lastPhase !== state.phase) {
    report.events.push({
      at: new Date().toISOString(),
      phase: state.phase,
      checks: state.checks,
    });
    console.log(
      JSON.stringify({
        phase: state.phase,
        worktree: state.worktree,
        approvals: state.approvals,
      }),
    );
    lastPhase = state.phase;
  }
  if (["review", "failed", "cancelled"].includes(state.phase)) complete(state);
});
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const value = JSON.parse(line);
    assert.equal(value.id, "fault-files");
    assert.ok(["accept", "decline", "cancel"].includes(value.decision));
    jobs.decide(value.id, value.decision);
  } catch (error) {
    console.error(String(error));
  }
});
console.log(
  JSON.stringify({
    run,
    instruction:
      'At the first approval, install dependencies inside the printed worktree using pnpm install --offline --frozen-lockfile --ignore-scripts. Review each fixture approval, then send {"id":"fault-files","decision":"accept"}. The repair attempt intentionally repeats the known fault.',
  }),
);
try {
  jobs.start(source, request, {
    executable: process.execPath,
    allowExternal: true,
    checks: ["test", "typecheck"],
    specSnapshot: spec,
  });
  const final = await completion;
  await jobs.flush();
  report.job = final;
  assert.equal(final.phase, "review", final.message);
  assert.equal(
    final.checks.find((check) => check.name === "test").status,
    "failed",
  );
  assert.match(
    final.checks.find((check) => check.name === "test").output,
    /Tests\s+2 failed\s*\|\s*7 passed/,
  );
  assert.equal(
    final.checks.find((check) => check.name === "typecheck").status,
    "passed",
  );
  report.protected = {};
  for (const path of Object.keys(candidate.lockedFilesUnchanged)) {
    const actual = hash(await readFile(resolve(final.worktree, path)));
    assert.equal(actual, candidate.lockedFilesUnchanged[path], path);
    report.protected[path] = actual;
  }
  const uiPath = "app/(dashboard)/dashboard/page.tsx";
  report.uiHash = hash(await readFile(resolve(final.worktree, uiPath)));
  assert.equal(report.uiHash, candidate.copiedFiles[uiPath]);
  await assert.rejects(jobs.apply(final.reviewId), (error) => {
    report.applyRejection = error.message;
    return /검사가 통과한 뒤/.test(error.message);
  });
  // Restore only the omitted guards in the isolated candidate; keep failed job evidence.
  await writeFile(
    resolve(final.worktree, action.path),
    candidate.review.files.find((file) => file.path === action.path).after,
  );
  const checks = await availableChecks(final.worktree, true);
  report.positiveControl = await verifyWorkspace(
    final.worktree,
    "test",
    new AbortController().signal,
    180000,
    checks.scripts.test,
    checks.manager,
  );
  assert.equal(
    report.positiveControl.status,
    "passed",
    report.positiveControl.output,
  );
  assert.match(report.positiveControl.output, /Tests\s+9 passed/);
  report.restoredCandidateHashes = {};
  for (const file of candidate.review.files) {
    const actual = hash(await readFile(resolve(final.worktree, file.path)));
    assert.equal(actual, file.afterHash, file.path);
    report.restoredCandidateHashes[file.path] = actual;
  }
  for (const [path, expected] of Object.entries(originalHashes))
    assert.equal(hash(await readFile(resolve(source, path))), expected, path);
  assert.equal((await git("rev-parse", "HEAD")).trim(), baseline.head);
  assert.equal(await git("diff", "--cached"), baseline.index);
  assert.equal(await git("status", "--porcelain"), baseline.status);
  report.originalRestored = true;
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  if (jobs.state?.phase === "applied") await jobs.undo(jobs.state.reviewId);
  await writeFile(
    resolve(run, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  input.close();
  jobs.dispose();
}
console.log(
  JSON.stringify({
    report: resolve(run, "report.json"),
    failedTests: report.job?.checks.map((check) => ({
      name: check.name,
      status: check.status,
    })),
    applyRejection: report.applyRejection,
    positiveControl: report.positiveControl?.status,
    error: report.error,
  }),
);
