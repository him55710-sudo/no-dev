import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DesignWorkspace } from "../src/designWorkspace";
import type { SpecContent } from "../../src/workspace/spec";
import type { Feature } from "../../src/workspace/features";
import { draftMatches, type DesignDraft } from "../../src/workspace/drafts";
import { approvalMatches } from "../../src/workspace/execution";
import { observeNativeDesignStartup } from "./nativeDesignStartup";
const exec = promisify(execFile);
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const phase = process.env.PUREOBOM_RECOVERY_PHASE!;
const checkpointPath = process.env.PUREOBOM_RECOVERY_CHECKPOINT!;
type Checkpoint = {
  featureId?: string;
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
    nativeWebviewStartup?: Awaited<ReturnType<typeof observeNativeDesignStartup>>;
  }[];
  firstJob?: { id: string; reviewId: string; worktree: string };
  pendingApproval?: { jobId: string; approvalId: string };
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
  // VS Code appends installation metadata; the shipped manifest must remain intact.
  const { __metadata: installationMetadata, ...installedManifest } = JSON.parse(
    await readFile(resolve(extension.extensionPath, "package.json"), "utf8"),
  );
  assert.equal(installationMetadata.source, "vsix");
  assert.deepEqual(installedManifest, expected.manifest);
  for (const [path, hash] of Object.entries(expected.files))
    assert.equal(
      digest(await readFile(resolve(extension.extensionPath, path))),
      hash,
      `installed artifact bytes: ${path}`,
    );
  const { designWorkspace: workspace, runtimeMode } =
    await extension.activate();
  assert.equal(runtimeMode, vscode.ExtensionMode.Production);
  const nativeWebviewStartup = phase === "prepare-review"
    ? await observeNativeDesignStartup(workspace)
    : undefined;
  if (!nativeWebviewStartup)
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
  if (nativeWebviewStartup)
    checks.push("unmodified native Webview boots, exchanges graph/navigation state, and reopens without implementation");
  if (phase !== "prepare-review") {
    const feature = workspace.state.specs.features?.find(
      (item) => item.id === checkpoint.featureId,
    );
    assert.equal(
      feature?.members.length,
      3,
      "business feature persists across separate VS Code launches",
    );
    checks.push("business feature persists after restart");
  }
  const dispatch = (action: string, payload?: unknown) =>
    workspace.handleRequest({ id: `test-${phase}`, action, payload });
  if (phase === "prepare-review") {
    const beforeGuide = JSON.stringify(workspace.state.specs);
    await vscode.commands.executeCommand("pureobom.getStarted");
    await waitFor(
      () => !!vscode.window.tabGroups.activeTabGroup.activeTab &&
        vscode.window.tabGroups.activeTabGroup.activeTab.label !== "풀어봄 · 시스템 설계",
      "walkthrough editor tab",
      10000,
    );
    const guideTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(guideTab, "walkthrough command opens an editor tab");
    assert.notEqual(guideTab.label, "풀어봄 · 시스템 설계", "the command leaves the design tab for the walkthrough");
    assert.equal(workspace.state.job, undefined);
    assert.equal(JSON.stringify(workspace.state.specs), beforeGuide);
    checks.push(`bundled walkthrough command opens editor (${guideTab.label}) without starting a job or changing designs`);
    await vscode.commands.executeCommand("pureobom.openWorkspace");
    const context = workspace.state.execution!.context;
    const before = JSON.stringify(workspace.state.specs);
    const connections = await Promise.allSettled([
      dispatch("checkConnection", context),
      dispatch("checkConnection", context),
    ]);
    assert.equal(
      connections.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      connections.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(workspace.state.connection?.status, "ready");
    assert.match(workspace.state.connection!.provider!, /deterministic/);
    assert.equal(workspace.state.job, undefined);
    assert.equal(JSON.stringify(workspace.state.specs), before);
    await dispatch("saveExecution", {
      context,
      checks: ["test"],
      allowExternal: true,
      expectedRevision: 0,
    });
    assert.equal(workspace.state.execution!.profile.revision, 1);
    checks.push(
      "connection check uses the real stdio adapter without starting an implementation or changing design",
      "overlapping connection requests start only one peer",
      "project execution approval is saved in local extension storage",
    );
  } else {
    const execution = workspace.state.execution!;
    assert.equal(execution.profile.revision, 1);
    assert.ok(approvalMatches(execution.profile, execution.context));
    assert.deepEqual(execution.profile.approval!.checks, ["test"]);
    assert.equal(
      workspace.state.connection,
      undefined,
      "login status is never persisted as a future guarantee",
    );
    checks.push(
      "project execution settings survive an independent installed extension launch",
    );
  }
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
  async function stableAnalysis() {
    await workspace.refresh();
    // File watchers can invalidate an explicit refresh while undo events arrive.
    // Match the UI's enabled state and let the 700ms analysis debounce settle.
    let readySince = 0;
    await waitFor(() => {
      if (
        workspace.state.busy ||
        workspace.state.stale ||
        !workspace.state.graph
      ) {
        readySince = 0;
        return false;
      }
      readySince ||= Date.now();
      return Date.now() - readySince >= 1000;
    }, "stable analysis before the next user implementation action");
  }
  async function acceptCurrentBaseline() {
    await stableAnalysis();
    const before = workspace.state.specs.specs.find(
      (spec) => spec.id === `feature:${checkpoint.featureId}`,
    )!;
    const currentJob = workspace.state.job!.id;
    const accepted = (await dispatch("acceptBaseline", {
      specId: before.id,
      expectedRevision: before.revision,
      expectedGraphRevision: workspace.state.graph!.revision,
      targetIds: before.targetIds,
    })) as typeof before;
    assert.equal(accepted.revision, before.revision + 1);
    assert.deepEqual(accepted.content, before.content);
    assert.deepEqual(
      accepted.baselineHistory!.at(-1)!.baseline,
      before.baseline,
    );
    assert.equal(
      workspace.state.job!.id,
      currentJob,
      "accepting evidence never starts another agent",
    );
    checks.push(
      "explicit baseline acceptance preserves intent and previous evidence without starting an agent",
    );
  }
  async function startImplementation(resume = false, leavePending = false) {
    if (!resume) {
      await stableAnalysis();
      const previous = workspace.state.specs.specs.find(
        (spec) => spec.id === `feature:${checkpoint.featureId}`,
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
        targetIds: [`feature:${checkpoint.featureId}`],
        content,
        expectedRevision: previous?.revision ?? 0,
        execution: {
          context: workspace.state.execution!.context,
          checks: ["test"],
          allowExternal: true,
          profileRevision: workspace.state.execution!.profile.revision,
          useSaved: true,
        },
      });
    }
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
    if (leavePending) {
      const job = workspace.state.job!;
      checkpoint.pendingApproval = { jobId: job.id, approvalId: approval.id };
      checks.push(
        "window exits with a live unapproved request; no approval is synthesized",
      );
      return { id: job.id, reviewId: "", worktree: job.worktree! };
    }
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
    assert.ok(job.assessment);
    assert.equal(
      job.reviewDecision,
      undefined,
      "passed checks must not manufacture criterion evidence",
    );
    await assert.rejects(
      dispatch("applyJob", { reviewId: job.reviewId }),
      /검토 기록/,
    );
    const reviewDecision = {
      jobId: job.id,
      reviewId: job.reviewId,
      approvedScopePaths: job.assessment.files
        .filter((file) => file.outsideScope)
        .map((file) => file.path),
      reviewedVerificationPaths: job.assessment.files
        .filter((file) => file.verification)
        .map((file) => file.path),
      acceptUnverified: false,
      criteria: job.assessment.criteria.map((item) => ({
        id: item.id,
        outcome: "unverified",
        note: "",
        checkNames: [],
      })),
    };
    await dispatch("reviewJob", reviewDecision);
    await assert.rejects(
      dispatch("applyJob", { reviewId: job.reviewId }),
      /아직 확인/,
    );
    await dispatch("reviewJob", { ...reviewDecision, acceptUnverified: true });
    checks.push(
      "passing checks do not auto-confirm criteria; explicit review preserves unverified criteria",
    );
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
    const members = workspace.state
      .graph!.nodes.filter(
        (node) =>
          node.kind === "file" &&
          ["policy.js", "service.js", "ui.js"].includes(node.sources[0]?.path),
      )
      .map((node) => node.id);
    assert.equal(members.length, 3);
    const feature = (await dispatch("saveFeature", {
      title: "프로젝트 공유",
      description: "권한·수정 API·화면을 함께 변경",
      memberIds: members,
      expectedRevision: 0,
      expectedGraphRevision: workspace.state.graph!.revision,
    })) as Feature;
    checkpoint.featureId = feature.id;
    assert.equal(
      workspace.state.job,
      undefined,
      "grouping never starts an agent",
    );
    checks.push(
      "implementation begins from a saved cross-file business feature",
    );
    checkpoint.firstJob = await startImplementation(false, true);
    const base = workspace.state.specs.specs.find(
      (spec) => spec.id === `feature:${feature.id}`,
    )!;
    const confirmedBefore = JSON.stringify(workspace.state.specs);
    const jobBefore = workspace.state.job!.id;
    await dispatch("saveDraft", {
      projectKey: workspace.state.projectKey,
      base,
      expectedRevision: 0,
      content: {
        ...base.content,
        title: "",
        desired: "재시작 후 검토할 다음 목표",
        acceptance: [""],
      },
    });
    assert.equal(JSON.stringify(workspace.state.specs), confirmedBefore);
    assert.equal(workspace.state.job!.id, jobBefore);
    checks.push(
      "unfinished local draft is durable without changing the confirmed design or starting another agent",
    );
    await assertOriginal();
    checks.push("implementation does not modify the original source or index");
  } else if (phase === "resume-review") {
    assert.equal(workspace.state.job?.id, checkpoint.pendingApproval!.jobId);
    assert.equal(workspace.state.job?.phase, "approval");
    assert.equal(
      workspace.state.job?.approvals[0].id,
      checkpoint.pendingApproval!.approvalId,
    );
    assert.equal(workspace.state.jobHistory?.length, 1);
    checkpoint.firstJob = await startImplementation(true);
    await assertOriginal();
    checks.push(
      "fresh installed extension attaches to the same live job and original approval without starting another turn",
    );
  } else if (phase === "review-and-apply") {
    const restoredDraft = workspace.state.drafts?.find(
      (draft) => draft.base.id === `feature:${checkpoint.featureId}`,
    )!;
    assert.ok(restoredDraft);
    assert.equal(restoredDraft.content.title, "");
    assert.deepEqual(restoredDraft.content.acceptance, [""]);
    assert.equal(restoredDraft.content.desired, "재시작 후 검토할 다음 목표");
    if (workspace.state.job) {
      assert.equal(workspace.state.job.id, checkpoint.firstJob!.id);
      assert.equal(workspace.state.job.phase, "review");
    }
    checks.push(
      "unfinished draft restores after a fresh VS Code launch without auto-confirmation or execution",
    );
    const job = checkpoint.firstJob!;
    assert.ok(workspace.state.jobHistory?.some((entry) => entry.id === job.id));
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "review");
    assert.equal(workspace.state.job?.reviewDecision?.acceptUnverified, true);
    assert.ok(
      workspace.state.job?.reviewDecision?.criteria.every(
        (item) => item.outcome === "unverified",
      ),
    );
    checks.push(
      "saved review decisions restore with their exact proposal after restart without claiming criterion completion",
    );
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
    const feature = workspace.state.specs.features!.find(
      (item) => item.id === checkpoint.featureId,
    )!;
    const editFeature = (memberIds: string[]) =>
      dispatch("saveFeature", {
        id: feature.id,
        title: feature.title,
        description: feature.description,
        memberIds,
        expectedRevision: workspace.state.specs.features!.find(
          (item) => item.id === feature.id,
        )!.revision,
        expectedGraphRevision: workspace.state.graph!.revision,
      });
    await editFeature(
      feature.members.slice(0, 2).map((member) => member.nodeId),
    );
    await assert.rejects(
      dispatch("applyJob", { reviewId: job.reviewId }),
      /다시 검토/,
    );
    await assertOriginal();
    await editFeature(feature.members.map((member) => member.nodeId));
    checks.push(
      "changing feature membership blocks an old implementation review",
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
    assert.equal(
      workspace.state.specs.specs[0].baselineHistory,
      undefined,
      "apply does not automatically accept new code as the design baseline",
    );
    await acceptCurrentBaseline();
    checks.push(
      "review restored after VS Code restart",
      "native diff opened",
      "same-revision manual design changes block apply",
      "dirty editor blocks apply",
      "original project passes the acceptance tests after apply",
    );
  } else if (phase === "undo-after-restart") {
    const restoredDraft = workspace.state.drafts?.find(
      (draft) => draft.base.id === `feature:${checkpoint.featureId}`,
    ) as DesignDraft;
    assert.ok(restoredDraft);
    assert.equal(restoredDraft.content.desired, "재시작 후 검토할 다음 목표");
    const confirmed = workspace.state.specs.specs.find(
      (spec) => spec.id === restoredDraft.base.id,
    )!;
    assert.equal(
      draftMatches(restoredDraft, confirmed),
      false,
      "the original draft context survives a later baseline acceptance",
    );
    await dispatch("removeDraft", {
      projectKey: workspace.state.projectKey,
      specId: restoredDraft.base.id,
      expectedRevision: restoredDraft.revision,
    });
    assert.deepEqual(workspace.state.drafts, []);
    assert.deepEqual(
      workspace.state.specs.specs.find((spec) => spec.id === confirmed.id),
      confirmed,
    );
    checks.push(
      "draft keeps its original context across baseline changes and explicit discard preserves confirmed design",
    );
    const job = checkpoint.firstJob!;
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "applied");
    assert.equal(
      workspace.state.specs.specs[0].baselineHistory?.length,
      1,
      "accepted baseline survives a fresh VS Code launch",
    );
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
    await acceptCurrentBaseline();
    checkpoint.crashJob = await startImplementation();
    checks.push("next implementation uses the explicitly accepted baseline");
  } else if (phase === "crash-during-apply") {
    const job = checkpoint.crashJob!;
    await dispatch("restoreJob", { workspaceId: job.id });
    assert.equal(workspace.state.job?.phase, "review");
    const journalPath = resolve(
      process.env.PUREOBOM_JOB_STORAGE!,
      job.id,
      "apply.json",
    );
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
  } else if (phase === "continue-after-crash") {
    const job = checkpoint.crashJob!;
    assert.ok(checkpoint.crash);
    await dispatch("restoreJob", { workspaceId: job.id });
    await waitFor(
      () => workspace.state.job?.phase === "applied",
      "managed transaction finishes after UI host exit",
    );
    assert.ok(
      workspace.state.job?.recovery?.some((file) => file.state === "after"),
    );
    assert.ok(
      workspace.state.job?.recovery?.every((file) => file.state !== "conflict"),
    );
    await dispatch("undoJob", { reviewId: job.reviewId });
    assert.equal(workspace.state.job?.phase, "undone");
    assert.ok(
      workspace.state.job?.recovery?.every((file) => file.state === "before"),
    );
    await assertOriginal();
    checkpoint.recovered = true;
    checks.push(
      "managed apply completes despite the extension-host exit",
      "newly attached window reconciles actual file bytes",
      "explicit undo restores the original source and preserves the Git index",
    );
  } else throw Error(`Unknown installed test phase: ${phase}`);
  checkpoint.phases.push({
    phase,
    extensionHostPid: process.pid,
    checkedAt: new Date().toISOString(),
    checks,
    nativeWebviewStartup,
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
