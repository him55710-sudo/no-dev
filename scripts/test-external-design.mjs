// Opt-in real-provider validation against the pinned external Next.js clone.
// Does not publish to upstream, deploy, or touch a real account/database.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { build } from 'esbuild';

assert.equal(process.env.PUREOBOM_RUN_CODEX, '1', 'Explicitly enable the external real-provider test.');
assert.ok(process.argv[2], 'Pass the prepared external source directory.');
const source = resolve(process.argv[2]);
const exec = promisify(execFile);
const git = async (...args) => (await exec('git', ['-C', source, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout;
assert.equal((await git('status', '--porcelain')).trim(), '', 'Commit the prepared baseline before running.');
const parent = resolve(source, '..', 'implementation-runs');
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, 'run-'));
const runtime = resolve(run, 'runtime.cjs');
await build({
  stdin: {
    contents: `export {ImplementationJobs} from './extension/src/agent/jobs'; export {analyzeStructure} from './src/workspace/analyze'; export {draftSpec,prepareChange,observeSpec} from './src/workspace/spec'; export {assertReviewReady} from './src/workspace/review';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  outfile: runtime, bundle: true, platform: 'node', mainFields: ['module', 'main'], format: 'cjs', target: 'node24',
});
const { ImplementationJobs, analyzeStructure, draftSpec, prepareChange, observeSpec, assertReviewReady } = createRequire(import.meta.url)(runtime);
const paths = (await git('ls-files', '-z')).split('\0').filter(path => path && !path.startsWith('.') && !path.startsWith('pureobom-validation/') && /\.(?:tsx?|jsx?|json|md|css|sql|mjs)$/.test(path));
async function analyze() {
  return analyzeStructure(await Promise.all(paths.map(async path => ({ path, content: await readFile(resolve(source, path), 'utf8') }))));
}
const graph = await analyze();
const targets = ['inviteTeamMember', 'removeTeamMember'].map(label => {
  const node = graph.nodes.find(node => node.kind === 'symbol' && node.label === label);
  assert.ok(node, `Real source symbol missing: ${label}`);
  return node.id;
});
const spec = draftSpec(graph, targets);
spec.revision = 1;
spec.content.title = '팀 구성원 관리 권한';
spec.content.desired = '현재 팀의 owner만 구성원 초대와 제거를 할 수 있다. 일반 member는 팀 정보와 명단을 조회만 할 수 있다. 화면의 초대·제거 제어와 직접 호출한 서버 액션에 같은 팀별 권한 규칙을 적용한다. 계정 전역 role이나 다른 팀의 owner 권한으로 현재 팀 권한을 대신하지 않는다. 기존 Next.js 구조와 팀 데이터 모델을 사용한다.';
spec.content.policies = 'getTeamForUser/getUserWithTeam이 선택하는 현재 팀의 실제 team_members.role을 사용한다. 다른 팀 소속 memberId를 제거하면 실패하고 성공 활동 기록을 남기지 않는다. FormData의 memberId 문자열을 검증하여 실제 owner의 정상 제거가 동작해야 한다.';
spec.content.invariants = [
  '인증·결제·계정 변경의 기존 동작을 유지한다. 배포·push·외부 서비스 요청을 하지 않는다.',
  'pureobom-validation/permissions.test.tsx와 vitest.config.mts, package.json의 test/typecheck 명령을 바꾸거나 삭제하지 않는다. 검사 무효화나 skip으로 통과시키지 않는다.',
  '의존성은 이 작업 복사본에서 pnpm install --offline --frozen-lockfile --ignore-scripts로 설치한다. 원본이나 다른 프로젝트 node_modules를 연결하지 않는다.',
];
spec.content.acceptance = [
  '일반 member는 실제 팀 API에서 자기 팀 명단을 조회한다.',
  '일반 member의 직접 초대·제거 요청은 실패하며 SQL 데이터와 성공 활동 기록을 변경하지 않는다.',
  '현재 팀 owner의 초대·FormData 제거가 동작한다. 계정 전역 member 표시는 이를 막지 않는다.',
  '다른 팀의 owner 권한이나 제거 대상 memberId로 현재 팀 경계를 넘지 못한다.',
  '팀 member 화면은 초대·제거를 막고 이유를 표시하며 팀 owner 화면은 정상 편집을 허용한다.',
  '고정한 독립 인수 검사 9개와 typecheck를 실제로 통과한다.',
];
const request = prepareChange(spec, graph, 'behavior');
const locked = Object.fromEntries(await Promise.all(['pureobom-validation/permissions.test.tsx', 'pureobom-validation/vitest.config.mts'].map(async path => [path, createHash('sha256').update(await readFile(resolve(source, path))).digest('hex')])));
const report = {
  startedAt: new Date().toISOString(), sourceCommit: (await git('rev-parse', 'HEAD')).trim(),
  upstream: 'https://github.com/nextjs/saas-starter/tree/6e33e58b1e553a41fe22e6b941a7229a002de361',
  graph: { files: graph.files.length, nodes: graph.nodes.length, edges: graph.edges.length, notices: graph.notices },
  request, locked, limitations: ['independent harness added to upstream; not upstream tests', 'PGlite test database, not a production PostgreSQL instance', 'Next request cookies supplied by test harness; real JWT and database code', 'React server rendering, not installed Webview or browser pointer flow', 'build, Stripe, HTTP server actions and production authentication not verified'],
};
const reportPath = resolve(run, 'report.json');
const save = async () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await save();
console.log(JSON.stringify({ run, graph: { files: graph.files.length, nodes: graph.nodes.length, edges: graph.edges.length }, scope: request.scopePaths }));
let finish, finishReview, phase;
const completion = new Promise(resolveDone => { finish = resolveDone; });
const reviewed = new Promise(resolveDone => { finishReview = resolveDone; });
const seenApprovals = new Set();
const jobs = new ImplementationJobs(resolve(run, 'jobs'), state => {
  if (phase !== state.phase) {
    console.log(JSON.stringify({ phase: state.phase, worktree: state.worktree, message: state.message.slice(-1600) }));
    phase = state.phase;
  }
  for (const approval of state.approvals) if (!seenApprovals.has(approval.id)) {
    seenApprovals.add(approval.id);
    console.log(JSON.stringify({ approval }));
  }
  if (['review', 'failed', 'cancelled'].includes(state.phase)) finish(state);
});
const input = createInterface({ input: process.stdin });
input.on('line', async line => {
  try {
    const value = JSON.parse(line);
    if (value.action === 'review') {
      await jobs.reviewDecision(value.decision);
      assertReviewReady(jobs.state.assessment, jobs.state.checks, jobs.state.reviewDecision);
      finishReview();
    } else jobs.decide(value.id, value.decision);
  } catch (error) { console.error(String(error)); }
});
try {
  jobs.start(source, request, { executable: process.env.PUREOBOM_CODEX_PATH || 'codex', checks: ['test', 'typecheck'], allowExternal: true, specSnapshot: spec });
  const final = await completion;
  report.job = final;
  await save();
  console.log(`REPORT ${reportPath}`);
  assert.equal(final.phase, 'review', final.message);
  assert.ok(final.checks.length === 2 && final.checks.every(check => check.status === 'passed'));
  for (const [path, hash] of Object.entries(locked)) assert.equal(createHash('sha256').update(await readFile(resolve(final.worktree, path))).digest('hex'), hash, 'Independent acceptance harness was altered');
  console.log(JSON.stringify({ assessment: final.assessment, checks: final.checks, decisionTemplate: { jobId: final.id, reviewId: final.reviewId, approvedScopePaths: [], reviewedVerificationPaths: [], acceptUnverified: false, criteria: final.assessment.criteria.map(item => ({ id: item.id, outcome: 'unverified', note: '', checkNames: [] })) } }, null, 2));
  console.log('REVIEW REQUIRED: inspect actual diffs and results, then submit action=review with an explicit decision.');
  await reviewed;
  report.reviewDecision = jobs.state.reviewDecision;
  await jobs.apply(final.reviewId);
  assert.equal(jobs.state.phase, 'applied');
  report.afterApply = { observation: observeSpec(spec, await analyze()).status, desiredPreserved: spec.content.desired === request.desired };
  assert.equal(report.afterApply.observation, 'changed');
  await jobs.undo(final.reviewId);
  assert.equal(jobs.state.phase, 'undone');
  assert.equal((await git('status', '--porcelain')).trim(), '');
  report.afterUndo = { observation: observeSpec(spec, await analyze()).status };
  assert.equal(report.afterUndo.observation, 'unchanged');
  report.applyUndo = 'passed';
  report.finishedAt = new Date().toISOString();
  await save();
  console.log('EXTERNAL DESIGN IMPLEMENTATION PASSED');
} catch (error) {
  report.error = String(error);
  await save();
  throw error;
} finally {
  input.close();
  jobs.dispose();
}
