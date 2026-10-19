// Prepare a common review exercise from recorded evidence. No model/tests run.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const source = "docs/evidence/system-workspace/2026-10-20";
const sourceHashes = {};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function recorded(name) {
  const bytes = await readFile(`${source}/${name}`);
  sourceHashes[`${source}/${name}`] = digest(bytes);
  return JSON.parse(bytes.toString("utf8"));
}
const candidate = await recorded("installed-next-candidate.json");
const failure = await recorded("missing-server-guards.json");
const verified = await recorded("installed-next-verification.json");
assert.equal(candidate.jobId, verified.jobId);
assert.equal(candidate.jobId, failure.candidateJob);
assert.equal(candidate.review.files.length, 7);
assert.ok(failure.originalRestored && !failure.error);
assert.deepEqual(failure.protected, candidate.lockedFilesUnchanged);
assert.deepEqual(verified.unverifiedInvariantsPreserved, [
  "invariant:0",
  "invariant:2",
]);

const faulty = structuredClone(candidate.review.files);
const action = faulty.find((file) => file.path === failure.guardsOmitted.path);
assert.ok(action);
assert.equal(action.afterHash, failure.guardsOmitted.goodHash);
// Same omission as test-permission-failure.mjs, independently checked by hash.
const guard =
  /    if \(!canManageTeamMembers\(userWithTeam\.teamRole\)\) \{\r?\n      return \{ error: 'Only team owners can (?:remove|invite) team members' \};\r?\n    \}\r?\n/g;
assert.equal([...action.after.matchAll(guard)].length, 2);
assert.equal(failure.guardsOmitted.count, 2);
action.after = action.after.replace(guard, "");
action.afterHash = digest(action.after);
assert.equal(action.afterHash, failure.guardsOmitted.faultHash);
for (const file of candidate.review.files) {
  assert.equal(digest(file.after), file.afterHash, file.path);
  if (file.beforeHash !== null)
    assert.equal(digest(file.before), file.beforeHash, file.path);
  else assert.ok(file.before === null || file.before === "", file.path);
  assert.equal(failure.restoredCandidateHashes[file.path], file.afterHash);
}
assert.equal(
  failure.uiHash,
  candidate.review.files.find(
    (file) => file.path === "app/(dashboard)/dashboard/page.tsx",
  ).afterHash,
);
const testOf = (checks) => checks.find((check) => check.name === "test");
assert.equal(testOf(failure.job.checks).status, "failed");
assert.equal(testOf(failure.job.checks).exitCode, 1);
assert.match(
  testOf(failure.job.checks).output,
  /Tests\s+2 failed\s*\|\s*7 passed/,
);
assert.equal(testOf(candidate.checks).status, "passed");
assert.equal(testOf(candidate.checks).exitCode, 0);
assert.match(testOf(candidate.checks).output, /Tests\s+9 passed/);
for (const checks of [candidate.checks, failure.job.checks]) {
  const typecheck = checks.find((check) => check.name === "typecheck");
  assert.equal(typecheck.status, "passed");
  assert.equal(typecheck.exitCode, 0);
}

const zip = new JSZip();
const files = {};
const entries = new Map();
function add(path, bytes) {
  assert.ok(!path.includes("\\") && !path.split("/").includes(".."));
  assert.ok(!path.startsWith("/") && !path.includes(":"));
  assert.ok(!Object.hasOwn(files, path), `Duplicate archive entry: ${path}`);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  files[path] = digest(buffer);
  entries.set(path, buffer);
  zip.file(path, buffer, {
    date: new Date("2026-10-20T00:00:00Z"),
    createFolders: false,
  });
}
const json = (value) => JSON.stringify(value, null, 2) + "\n";
add("README.md", await readFile("docs/user-study/PARTICIPANT_REVIEW.md"));
add("requirements.json", json(candidate.assessment.criteria));
const license = await readFile(
  "validation/next-saas-starter/LICENSE.upstream.txt",
);
assert.match(license.toString("utf8"), /Copyright \(c\) 2025 Vercel/);
add("LICENSE.next-saas-starter.txt", license);
add("LICENSE.pureobom.txt", await readFile("LICENSE"));

for (const [id, changes, checks] of [
  ["A", faulty, failure.job.checks],
  ["B", candidate.review.files, candidate.checks],
]) {
  const prefix = `candidate-${id}/`;
  add(
    prefix + "files.json",
    json(
      changes.map(({ path, beforeHash, afterHash }) => ({
        path,
        change: beforeHash === null ? "added" : "modified",
        beforeHash,
        afterHash,
      })),
    ),
  );
  add(prefix + "checks.json", json(checks));
  add(
    prefix + "checks.txt",
    checks
      .map(
        (check) =>
          `${check.name}: ${check.status}; exit ${check.exitCode}\n${check.output}`,
      )
      .join("\n\n"),
  );
  for (const file of changes) {
    if (file.beforeHash !== null)
      add(prefix + "before/" + file.path, file.before);
    add(prefix + "after/" + file.path, file.after);
  }
}

const bytes = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});
// Re-open the result and byte-compare every entry before writing the artifact.
const reopened = await JSZip.loadAsync(bytes, { checkCRC32: true });
assert.deepEqual(
  Object.keys(reopened.files).sort(),
  [...entries.keys()].sort(),
);
for (const [path, expected] of entries)
  assert.deepEqual(
    await reopened.file(path).async("nodebuffer"),
    expected,
    path,
  );

await mkdir("release", { recursive: true });
assert.ok(!(await lstat("release")).isSymbolicLink());
for (const name of ["user-study-review.zip", "user-study-evidence.json"]) {
  const existing = await lstat(`release/${name}`).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  assert.ok(!existing || (existing.isFile() && !existing.isSymbolicLink()));
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope:
    "Prepared common file-review exercise from historical records. No new test, model, native UI or participant run. Not a product-effect comparison by itself.",
  archive: "user-study-review.zip",
  archiveSha256: digest(bytes),
  archiveBytes: bytes.length,
  sourceHashes,
  candidates: {
    A: {
      kind: "controlled-missing-server-guards",
      jobId: failure.job.id,
      guardsOmitted: failure.guardsOmitted,
      passed: 7,
      failed: 2,
    },
    B: {
      kind: "recorded-real-model-candidate",
      jobId: candidate.jobId,
      passed: 9,
      failed: 0,
      unverifiedInvariants: verified.unverifiedInvariantsPreserved,
    },
  },
  files,
};
await writeFile("release/user-study-review.zip", bytes);
await writeFile("release/user-study-evidence.json", json(report));
console.log(
  `User study review package: ${entries.size} files; ${bytes.length} bytes`,
);
console.log(`SHA-256: ${report.archiveSha256}`);
console.log(
  "Historical source hashes and archive bytes verified; no participants or new execution results.",
);
