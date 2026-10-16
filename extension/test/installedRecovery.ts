import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { DesignWorkspace } from "../src/designWorkspace";
import type { SpecContent } from "../../src/workspace/spec";
const exec = promisify(execFile);
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const phase = process.env.PUREOBOM_RECOVERY_PHASE!;
const checkpointPath = process.env.PUREOBOM_RECOVERY_CHECKPOINT!;
type Checkpoint = {
  originalHashes: Record<string, string>;
  originalHead: string;
  originalIndex: string;
  originalStatus: string;
  phases: {
    phase: string;
    extensionHostPid: number;
    checkedAt: string;
    checks: string[];
    verification?: unknown;
  }[];
  firstJob?: { id: string; reviewId: string; worktree: string };
  crashJob?: { id: string; reviewId: string; worktree: string };
  crash?: {
    journalState: string;
    afterFiles: number;
    beforeFiles: number;
    progressEntries: number;
    termination: string;
  };
  recovered?: boolean;
};
async function waitFor(
  test: () => boolean | Promise<boolean>,
  label: string,
  timeout = 90000,
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${label}`);
}

export async function run() {
  const expected = JSON.parse(process.env.PUREOBOM_EXPECTED_INSTALL!);
  const extension = vscode.extensions.getExtension<{
    designWorkspace: DesignWorkspace;
    runtimeMode: vscode.ExtensionMode;
  }>("pureobom-local.pureobom")!;
  assert.ok(extension, "the packaged product must be installed");
  const location = relative(expected.extensionsPath, extension.extensionPath);
  assert.ok(
    location && !location.startsWith("..") && !isAbsolute(location),
    "product loads from the isolated installed extensions directory",
  );
  assert.equal(extension.packageJSON.version, expected.version);
  for (const [path, hash] of Object.entries(expected.files))
    assert.equal(
      digest(await readFile(resolve(extension.extensionPath, path))),
      hash,
      `installed artifact bytes: ${path}`,
    );
  const { designWorkspace: workspace, runtimeMode } =
    await extension.activate();
  assert.equal(runtimeMode, vscode.ExtensionMode.Production);
  await vscode.commands.executeCommand("pureobom.openWorkspace");
  assert.ok(workspace.state.graph);
  assert.equal(workspace.state.trusted, true);
  const source = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const checkpoint: Checkpoint = JSON.parse(
    await readFile(checkpointPath, "utf8"),
  );
  const checks = [
    "installed VSIX bytes match",
    "Production extension mode",
    "real workspace command opens analyzed design panel",
  ];
  const dispatch = (action: string, payload?: unknown) =>
    workspace.handleRequest({ id: `test-${phase}`, action, payload });
  const saveCheckpoint = () =>
    writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
  async function assertOriginal() {
    for (const [path, hash] of Object.entries(checkpoint.originalHashes))
      assert.equal(
        digest(await readFile(resolve(source, path))),
        hash,
        `original bytes restored: ${path}`,
      );
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", source, ...args], { windowsHide: true }))
        .stdout;
    assert.equal(
      (await git("rev-parse", "HEAD")).trim(),
      checkpoint.originalHead,
      "source HEAD is unchanged",
    );
    assert.equal(
      await git("diff", "--cached"),
      checkpoint.originalIndex,
      "user's staged content is preserved",
    );
    assert.equal(
      await git("status", "--porcelain"),
      checkpoint.originalStatus,
      "user's staged and unstaged status is preserved",
    );
  }
  async function startImplementation() {
    await workspace.refresh();
    const previous = workspace.state.specs.specs.find(
      (spec) => spec.id === "system",
    );
    const content: SpecContent = {
      title: "공유 권한 복구 검증",
      purpose: "설치본의 작업 저장·복구 확인",
      desired: "viewer는 조회만 가능. owner와 editor는 편집을 유지한다.",
      policies: "수정 API는 viewer와 다른 프로젝트 멤버에게 403을 반환한다.",
      inputsOutputs: "project, userId, title",
      failures: "거절 시 원본 데이터 유지",
      invariants: ["owner/editor 편집 유지", "viewer 조회 허용"],
      acceptance: [
        "viewer 수정 요청 403 및 데이터 보존",
        "읽기 전용 UI 표시",
        "다른 프로젝트의 역할로 수정 불가",
      ],
    };
    await dispatch("implement", {
      targetIds: ["system"],
      content,
      expectedRevision: previous?.revision ?? 0,
      checks: ["test"],
      allowExternal: true,
    });
    await waitFor(
      () =>
        workspace.state.job?.phase === "approval" ||
        workspace.state.job?.phase === "failed",
      "controlled file approval",
    );
    assert.equal(
      workspace.state.job?.phase,
      "approval",
      workspace.state.job?.message,
    );
    const approval = workspace.state.job!.approvals[0];
    assert.equal(approval.id, "fixture-file-approval");
    assert.equal(approval.kind, "file");
    assert.match(approval.reason!, /CONTROLLED TEST/);
    await dispatch("decideJob", {
      jobId: workspace.state.job!.id,
      id: approval.id,
      decision: "accept",
    });
    await waitFor(
      () =>
        ["review", "failed", "cancelled"].includes(
          workspace.state.job?.phase ?? "",
        ),
      "independent checks and review",
    );
    const job = workspace.state.job!;
    assert.equal(job.phase, "review", job.message);
    assert.deepEqual(
      job.files.map((file) => file.path),
      ["policy.js", "service.js", "ui.js"],
    );
    assert.equal(job.checks.length, 1);
    assert.equal(job.checks[0].status, "passed", job.checks[0].output);
    assert.equal(job.checks[0].exitCode, 0);
    assert.match(job.checks[0].output, /viewer reads|viewer controls/);
    assert.equal(
      digest(await readFile(resolve(job.worktree!, "test.js"))),
      checkpoint.originalHashes["test.js"],
    );
    await waitFor(async () => {
      await dispatch("jobHistory");
      return (
        workspace.state.jobHistory?.some(
          (entry) => entry.id === job.id && entry.phase === "review",
        ) ?? false
      );
    }, "review persisted before host exit");
    checks.push(
      "explicit file approval reaches the peer",
      "real package-manager checks pass",
      "three-file review is durable",
      "acceptance tests are unchanged",
    );
    return { id: job.id, reviewId: job.reviewId!, worktree: job.worktree! };
  }

  if (phase === "prepare-review") {
    assert.equal(workspace.state.jobHistory?.length, 0);
    checkpoint.firstJob = await startImplementation();
    await assertOriginal();
    checks.push("implementation does not modify the original source or index");
  } else if (phase === "review-and-apply") {
    const job = checkpoint.firstJob!;
    assert.ok(workspace.state.jobHistory?.some((entry) => entry.id === job.id));
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "review");
    await dispatch("jobDiff", { reviewId: job.reviewId, index: 0 });
    assert.ok(
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => {
          const input = tab.input;
          return (
            input instanceof vscode.TabInputTextDiff &&
            input.modified.scheme === "pureobom-design-diff"
          );
        }),
      ),
      "review uses VS Code's real diff editor",
    );
    const designPath = resolve(source, ".pureobom/specs.json"),
      originalDesign = await readFile(designPath, "utf8");
    const changedDesign = JSON.parse(originalDesign);
    changedDesign.specs[0].content.desired +=
      " changed without increasing revision";
    await writeFile(designPath, JSON.stringify(changedDesign));
    await assert.rejects(
      dispatch("applyJob", { reviewId: job.reviewId }),
      /설계가 바뀌었/,
    );
    await assertOriginal();
    await writeFile(designPath, originalDesign);
    const uri = vscode.Uri.file(resolve(source, "ui.js"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), "// unsaved user edit\n");
    assert.ok(await vscode.workspace.applyEdit(edit));
    await assert.rejects(
      dispatch("applyJob", { reviewId: job.reviewId }),
      /저장한 뒤/,
    );
    await vscode.commands.executeCommand("workbench.action.files.revert");
    assert.equal(doc.isDirty, false);
    await dispatch("applyJob", { reviewId: job.reviewId });
    assert.equal(workspace.state.job?.phase, "applied");
    const verified = await exec(
      process.env.PUREOBOM_FIXTURE_NODE!,
      ["--test", "test.js"],
      { cwd: source, windowsHide: true },
    );
    assert.match(verified.stdout, /viewer reads|viewer controls/);
    checks.push(
      "review restored after VS Code restart",
      "native diff opened",
      "same-revision manual design changes block apply",
      "dirty editor blocks apply",
      "original project passes the acceptance tests after apply",
    );
  } else if (phase === "undo-after-restart") {
    const job = checkpoint.firstJob!;
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "applied");
    const path = resolve(source, "service.js"),
      applied = await readFile(path, "utf8");
    await writeFile(path, applied + "\n// subsequent user edit\n");
    await assert.rejects(
      dispatch("undoJob", { reviewId: job.reviewId }),
      /파일이 바뀌어/,
    );
    assert.equal(
      await readFile(path, "utf8"),
      applied + "\n// subsequent user edit\n",
    );
    await writeFile(path, applied);
    await dispatch("restoreJob", { workspaceId: job.id });
    await dispatch("undoJob", { reviewId: job.reviewId });
    assert.equal(workspace.state.job?.phase, "undone");
    await assertOriginal();
    checks.push(
      "applied record survives another restart",
      "undo preserves subsequent user edits",
      "undo restores exact original bytes and staged/unstaged status",
    );
    checkpoint.crashJob = await startImplementation();
  } else if (phase === "crash-during-apply") {
    const job = checkpoint.crashJob!;
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "review");
    const journalPath = resolve(dirname(job.worktree), "apply.json");
    const watcher = watch(source, (_event, name) => {
      if (name !== "policy.js" || workspace.state.job?.phase !== "applying")
        return;
      try {
        const journal = JSON.parse(readFileSync(journalPath, "utf8"));
        if (journal.state !== "applying") return;
        const states = journal.review.files.map(
          (file: { path: string; beforeHash: string; afterHash: string }) => {
            const hash = digest(readFileSync(resolve(source, file.path)));
            return hash === file.afterHash
              ? "after"
              : hash === file.beforeHash
                ? "before"
                : "conflict";
          },
        );
        if (!states.includes("after")) return;
        assert.ok(!states.includes("conflict"));
        checkpoint.crash = {
          journalState: journal.state,
          afterFiles: states.filter((s: string) => s === "after").length,
          beforeFiles: states.filter((s: string) => s === "before").length,
          progressEntries: journal.written.length,
          termination:
            "SIGKILL of this test extension-host process during apply",
        };
        checkpoint.phases.push({
          phase,
          extensionHostPid: process.pid,
          checkedAt: new Date().toISOString(),
          checks: [
            ...checks,
            "product apply journal exists",
            "at least one original file changed",
            "test extension host terminated while transaction is incomplete",
          ],
        });
        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
        process.kill(process.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
    try {
      await dispatch("applyJob", { reviewId: job.reviewId });
    } finally {
      watcher.close();
    }
    throw Error(
      "Application finished before the intended interruption; this run does not prove crash recovery.",
    );
  } else if (phase === "recover-after-crash") {
    const job = checkpoint.crashJob!;
    assert.ok(checkpoint.crash);
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "recovery");
    assert.ok(
      workspace.state.job?.recovery?.some((file) => file.state === "after"),
    );
    assert.ok(
      workspace.state.job?.recovery?.every((file) => file.state !== "conflict"),
    );
    await dispatch("recoverJob", { reviewId: job.reviewId });
    assert.equal(workspace.state.job?.phase, "undone");
    assert.ok(
      workspace.state.job?.recovery?.every((file) => file.state === "before"),
    );
    await assertOriginal();
    checkpoint.recovered = true;
    checks.push(
      "interrupted apply is detected after a fresh VS Code launch",
      "recovery reconciles actual file bytes",
      "recovery restores the original source and preserves the Git index",
    );
  } else throw Error(`Unknown installed test phase: ${phase}`);
  checkpoint.phases.push({
    phase,
    extensionHostPid: process.pid,
    checkedAt: new Date().toISOString(),
    checks,
    verification: workspace.state.job?.checks.map((check) => ({
      name: check.name,
      status: check.status,
      exitCode: check.exitCode,
      outputSha256: digest(check.output),
    })),
  });
  await saveCheckpoint();
  console.log(`INSTALLED RECOVERY PHASE PASSED: ${phase}`);
}
