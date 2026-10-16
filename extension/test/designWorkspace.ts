import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DesignWorkspace } from "../src/designWorkspace";
import { observeSpec } from "../../src/workspace/spec";

export async function run() {
  const extension = vscode.extensions.getExtension<{
    designWorkspace: DesignWorkspace;
  }>("pureobom-local.pureobom")!;
  const api = await extension.activate();
  const workspace = api.designWorkspace;
  await workspace.open();
  const graph = workspace.state.graph!;
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
  console.log(
    "PUREOBOM DESIGN WORKSPACE PASSED",
    JSON.stringify({
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
      ],
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    }),
  );
}
