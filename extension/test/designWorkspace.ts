import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DesignWorkspace } from "../src/designWorkspace";
import { observeSpec } from "../../src/workspace/spec";
import { readFile, writeFile } from "node:fs/promises";

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
