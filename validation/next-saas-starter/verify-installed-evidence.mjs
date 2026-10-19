// Validate captured host/SQL records, independently of the UI's success labels.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const [reportPath, candidatePath, sqlPath, outputPath] = process.argv.slice(2);
assert.ok(reportPath && candidatePath && sqlPath && outputPath, 'Pass host report, candidate record, browser SQL record and output path.');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const [report, candidate, sql] = await Promise.all([read(reportPath), read(candidatePath), read(sqlPath)]);
assert.equal(report.originalRestored, true);
assert.deepEqual(report.clientErrors, []);
assert.deepEqual(report.artifact, candidate.artifact);
for (const action of ['checkConnection', 'saveExecution', 'implement', 'reviewJob', 'applyJob', 'undoJob'])
  assert.ok(report.requests.some(entry => entry.action === action && entry.ok), action);
const step = action => report.requests.findLast(entry => entry.action === action && entry.ok);
const initial = step('implement'), applied = step('applyJob'), undone = step('undoJob');
assert.equal(initial.job.id, candidate.jobId);
assert.equal(applied.job.id, candidate.jobId);
assert.equal(undone.job.id, candidate.jobId);
assert.equal(applied.job.phase, 'applied');
assert.equal(undone.job.phase, 'undone');
assert.ok(applied.job.checks.length && applied.job.checks.every(check => check.status === 'passed' && check.exitCode === 0));
assert.deepEqual(applied.specs, initial.specs, 'Applying code must not overwrite the saved design.');
assert.deepEqual(undone.specs, initial.specs, 'Undo must retain the saved design.');
const files = graph => Object.fromEntries(graph.files.map(file => [file.path, file.hash]));
const beforeFiles = files(initial.graph), afterFiles = files(applied.graph), undoneFiles = files(undone.graph);
assert.deepEqual(undoneFiles, beforeFiles, 'Undo must restore the entire analysis file set and hashes.');
const newFiles = candidate.review.files.filter(file => file.before === null);
assert.equal(newFiles.length, 3);
for (const file of candidate.review.files) {
  assert.equal(afterFiles[file.path], file.afterHash, `Applied file was not reanalysed: ${file.path}`);
  assert.equal(candidate.copiedFiles[file.path], file.afterHash, file.path);
}
for (const file of newFiles) {
  assert.equal(beforeFiles[file.path], undefined);
  assert.equal(undoneFiles[file.path], undefined);
}
assert.equal(applied.graph.files.length, initial.graph.files.length + newFiles.length);
assert.deepEqual(initial.observations.map(item => item.status), ['unchanged']);
assert.deepEqual(applied.observations.map(item => item.status), ['changed']);
assert.deepEqual(undone.observations.map(item => item.status), ['unchanged']);
const review = applied.job.reviewDecision;
assert.equal(review.criteria.filter(item => item.id.startsWith('acceptance:') && item.outcome === 'confirmed').length, 6);
assert.deepEqual(review.criteria.filter(item => item.outcome === 'unverified').map(item => item.id).sort(), ['invariant:0', 'invariant:2']);
assert.equal(review.acceptUnverified, true);
assert.equal(sql.database.kind, 'PostgreSQL');
assert.equal(sql.teamProbe.status, 200);
const [start, member, invited, removed] = sql.snapshots;
assert.deepEqual(start.members.map(item => [item.user_id, item.role]), [[1, 'owner'], [2, 'member']]);
assert.deepEqual(start.invitations, []);
assert.deepEqual(start.activity, []);
assert.deepEqual(member.members, start.members);
assert.deepEqual(member.invitations, []);
assert.deepEqual(member.activity.map(item => [item.user_id, item.action]), [[2, 'SIGN_IN'], [2, 'SIGN_OUT']]);
assert.deepEqual(invited.invitations, [{ team_id: 1, email: 'owner-invited@fixture.invalid', role: 'member', invited_by: 1, status: 'pending' }]);
assert.deepEqual(invited.members, start.members);
assert.deepEqual(removed.members, [start.members[0]]);
assert.deepEqual(removed.invitations, invited.invitations);
assert.deepEqual(removed.activity.slice(2).map(item => [item.team_id, item.user_id, item.action]), [[1, 1, 'SIGN_IN'], [1, 1, 'INVITE_TEAM_MEMBER'], [1, 1, 'REMOVE_TEAM_MEMBER']]);
const summary = {
  checkedAt: new Date().toISOString(), jobId: candidate.jobId, artifact: candidate.artifact,
  originalRestored: true, designPreserved: true,
  analysisFileCounts: [initial.graph.files.length, applied.graph.files.length, undone.graph.files.length],
  newlyCollectedFiles: newFiles.map(file => file.path), allCandidateAnalysisHashesMatch: true,
  observationStates: ['unchanged', 'changed', 'unchanged'],
  confirmedAcceptanceCriteria: 6, unverifiedInvariantsPreserved: ['invariant:0', 'invariant:2'],
  browserDatabase: sql.database.kind + ' ' + sql.database.version,
  memberWritesAbsent: true, ownerInvitationAndRemovalPersisted: true,
  scope: 'Host requests, full file collection/hashes, saved design, review decisions and SQL snapshots. Actual browser interaction is evidenced separately by DOM records and screenshots. Native VS Code Webview delivery, production build and live Stripe remain unverified.'
};
await writeFile(outputPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
