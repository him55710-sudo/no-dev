import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { DesignWorkspace } from "../src/designWorkspace";
import type { Feature } from "../../src/workspace/features";
import { observeSpec, draftSpec } from "../../src/workspace/spec";
import type { DesignDraft } from "../../src/workspace/drafts";
import { approvalMatches } from "../../src/workspace/execution";
import { initialNavigation } from "../../src/workspace/navigation";
import { readFile, writeFile, rename } from "node:fs/promises";

export async function run() {
  const extension = vscode.extensions.getExtension<{
    designWorkspace: DesignWorkspace;
  }>("pureobom-local.pureobom")!;
  const api = await extension.activate();
  const workspace = api.designWorkspace;
  await workspace.open();
  const graph = workspace.state.graph!;
  assert.deepEqual(workspace.state.checks?.slice().sort(), [
    "build",
    "test",
    "typecheck",
  ]);
  assert.ok(graph.nodes.length > 15);
  const policy = graph.nodes.find(
    (node) => node.kind === "symbol" && node.label === "canEdit",
  )!;
  assert.equal(
    graph.edges.filter(
      (edge) => edge.target === policy.id && edge.kind === "calls",
    ).length,
    2,
  );
  await workspace.source(policy.id);
  const editor = vscode.window.activeTextEditor!;
  assert.ok(
    editor.document.getText(editor.selection).includes("function canEdit"),
  );
  await workspace.open(true);
  assert.equal(workspace.state.selectedId, policy.id);
  const navigationGeneration = workspace.state.navigation!.generation;
  await workspace.handleRequest({
    id: "navigate",
    action: "saveNavigation",
    payload: {
      projectKey: workspace.state.projectKey,
      generation: navigationGeneration,
      view: { ...initialNavigation(), search: "공유 탐색" },
    },
  });
  assert.equal(workspace.state.navigation!.view.search, "공유 탐색");
  assert.equal(workspace.state.job, undefined);
  await assert.rejects(
    workspace.handleRequest({
      id: "wrong-project-navigation",
      action: "saveNavigation",
      payload: {
        projectKey: "0".repeat(64),
        generation: navigationGeneration,
        view: initialNavigation(),
      },
    }),
    /프로젝트/,
  );
  await workspace.open(true);
  assert.equal(workspace.state.selectedId, policy.id);
  await workspace.handleRequest({
    id: "late-navigation",
    action: "saveNavigation",
    payload: {
      projectKey: workspace.state.projectKey,
      generation: navigationGeneration,
      view: initialNavigation(),
    },
  });
  assert.equal(
    workspace.state.selectedId,
    policy.id,
    "late UI preference writes cannot override explicit source navigation",
  );
  const targets = [policy.id];
  const content = {
    title: "공유 권한",
    purpose: "프로젝트 멤버 권한 관리",
    desired: "viewer는 조회만 가능",
    policies: "owner/editor 편집 유지",
    inputsOutputs: "projectId, userId, title",
    failures: "권한 없는 수정 요청 거절",
    invariants: ["owner 편집 유지"],
    acceptance: ["viewer API 요청 거절"],
  };
  const draftBase = draftSpec(graph, targets);
  const localDraft = (await workspace.handleRequest({
    id: "draft-empty",
    action: "saveDraft",
    payload: {
      projectKey: workspace.state.projectKey,
      base: draftBase,
      content: { ...content, title: "", acceptance: [""] },
      expectedRevision: 0,
    },
  })) as DesignDraft;
  assert.equal(workspace.state.specs.specs.length, 0);
  assert.equal(workspace.state.job, undefined);
  await workspace.open();
  assert.deepEqual(workspace.state.drafts, [localDraft]);
  const completedDraft = (await workspace.handleRequest({
    id: "draft-complete",
    action: "saveDraft",
    payload: {
      projectKey: workspace.state.projectKey,
      base: draftBase,
      content,
      expectedRevision: localDraft.revision,
    },
  })) as DesignDraft;
  const saved = await workspace.save({
    targetIds: targets,
    content,
    expectedRevision: 0,
    projectKey: workspace.state.projectKey,
    draftRevision: completedDraft.revision,
  });
  assert.deepEqual(workspace.state.drafts, []);
  assert.equal(saved.revision, 1);
  assert.equal(
    workspace.state.job,
    undefined,
    "saving documentation never starts an agent",
  );
  await assert.rejects(
    workspace.implement({
      targetIds: targets,
      content,
      expectedRevision: 1,
      execution: {
        context: workspace.state.execution!.context,
        checks: ["test"],
        allowExternal: false,
        profileRevision: workspace.state.execution!.profile.revision,
      },
    }),
  );
  assert.equal(
    workspace.state.job,
    undefined,
    "external execution requires the explicit implementation action and data choice",
  );
  const execution = workspace.state.execution!;
  const useExecution = {
    context: execution.context,
    checks: ["test"],
    allowExternal: true,
    profileRevision: 1,
    useSaved: true,
  };
  const implementPayload = {
    targetIds: targets,
    content,
    expectedRevision: saved.revision,
    execution: useExecution,
  };
  await workspace.handleRequest({
    id: "execution-save",
    action: "saveExecution",
    payload: {
      context: execution.context,
      checks: ["test"],
      allowExternal: true,
      expectedRevision: 0,
    },
  });
  assert.equal(workspace.state.execution!.profile.revision, 1);
  const manifestPath = vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders![0].uri,
    "package.json",
  ).fsPath;
  const manifest = await readFile(manifestPath, "utf8");
  const changedManifest = JSON.parse(manifest);
  changedManifest.scripts.test = "node changed-test.js";
  await writeFile(manifestPath, JSON.stringify(changedManifest));
  await workspace.refresh();
  assert.equal(
    approvalMatches(
      workspace.state.execution!.profile,
      workspace.state.execution!.context,
    ),
    false,
  );
  await assert.rejects(
    workspace.implement(implementPayload),
    /검사 명령이 바뀌었/,
  );
  assert.equal(
    workspace.state.specs.specs[0].revision,
    saved.revision,
    "stale command refusal precedes design save",
  );
  assert.equal(workspace.state.job, undefined);
  await writeFile(manifestPath, manifest);
  await workspace.refresh();
  await workspace.handleRequest({
    id: "execution-revoke",
    action: "revokeExecution",
    payload: { projectKey: execution.context.projectKey, expectedRevision: 1 },
  });
  await assert.rejects(workspace.implement(implementPayload), /다른 창/);
  assert.equal(workspace.state.job, undefined);
  await settled();
  const designUri = vscode.Uri.joinPath(
    vscode.workspace.workspaceFolders![0].uri,
    ".pureobom/specs.json",
  );
  const disk = JSON.parse(
    Buffer.from(await vscode.workspace.fs.readFile(designUri)).toString("utf8"),
  );
  assert.equal(disk.specs[0].content.desired, content.desired);
  await assert.rejects(
    workspace.save({
      targetIds: targets,
      content: { ...content, desired: "stale" },
      expectedRevision: 0,
    }),
    /다른 편집/,
  );
  const file = editor.document;
  const original = file.getText();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    file.uri,
    new vscode.Range(file.positionAt(0), file.positionAt(original.length)),
    original.replace("return role !== undefined;", "return true;"),
  );
  await vscode.workspace.applyEdit(edit);
  await assert.rejects(
    workspace.implement({
      targetIds: targets,
      content,
      expectedRevision: 1,
      execution: {
        context: workspace.state.execution!.context,
        checks: ["test"],
        allowExternal: true,
      },
    }),
    /저장한 뒤/,
  );
  await assert.rejects(workspace.source(policy.id), /갱신|바뀌었/);
  await workspace.refresh();
  assert.equal(workspace.state.specs.specs[0].content.desired, content.desired);
  // The modified canRead is outside canEdit's source; confirmed intent still remains.
  assert.equal(observeSpec(saved, workspace.state.graph!).status, "unchanged");
  const edit2 = new vscode.WorkspaceEdit();
  const text = file.getText();
  edit2.replace(
    file.uri,
    new vscode.Range(file.positionAt(0), file.positionAt(text.length)),
    text.replace("return role !== undefined;", 'return role === "owner";'),
  );
  await vscode.workspace.applyEdit(edit2);
  await workspace.refresh();
  assert.equal(observeSpec(saved, workspace.state.graph!).status, "changed");
  assert.equal(workspace.state.specs.specs[0].content.desired, content.desired);
  const restore = new vscode.WorkspaceEdit();
  restore.replace(
    file.uri,
    new vscode.Range(
      file.positionAt(0),
      file.positionAt(file.getText().length),
    ),
    original,
  );
  await vscode.workspace.applyEdit(restore);
  await workspace.refresh();
  assert.equal(observeSpec(saved, workspace.state.graph!).status, "unchanged");
  // Rename the linked declaration after saving, then explicitly reconnect it.
  const renamed = new vscode.WorkspaceEdit();
  renamed.replace(
    file.uri,
    new vscode.Range(
      file.positionAt(0),
      file.positionAt(file.getText().length),
    ),
    original.replace("function canEdit(", "function mayEdit("),
  );
  await vscode.workspace.applyEdit(renamed);
  await assert.rejects(
    workspace.handleRequest({
      id: "dirty-baseline",
      action: "acceptBaseline",
      payload: {
        specId: saved.id,
        expectedRevision: 1,
        expectedGraphRevision: workspace.state.graph!.revision,
        targetIds: targets,
      },
    }),
    /저장한 뒤/,
  );
  await file.save();
  await workspace.refresh();
  async function settled() {
    let readySince = 0;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (workspace.state.busy || workspace.state.stale) readySince = 0;
      else readySince ||= Date.now();
      if (readySince && Date.now() - readySince > 1000) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Analysis did not settle");
  }
  await settled();
  const renamedGraph = workspace.state.graph!;
  const replacement = renamedGraph.nodes.find(
    (node) => node.label === "mayEdit" && node.kind === "symbol",
  )!;
  assert.ok(replacement);
  assert.equal(observeSpec(saved, renamedGraph).status, "reconnect");
  const reconnect = {
    specId: saved.id,
    expectedRevision: 1,
    expectedGraphRevision: renamedGraph.revision,
    targetIds: [replacement.id],
  };
  await assert.rejects(
    workspace.handleRequest({
      id: "stale-preview",
      action: "acceptBaseline",
      payload: { ...reconnect, expectedGraphRevision: graph.revision },
    }),
    /코드가 바뀌었/,
  );
  const reconnected = (await workspace.handleRequest({
    id: "reconnect",
    action: "acceptBaseline",
    payload: reconnect,
  })) as typeof saved;
  assert.equal(reconnected.id, saved.id);
  assert.equal(reconnected.revision, 2);
  assert.deepEqual(reconnected.content, saved.content);
  assert.deepEqual(reconnected.targetIds, [replacement.id]);
  assert.deepEqual(reconnected.baselineHistory![0].baseline, saved.baseline);
  assert.equal(
    observeSpec(reconnected, workspace.state.graph!).status,
    "unchanged",
  );
  assert.equal(
    workspace.state.job,
    undefined,
    "baseline acceptance never starts the agent",
  );
  await assert.rejects(
    workspace.handleRequest({
      id: "stale-spec",
      action: "acceptBaseline",
      payload: reconnect,
    }),
    /설계가 바뀌었/,
  );
  const afterEdit = await workspace.save({
    specId: saved.id,
    targetIds: [replacement.id],
    content: { ...content, title: "다시 연결한 공유 권한" },
    expectedRevision: 2,
  });
  assert.equal(afterEdit.revision, 3);
  const persisted = JSON.parse(await readFile(designUri.fsPath, "utf8"))
    .specs[0];
  assert.equal(persisted.id, saved.id);
  assert.deepEqual(persisted.baselineHistory, reconnected.baselineHistory);
  const editing = (await workspace.handleRequest({
    id: "draft-conflict",
    action: "saveDraft",
    payload: {
      projectKey: workspace.state.projectKey,
      base: afterEdit,
      content: { ...content, desired: "보관된 다음 목표" },
      expectedRevision: 0,
    },
  })) as DesignDraft;
  const concurrent = await workspace.save({
    specId: afterEdit.id,
    targetIds: afterEdit.targetIds,
    content: { ...afterEdit.content, purpose: "동시에 확정한 설계" },
    expectedRevision: afterEdit.revision,
  });
  await assert.rejects(
    workspace.save({
      specId: afterEdit.id,
      targetIds: afterEdit.targetIds,
      content: editing.content,
      expectedRevision: afterEdit.revision,
      draftRevision: editing.revision,
      projectKey: workspace.state.projectKey,
    }),
    /비교/,
  );
  const rebasedDraft = (await workspace.handleRequest({
    id: "draft-rebase",
    action: "rebaseDraft",
    payload: {
      projectKey: workspace.state.projectKey,
      specId: afterEdit.id,
      expectedRevision: editing.revision,
      expectedGraphRevision: workspace.state.graph!.revision,
      expectedDesign: concurrent,
    },
  })) as DesignDraft;
  assert.equal(rebasedDraft.content.desired, "보관된 다음 목표");
  assert.deepEqual(
    workspace.state.specs.specs.find((item) => item.id === afterEdit.id),
    concurrent,
  );
  assert.equal(workspace.state.job, undefined);
  await workspace.save({
    specId: concurrent.id,
    targetIds: concurrent.targetIds,
    content: rebasedDraft.content,
    expectedRevision: concurrent.revision,
    draftRevision: rebasedDraft.revision,
    projectKey: workspace.state.projectKey,
  });
  assert.deepEqual(workspace.state.drafts, []);
  const memberIds = workspace.state
    .graph!.nodes.filter(
      (node) =>
        node.kind === "symbol" &&
        ["mayEdit", "updateProject", "ProjectEditor"].includes(node.label),
    )
    .map((node) => node.id);
  assert.equal(memberIds.length, 3);
  const sourceBeforeGrouping = await readFile(file.uri.fsPath, "utf8");
  const request = {
    title: "프로젝트 공유",
    description: "화면·서비스·권한을 함께 검토",
    memberIds,
    expectedRevision: 0,
    expectedGraphRevision: workspace.state.graph!.revision,
  };
  const feature = (await workspace.handleRequest({
    id: "create-feature",
    action: "saveFeature",
    payload: request,
  })) as Feature;
  assert.equal(feature.revision, 1);
  const featureNode = workspace.state.graph!.nodes.find(
    (node) => node.id === `feature:${feature.id}`,
  )!;
  assert.deepEqual(
    featureNode.members!.slice().sort(),
    memberIds.slice().sort(),
  );
  assert.equal(workspace.state.job, undefined);
  assert.equal(await readFile(file.uri.fsPath, "utf8"), sourceBeforeGrouping);
  await assert.rejects(
    workspace.handleRequest({
      id: "stale-feature",
      action: "saveFeature",
      payload: { ...request, id: feature.id },
    }),
    /바뀌었/,
  );
  const groupedSpec = await workspace.save({
    targetIds: [featureNode.id],
    content,
    expectedRevision: 0,
  });
  const withFeature = JSON.parse(await readFile(designUri.fsPath, "utf8"));
  assert.deepEqual(
    withFeature.features[0],
    feature,
    "saving design preserves feature metadata",
  );
  // Saving the design can still deliver a filesystem watcher notification.
  // Start the deliberate overlapping-refresh case only once that work settles,
  // just as the UI waits until its feature controls are enabled again.
  await settled();
  let overlappingRefresh: Promise<void> | undefined;
  const duringRemoval = workspace.changes.event((state) => {
    if (!state.busy) return;
    duringRemoval.dispose();
    overlappingRefresh = workspace.refresh();
  });
  await workspace.handleRequest({
    id: "remove-feature",
    action: "removeFeature",
    payload: {
      id: feature.id,
      expectedRevision: 1,
      expectedGraphRevision: workspace.state.graph!.revision,
    },
  });
  duringRemoval.dispose();
  assert.ok(
    overlappingRefresh,
    "a second refresh was requested while removal was analyzing",
  );
  assert.equal(
    workspace.state.busy,
    false,
    "feature edit waits for the latest analysis",
  );
  assert.equal(workspace.state.stale, false);
  assert.equal(workspace.state.specs.features!.length, 0);
  assert.equal(
    workspace.state.specs.specs.some((spec) => spec.id === groupedSpec.id),
    true,
  );
  assert.equal(
    observeSpec(groupedSpec, workspace.state.graph!).status,
    "reconnect",
  );
  await overlappingRefresh;
  assert.equal(await readFile(file.uri.fsPath, "utf8"), sourceBeforeGrouping);
  const diskEdit =
    sourceBeforeGrouping.replace(/\r?\n/g, "\r\n") +
    "\n// external atomic replacement\n";
  await writeFile(file.uri.fsPath + ".external.tmp", diskEdit);
  await rename(file.uri.fsPath + ".external.tmp", file.uri.fsPath);
  assert.equal(file.isDirty, false);
  await workspace.refresh();
  await settled();
  assert.equal(
    workspace.state.graph!.files.find(
      (item) => item.path === "features/sharing/policy.ts",
    )!.hash,
    createHash("sha256").update(diskEdit).digest("hex"),
    "clean editor buffers cannot override externally replaced disk bytes",
  );
  const report = {
    checkedAt: new Date().toISOString(),
    checks: [
      "real compiler graph",
      "alias/re-export shared policy",
      "node to exact source",
      "source to node",
      "local navigation preferences do not start an agent and reject cross-project input",
      "late UI navigation writes cannot undo explicit source navigation",
      "durable design save",
      "unfinished draft persists separately without confirming design or starting an agent",
      "explicit design save consumes only its persisted draft revision",
      "changed design blocks stale draft confirmation and explicit comparison preserves input",
      "stale design rejected",
      "unsaved source invalidation",
      "observed drift preserves intent",
      "restored source reconnects",
      "project verification script discovery",
      "changed package script invalidates saved execution settings and blocks implementation before design save",
      "revoked execution settings cannot be reused by a stale UI request",
      "documentation save never starts agent",
      "external data choice required",
      "dirty editor blocks implementation",
      "dirty editor blocks baseline acceptance",
      "stale baseline comparison and stale spec revision are rejected",
      "renamed declaration explicitly reconnects with stable spec identity",
      "baseline history and desired intent survive subsequent document edits",
      "baseline acceptance never starts an agent",
      "cross-folder business feature stores canonical code membership",
      "feature grouping does not change source or start an agent",
      "stale feature edits are rejected",
      "design save preserves feature metadata",
      "feature removal preserves code and marks saved design for reconnection",
      "feature removal waits for an overlapping analysis before acknowledging completion",
      "external atomic replacement is analyzed from disk while the document is open",
    ],
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };
  if (process.env.PUREOBOM_DESIGN_REPORT)
    await writeFile(
      process.env.PUREOBOM_DESIGN_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log("PUREOBOM DESIGN WORKSPACE PASSED", JSON.stringify(report));
}
