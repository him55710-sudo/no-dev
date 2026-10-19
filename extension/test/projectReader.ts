import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { DesignWorkspace } from "../src/designWorkspace";
import { specForTargets } from "../../src/workspace/spec";
const exec = promisify(execFile);
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const output = process.env.PUREOBOM_PROJECT_READER_REPORT!;
  const extension = vscode.extensions.getExtension<{
    designWorkspace: DesignWorkspace;
    runtimeMode: number;
  }>("pureobom-local.pureobom")!;
  const api = await extension.activate();
  assert.equal(
    api.runtimeMode,
    vscode.ExtensionMode.Production,
    "Must exercise the installed VSIX",
  );
  const workspace = api.designWorkspace;
  const request = (action: string, payload?: unknown) =>
    workspace.handleRequest({ id: action, action, payload });
  const events: string[] = [];
  let last = "",
    prepared: Promise<unknown> | undefined;
  const listener = workspace.changes.event((state) => {
    const message = state.storyProgress?.message ?? state.job?.phase;
    if (message && message !== last) {
      last = message;
      events.push(message);
      console.log(message);
    }
    if (state.job?.worktree && !prepared) {
      // Test environment preparation only: restore the existing lockfile's packages
      // from the local package store. No source changes and no model substitute.
      prepared = exec(
        "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          "pnpm install --ignore-workspace --offline --ignore-scripts --frozen-lockfile",
        ],
        {
          cwd: state.job.worktree,
          windowsHide: true,
          timeout: 180000,
          maxBuffer: 200000,
        },
      );
      void prepared.catch(() => {});
    }
  });
  const before = await readFile(resolve(root, "index.js"), "utf8");
  try {
    await workspace.open();
    const connection = await request(
      "checkConnection",
      workspace.state.execution!.context,
    );
    assert.equal(workspace.state.connection?.status, "ready");
    await request("explainProject", {
      projectKey: workspace.state.projectKey,
      revision: workspace.state.graph!.revision,
    });
    const story = workspace.state.story!;
    assert.equal(story.sourceFileCount, workspace.state.graph!.files.length);
    assert.ok(story.summary.length > 20);
    assert.ok(story.parts.flatMap((part) => part.paths).includes("index.js"));
    assert.equal(
      await readFile(resolve(root, "index.js"), "utf8"),
      before,
      "Summary must not change source",
    );
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        { stage: "summarized", connection, story, events },
        null,
        2,
      ),
    );
    const graph = workspace.state.graph!;
    const target = graph.nodes.find(
      (node) =>
        node.kind === "file" &&
        node.sources.some((source) => source.path === "index.js"),
    )!;
    const spec = specForTargets(workspace.state.specs, graph, [target.id]);
    const desired =
      "문자열이 아닌 값을 받았을 때 오류 안내를 '문자열을 입력해 주세요.'로 바꿔 주세요. 입력값이 문자열인지 확인하는 규칙을 같은 파일의 별도 함수로 분리하고 변환 기능이 그 함수를 사용하도록 구조를 정리해 주세요. 유효한 문자열을 처리하는 기존 방식과 외부 함수 사용법은 그대로 유지해 주세요. 숫자, null, undefined, 빈 문자열의 동작을 테스트로 확인해 주세요. 파일 배포 설정이나 의존성, 검사 명령은 바꾸지 마세요.";
    await request("implement", {
      projectKey: workspace.state.projectKey,
      targetIds: [target.id],
      specId: spec.revision > 0 ? spec.id : undefined,
      expectedRevision: spec.revision,
      content: {
        ...spec.content,
        title: "잘못된 입력을 한국어로 안내",
        desired,
        acceptance: [
          "문자열이 아닌 입력에는 TypeError와 한국어 안내를 전달한다.",
          "빈 문자열과 기존 특수 문자 변환은 그대로 유지한다.",
        ],
      },
      execution: {
        context: workspace.state.execution!.context,
        checks: ["test"],
        profileRevision: workspace.state.execution!.profile.revision,
        allowExternal: true,
      },
    });
    const deadline = Date.now() + 12 * 60000,
      decided = new Set<string>();
    while (Date.now() < deadline) {
      const job = workspace.state.job!;
      for (const approval of job.approvals) {
        if (decided.has(approval.id)) continue;
        decided.add(approval.id);
        // This run is already authorized to edit this disposable public-project copy.
        // Reject commands needing broader permissions; file requests are restricted to its worktree.
        const allowed =
          approval.kind === "file" &&
          !!job.worktree &&
          (!approval.cwd || resolve(approval.cwd) === resolve(job.worktree));
        await request("decideJob", {
          jobId: job.id,
          id: approval.id,
          decision: allowed ? "accept" : "decline",
        });
      }
      if (["review", "failed", "cancelled"].includes(job.phase)) break;
      await delay(800);
    }
    if (prepared) await prepared;
    const job = workspace.state.job!;
    await writeFile(
      output,
      JSON.stringify(
        { stage: "generated", connection, story, job, events },
        null,
        2,
      ),
    );
    assert.equal(job.phase, "review", job.message);
    assert.ok(
      job.checks.length &&
        job.checks.every((check) => check.status === "passed"),
      JSON.stringify(job.checks),
    );
    assert.equal(
      await readFile(resolve(root, "index.js"), "utf8"),
      before,
      "Generation must preserve the original",
    );
    // The UI can start the same request on entering review. Wait for that request if needed.
    while (workspace.state.changeStoryBusy) await delay(500);
    if (workspace.state.changeStory?.reviewId !== job.reviewId)
      await request("explainChanges", { reviewId: job.reviewId });
    const changes = workspace.state.changeStory!;
    assert.equal(changes.changes.length, job.files.length);
    await assert.rejects(
      request("applyJob", { reviewId: job.reviewId }),
      /검토/,
    );
    await request("reviewJob", {
      jobId: job.id,
      reviewId: job.reviewId,
      approvedScopePaths: job
        .assessment!.files.filter((file) => file.outsideScope)
        .map((file) => file.path),
      reviewedVerificationPaths: job
        .assessment!.files.filter((file) => file.verification)
        .map((file) => file.path),
      acceptUnverified: true,
      criteria: job.assessment!.criteria.map((criterion) => ({
        id: criterion.id,
        outcome: "unverified",
        note: "Actual post-apply assertions below independently verify the requested behavior.",
        checkNames: [],
      })),
    });
    await request("applyJob", { reviewId: job.reviewId });
    const after = await readFile(resolve(root, "index.js"), "utf8");
    assert.ok(after.includes("문자열을 입력해 주세요."));
    const probe = await exec(
      process.env.PUREOBOM_TEST_NODE!,
      [
        "--input-type=module",
        "-e",
        "import assert from 'node:assert/strict';import escape from './index.js';for(const value of [1,null,undefined])assert.throws(()=>escape(value),{name:'TypeError',message:'문자열을 입력해 주세요.'});assert.equal(escape(''),'');assert.equal(escape('a-b'),'a\\\\x2db');console.log('3 invalid inputs, empty string and hyphen verified');",
      ],
      { cwd: root, windowsHide: true },
    );
    await writeFile(
      output,
      JSON.stringify(
        {
          stage: "applied",
          inferenceRun: true,
          installedPath: extension.extensionPath,
          connection,
          story,
          changes,
          job,
          probe: probe.stdout,
          events,
        },
        null,
        2,
      ),
    );
    await request("undoJob", { reviewId: job.reviewId });
    assert.equal(await readFile(resolve(root, "index.js"), "utf8"), before);
    await writeFile(
      output,
      JSON.stringify(
        {
          stage: "completed",
          inferenceRun: true,
          installedPath: extension.extensionPath,
          connection,
          story,
          changes,
          job,
          probe: probe.stdout,
          restored: true,
          events,
          extensionHash: createHash("sha256")
            .update(
              await readFile(
                resolve(extension.extensionPath, "out/extension.cjs"),
              ),
            )
            .digest("hex"),
        },
        null,
        2,
      ),
    );
    console.log(
      "Installed real-AI flow passed: whole-project reading, generation, Korean comparison, guarded apply, runtime assertions and undo.",
    );
  } finally {
    listener.dispose();
  }
}
