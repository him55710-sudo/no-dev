import * as vscode from "vscode";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { DesignWorkspace } from "../src/designWorkspace";
import { specForTargets } from "../../src/workspace/spec";
import { readingChangeContext } from "../../src/workspace/codeReading";
const exec = promisify(execFile);
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function run() {
  const extension = vscode.extensions.getExtension<{
    designWorkspace: DesignWorkspace;
    runtimeMode: number;
  }>("pureobom-local.pureobom")!;
  const api = await extension.activate();
  assert.equal(api.runtimeMode, vscode.ExtensionMode.Production);
  assert.equal(
    createHash("sha256")
      .update(
        await readFile(resolve(extension.extensionPath, "out/extension.cjs")),
      )
      .digest("hex"),
    process.env.PUREOBOM_CODE_READING_BUNDLE_SHA256,
  );
  const workspace = api.designWorkspace;
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const reportPath = process.env.PUREOBOM_CODE_READING_REPORT!;
  const request = (action: string, payload?: unknown) =>
    workspace.handleRequest({ id: action, action, payload });
  const before = await readFile(resolve(root, "src/shipping.js"), "utf8");
  const testBefore = await readFile(
    resolve(root, "test/shipping.test.js"),
    "utf8",
  );
  const events: string[] = [];
  let last = "";
  const listener = workspace.changes.event((state) => {
    const message = state.fileReadingProgress?.message ?? state.job?.phase;
    if (message && message !== last) {
      last = message;
      events.push(message);
      console.log(message);
    }
  });
  try {
    await workspace.open();
    const graph = workspace.state.graph!;
    const target = graph.nodes.find(
      (node) =>
        node.kind === "file" &&
        node.sources.some((ref) => ref.path === "src/shipping.js"),
    )!;
    await request("readFile", {
      projectKey: workspace.state.projectKey,
      revision: graph.revision,
      path: "src/shipping.js",
    });
    const reading = workspace.state.fileReading!;
    assert.equal(reading.source, before);
    assert.equal(
      reading.sourceHash,
      graph.files.find((file) => file.path === reading.path)!.hash,
    );
    assert.ok(reading.blocks.length);
    assert.equal(
      await readFile(resolve(root, "src/shipping.js"), "utf8"),
      before,
    );
    const block = reading.blocks.find(
      (block) => block.endLine === reading.lineCount,
    )!;
    assert.ok(block, "The final source lines must be explained.");
    const spec = specForTargets(workspace.state.specs, graph, [target.id]);
    const anchor = {
      path: reading.path,
      revision: reading.revision,
      sourceHash: reading.sourceHash,
      startLine: block.startLine,
      endLine: block.endLine,
    };
    const payload = {
      projectKey: workspace.state.projectKey,
      targetIds: [target.id],
      expectedRevision: spec.revision,
      content: {
        ...spec.content,
        title: "무료배송 기준 낮추기",
        purpose: readingChangeContext(reading, block),
        desired:
          "일반 배송은 3만 원 이상이면 무료로 바꿔줘. 빠른 배송은 금액과 관계없이 5천 원으로 유지해줘. 잘못된 주문 금액을 확인하는 규칙은 다른 계산에서도 쓸 수 있도록 별도 파일의 함수로 분리하고 배송비 계산에서 사용해줘. 기존 오류 안내와 유효한 금액의 처리는 유지해줘. 정책 설명과 테스트를 새 규칙에 맞추고 29,999원, 30,000원, 빠른 배송, 잘못된 입력을 검사해줘. 기존 검사 명령과 설치할 프로그램 목록은 바꾸지 마.",
        acceptance: [
          "일반 배송 29,999원은 3,000원, 30,000원은 0원",
          "빠른 배송은 5,000원",
          "잘못된 금액은 기존 안내로 실패",
          "금액 검사를 별도 파일의 함수로 분리해 사용",
        ],
      },
      execution: {
        context: workspace.state.execution!.context,
        checks: ["test", "check"],
        profileRevision: workspace.state.execution!.profile.revision,
        allowExternal: true,
      },
      readingAnchor: anchor,
    };
    await assert.rejects(
      request("implement", {
        ...payload,
        readingAnchor: { ...anchor, sourceHash: "f".repeat(64) },
      }),
      /일치/,
    );
    assert.equal(
      workspace.state.job,
      undefined,
      "A stale explanation cannot start implementation.",
    );
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          stage: "read",
          inferenceRun: true,
          reading,
          staleAnchorRejected: true,
          events,
        },
        null,
        2,
      ),
    );
    await request("implement", payload);
    const deadline = Date.now() + 12 * 60000;
    const decided = new Set<string>();
    while (Date.now() < deadline) {
      const job = workspace.state.job!;
      for (const approval of job.approvals) {
        if (decided.has(approval.id)) continue;
        decided.add(approval.id);
        const allowed =
          approval.kind === "file" &&
          job.worktree &&
          (!approval.cwd || resolve(approval.cwd) === resolve(job.worktree));
        await request("decideJob", {
          jobId: job.id,
          id: approval.id,
          decision: allowed ? "accept" : "decline",
        });
      }
      if (["review", "failed", "cancelled"].includes(job.phase)) break;
      await delay(500);
    }
    const job = workspace.state.job!;
    await writeFile(
      reportPath,
      JSON.stringify(
        { stage: "generated", inferenceRun: true, reading, job, events },
        null,
        2,
      ),
    );
    assert.equal(job.phase, "review", job.message);
    assert.ok(
      job.checks.length === 2 &&
        job.checks.every((check) => check.status === "passed"),
    );
    const addedCode = job.files.filter(
      (file) =>
        file.kind === "added" &&
        file.path.endsWith(".js") &&
        !/test/.test(file.path),
    );
    assert.ok(
      addedCode.length,
      "The request must create the separate validation file.",
    );
    assert.equal(
      await readFile(resolve(root, "src/shipping.js"), "utf8"),
      before,
    );
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
        note: "The independent post-apply probe below verifies behavior separately from generated tests.",
        checkNames: [],
      })),
    });
    await request("applyJob", { reviewId: job.reviewId });
    const appliedGraph = workspace.state.graph!;
    assert.ok(
      appliedGraph.edges.some(
        (edge) =>
          edge.kind === "calls" &&
          edge.sources.some((source) => source.path === "src/shipping.js") &&
          appliedGraph.nodes.some(
            (node) =>
              node.id === edge.target &&
              node.sources.some((source) =>
                addedCode.some((file) => file.path === source.path),
              ),
          ),
      ),
      "The shipping function must call the newly extracted helper.",
    );
    const probe = await exec(
      process.env.PUREOBOM_TEST_NODE!,
      [
        "--input-type=module",
        "-e",
        "import assert from 'node:assert/strict';import {shippingFee} from './src/shipping.js';assert.equal(shippingFee(29999),3000);assert.equal(shippingFee(30000),0);assert.equal(shippingFee(0),3000);assert.equal(shippingFee(60000,'express'),5000);for(const n of [-1,NaN,Infinity,'100',null])assert.throws(()=>shippingFee(n),/주문 금액을 확인해 주세요/);console.log('9 independent runtime cases passed');",
      ],
      { cwd: root, windowsHide: true, timeout: 30000 },
    );
    await request("undoJob", { reviewId: job.reviewId });
    assert.equal(
      await readFile(resolve(root, "src/shipping.js"), "utf8"),
      before,
    );
    assert.equal(
      await readFile(resolve(root, "test/shipping.test.js"), "utf8"),
      testBefore,
    );
    for (const file of job.files.filter((file) => file.kind === "added"))
      await assert.rejects(readFile(resolve(root, file.path)), {
        code: "ENOENT",
      });
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          stage: "completed",
          inferenceRun: true,
          installedPath: extension.extensionPath,
          reading,
          changes,
          job,
          probe: probe.stdout,
          staleAnchorRejected: true,
          newHelperCalled: true,
          restored: true,
          events,
        },
        null,
        2,
      ),
    );
    console.log(
      "Installed file reading → anchored multi-file implementation → checked review → runtime probe → undo passed.",
    );
  } finally {
    listener.dispose();
  }
}
