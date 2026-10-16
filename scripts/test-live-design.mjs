// Explicitly opt-in: sends this synthetic example to the locally authenticated Codex CLI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { build } from "esbuild";
if (process.env.PUREOBOM_RUN_CODEX !== "1")
  throw Error(
    "Set PUREOBOM_RUN_CODEX=1 to run the synthetic real-model integration test.",
  );
const exec = promisify(execFile),
  parent = resolve("test-results/live-design");
await mkdir(parent, { recursive: true });
const run = await mkdtemp(resolve(parent, "run-")),
  source = resolve(run, "source");
await cp("examples/system-workspace", source, {
  recursive: true,
  filter: (path) =>
    !path
      .split(/[\\/]/)
      .some((name) => ["node_modules", "dist", ".pureobom"].includes(name)),
});
const locked = `import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectEditor} from '../components/ProjectEditor';
import {readProject,updateProject,type Project} from '../features/sharing/service';
import {GET,PATCH} from '../app/api/projects/route';
describe('locked design acceptance',()=>{
 it('viewer reads but cannot mutate data',()=>{const p:Project={id:'one',title:'Original',members:{v:'viewer'}}; expect(readProject(p,'v').title).toBe('Original'); expect(()=>updateProject(p,'v','Changed')).toThrow(); expect(p.title).toBe('Original');});
 it('direct viewer API mutation returns 403 and preserves data',async()=>{const before=await GET().json();const result=await PATCH(new Request('http://fixture.invalid/api/projects',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Forbidden change'})}));expect(result.status).toBe(403);expect(await GET().json()).toEqual(before);});
 it('viewer sees disabled controls and an explicit read-only label',()=>{const html=renderToStaticMarkup(<ProjectEditor role='viewer' title='Project'/>);expect(html).toMatch(/<input[^>]+disabled/);expect(html).toMatch(/<button[^>]+disabled/);expect(html).toMatch(/읽기 전용|조회 전용/);});
 it('owner and editor continue to edit',()=>{for(const role of ['owner','editor'] as const){const p:Project={id:'one',title:'Original',members:{u:role}};expect(updateProject(p,'u','Edited').title).toBe('Edited');expect(renderToStaticMarkup(<ProjectEditor role={role} title='Project'/>)).not.toContain('disabled');}});
 it('permissions from another project cannot be reused',()=>{const a:Project={id:'a',title:'A',members:{u:'owner'}};const b:Project={id:'b',title:'B',members:{u:'viewer'}};expect(updateProject(a,'u','New A').title).toBe('New A');expect(()=>updateProject(b,'u','Bad')).toThrow();expect(b.title).toBe('B');});
});\n`;
await writeFile(resolve(source, "tests/acceptance.locked.test.tsx"), locked);
async function git(...args) {
  return (await exec("git", ["-C", source, ...args], { windowsHide: true }))
    .stdout;
}
await git("init");
await git("config", "user.name", "Pureobom Fixture");
await git("config", "user.email", "fixture@pureobom.invalid");
await git("config", "core.autocrlf", "false");
await git("add", ".");
await git("commit", "-m", "Synthetic design task baseline");
const runtime = resolve(run, "runtime.cjs");
await build({
  stdin: {
    contents: `export {ImplementationJobs} from './extension/src/agent/jobs'; export {analyzeStructure} from './src/workspace/analyze'; export {draftSpec,prepareChange} from './src/workspace/spec'; export {assertReviewReady} from './src/workspace/review';`,
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
  ImplementationJobs,
  analyzeStructure,
  draftSpec,
  prepareChange,
  assertReviewReady,
} = createRequire(import.meta.url)(runtime);
const paths = (await git("ls-files", "-z"))
  .split("\0")
  .filter((path) => path && !path.startsWith("."));
const graph = await analyzeStructure(
  await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(resolve(source, path), "utf8"),
    })),
  ),
);
const target = graph.nodes.find(
  (node) => node.kind === "symbol" && node.label === "canEdit",
);
assert.ok(target);
const spec = draftSpec(graph, [target.id]);
spec.revision = 1;
spec.content.title = "읽기 전용 공유 권한";
spec.content.desired =
  "viewer는 조회만 가능하다. 수정 UI의 입력과 버튼을 비활성화하고 읽기 전용 문구를 표시한다. API 직접 수정 요청은 HTTP 403으로 거절하고 데이터를 유지한다. owner/editor는 계속 수정할 수 있다.";
spec.content.policies =
  "프로젝트별 멤버 역할을 사용한다. 다른 프로젝트의 권한을 재사용할 수 없다.";
spec.content.invariants = [
  "owner/editor 편집 유지",
  "tests/acceptance.locked.test.tsx 파일은 수정하거나 삭제하지 않는다.",
];
spec.content.acceptance = [
  "viewer 조회 허용",
  "viewer 수정 UI 차단과 읽기 전용 안내",
  "직접 API 호출 403, 데이터 보존",
  "owner/editor 편집 유지",
  "다른 프로젝트 권한 재사용 거절",
  "test, typecheck, build 통과",
];
let finish, lastPhase, finishReview;
const reviewed = new Promise((resolveDone) => {
  finishReview = resolveDone;
});
const completion = new Promise((resolveDone) => {
  finish = resolveDone;
});
const jobs = new ImplementationJobs(resolve(run, "jobs"), (state) => {
  if (lastPhase !== state.phase) {
    console.log(
      JSON.stringify({
        phase: state.phase,
        worktree: state.worktree,
        message: state.message.slice(-1200),
      }),
    );
    lastPhase = state.phase;
  }
  if (state.approvals.length)
    console.log(JSON.stringify({ approvals: state.approvals }));
  if (["review", "failed", "cancelled"].includes(state.phase)) finish(state);
});
const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
  try {
    const value = JSON.parse(line);
    if (value.action === "review") {
      await jobs.reviewDecision(value.decision);
      assertReviewReady(
        jobs.state.assessment,
        jobs.state.checks,
        jobs.state.reviewDecision,
      );
      finishReview();
    } else jobs.decide(value.id, value.decision);
  } catch (error) {
    console.error(String(error));
  }
});
try {
  jobs.start(source, prepareChange(spec, graph, "behavior"), {
    executable: process.env.PUREOBOM_CODEX_PATH || "codex",
    checks: ["test", "typecheck", "build"],
    allowExternal: true,
  });
  const final = await completion;
  const report = {
    checkedAt: new Date().toISOString(),
    fixture: "examples/system-workspace",
    phase: final.phase,
    provider: final.provider,
    files: final.files,
    checks: final.checks,
    message: final.message,
  };
  await writeFile(resolve(run, "report.json"), JSON.stringify(report, null, 2));
  console.log(`REPORT ${relative(process.cwd(), resolve(run, "report.json"))}`);
  assert.equal(final.phase, "review", final.message);
  assert.ok(final.checks.every((check) => check.status === "passed"));
  assert.equal(
    await readFile(
      resolve(final.worktree, "tests/acceptance.locked.test.tsx"),
      "utf8",
    ),
    locked,
    "acceptance tests were not weakened",
  );
  assert.ok(final.files.some((file) => file.path.includes("policy.ts")));
  assert.ok(
    final.files.some((file) => file.path.includes("ProjectEditor.tsx")),
  );
  assert.ok(final.files.some((file) => file.path.includes("route.ts")));
  console.log(
    "REVIEW REQUIRED: inspect the proposal and actual check output, then submit a JSON line with action=review and an explicit decision. Unverified criteria must remain unverified.",
  );
  console.log(
    JSON.stringify(
      {
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
  await reviewed;
  report.reviewDecision = jobs.state.reviewDecision;
  await jobs.apply(final.reviewId);
  assert.equal(jobs.state.phase, "applied");
  await jobs.undo(final.reviewId);
  assert.equal(jobs.state.phase, "undone");
  assert.equal(
    (await git("status", "--porcelain")).trim(),
    "",
    "apply and undo restore the original source and index",
  );
  report.applyUndo = "passed";
  await writeFile(resolve(run, "report.json"), JSON.stringify(report, null, 2));
  console.log("LIVE DESIGN IMPLEMENTATION PASSED");
} finally {
  input.close();
  jobs.dispose();
}
