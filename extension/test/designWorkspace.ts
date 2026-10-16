import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { DesignWorkspace } from "../src/designWorkspace";
import type { Feature } from "../../src/workspace/features";
import { observeSpec } from "../../src/workspace/spec";
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
  const saved = await workspace.save({
    targetIds: targets,
    content,
    expectedRevision: 0,
  });
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
      checks: ["test"],
      allowExternal: false,
    }),
  );
  assert.equal(
    workspace.state.job,
    undefined,
    "external execution requires the explicit implementation action and data choice",
  );
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
      checks: ["test"],
      allowExternal: true,
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
      "durable design save",
      "stale design rejected",
      "unsaved source invalidation",
      "observed drift preserves intent",
      "restored source reconnects",
      "project verification script discovery",
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
