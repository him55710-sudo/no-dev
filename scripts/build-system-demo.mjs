// Publish a bounded walkthrough from recorded evidence, not simulated product results.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = "docs/evidence/system-workspace/2026-10-20";
const output = "public/media/system-workspace";
const json = async (name) =>
  JSON.parse(await readFile(`${source}/${name}`, "utf8"));
const trace = await json("installed-next-ui.json");
const candidate = await json("installed-next-candidate.json");
const verified = await json("installed-next-verification.json");
const failure = await json("missing-server-guards.json");
const fixed = await json("installed-next-fixed-tests.json");
const extra = await json("installed-next-extra-tests.json");
const account = await json("account-regressions-candidate.json");
assert.equal(candidate.jobId, verified.jobId);
assert.ok(
  trace.originalRestored &&
    verified.originalRestored &&
    verified.designPreserved,
);
assert.equal(trace.clientErrors.length, 0);
assert.deepEqual(verified.analysisFileCounts, [52, 55, 52]);
assert.ok(
  [fixed, extra, account].every((r) => r.success && r.numPendingTests === 0),
);
assert.deepEqual(
  [fixed.numPassedTests, extra.numPassedTests, account.numPassedTests],
  [9, 21, 18],
);
assert.equal(candidate.review.files.length, 7);
assert.ok(failure.originalRestored && !failure.error);
assert.equal(failure.positiveControl.status, "passed");
assert.match(failure.applyRejection, /검사가 통과한 뒤/);
assert.match(
  failure.job.checks.find((c) => c.name === "test").output,
  /Tests\s+2 failed\s*\|\s*7 passed/,
);
const spec = trace.finalSpecs.specs.find((s) => s.id === trace.jobs[0].specId);
assert.ok(spec);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const pictures = [
  "installed-next-applied.jpg",
  "installed-next-undone.jpg",
  "installed-next-member.jpg",
  "installed-next-owner.jpg",
];
const assets = {};
await mkdir(output, { recursive: true });
for (const name of pictures) {
  const bytes = await readFile(`${source}/${name}`);
  await writeFile(`${output}/${name}`, bytes);
  assets[name] = digest(bytes);
}
const evidence = {
  schemaVersion: 1,
  sourceJob: candidate.jobId,
  recordedAt: trace.checkedAt,
  artifact: candidate.artifact.vsixSha256,
  request: {
    title: spec.content.title,
    desired: spec.content.desired,
    acceptance: spec.content.acceptance,
  },
  files: candidate.review.files.map((f) => ({
    path: f.path,
    change: f.beforeHash === null ? "added" : "modified",
    beforeHash: f.beforeHash,
    afterHash: f.afterHash,
  })),
  checks: {
    fixed: fixed.numPassedTests,
    extra: extra.numPassedTests,
    account: account.numPassedTests,
    typecheck: candidate.checks.find((c) => c.name === "typecheck").status,
  },
  analysis: verified.analysisFileCounts,
  originalRestored: verified.originalRestored,
  designPreserved: verified.designPreserved,
  unverifiedInvariants: verified.unverifiedInvariantsPreserved,
  failure: {
    provider: failure.provider,
    sourceCandidate: failure.candidateJob,
    omittedGuards: failure.guardsOmitted,
    failed: 2,
    passed: 7,
    positiveControl: 9,
    applyRejection: failure.applyRejection,
    originalRestored: failure.originalRestored,
  },
  assets,
  scope:
    "Recorded installed-bundle/real-host/real-Codex success, using a browser transport substitute; separate deliberate missing-guard fixture with real tests and apply rejection. Not live implementation, native Webview verification, a timing benchmark, a user study, or production payment validation.",
};
await writeFile(
  `${output}/evidence.json`,
  JSON.stringify(evidence, null, 2) + "\n",
);
const html = await readFile("public/workspace-demo.html", "utf8");
for (const name of pictures)
  assert.ok(html.includes(`./media/system-workspace/${name}`), name);
assert.ok(
  html.includes("의도적으로") &&
    html.includes("네이티브") &&
    html.includes("미확인"),
);
console.log(
  JSON.stringify({
    sourceJob: evidence.sourceJob,
    files: evidence.files.length,
    checks: evidence.checks,
    analysis: evidence.analysis,
    pictures: pictures.length,
    failure: { failed: 2, passed: 7, positiveControl: 9 },
  }),
);
