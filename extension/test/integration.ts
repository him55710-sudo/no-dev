import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";
const reports: string[] = [];
async function until(check: () => boolean, description: string) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 25000) throw Error(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
export async function run() {
  const extension = vscode.extensions.getExtension<{
    controller: Controller;
    openPanel: () => Promise<void>;
  }>("pureobom-local.pureobom");
  assert.ok(extension, "extension installed in development host");
  const api = await extension.activate(),
    c = api.controller;
  const root = vscode.workspace.workspaceFolders![0].uri;
  const uri = vscode.Uri.joinPath(root, "shipping.ts");
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
  });
  await api.openPanel();
  const ready = async () =>
    until(() => !c.state.busy && !!c.state.analysis, "analysis ready");
  await ready();
  assert.equal(c.state.analysis!.functions[0].name, "calculateShipping");
  assert.ok(
    c.state.analysis!.rules.find((r) => r.name === "freeShippingThreshold"),
  );
  reports.push("activation, real webview panel and initial explanation");

  const editor = await vscode.window.showTextDocument(
    doc,
    vscode.ViewColumn.One,
  );
  const start = doc.getText().indexOf("50000");
  await editor.edit((b) =>
    b.replace(
      new vscode.Range(doc.positionAt(start), doc.positionAt(start + 5)),
      "60000",
    ),
  );
  await until(
    () =>
      !c.state.busy &&
      c.state.analysis?.rules.some(
        (r) => r.name === "freeShippingThreshold" && r.value === 60000,
      ) === true,
    "unsaved changes reflected",
  );
  assert.equal(doc.isDirty, true);
  reports.push("unsaved document changes trigger fresh Korean analysis");

  await c.scan();
  await ready();
  const rule = () =>
    c.state.analysis!.rules.find((r) => r.name === "freeShippingThreshold")!;
  const prepared = await c.prepare(c.state.contextId, {
    ruleId: rule().id,
    value: "70000",
  });
  const preview = await c.preview(prepared.id, c.state.contextId);
  const before = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(preview.before),
  );
  const after = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(preview.after),
  );
  assert.ok(before.getText().includes("60000"));
  assert.ok(after.getText().includes("70000"));
  assert.equal(
    doc.getText().includes("70000"),
    false,
    "preview must not mutate source",
  );
  reports.push(
    "native VS Code diff shows correct before/after without mutation",
  );

  const comparison = await c.compare(
    c.state.contextId,
    "calculateShipping",
    [59999, 60000, 70000].map((n) => ({ label: String(n), args: [n] })),
    prepared.id,
  );
  assert.deepEqual(
    comparison.rows.map((r) => r.status),
    ["same", "changed", "same"],
  );
  assert.equal(comparison.rows[1].before.result, 0);
  assert.equal(comparison.rows[1].after?.result, 3000);
  assert.equal(doc.getText().includes("70000"), false);
  reports.push(
    "scenario matrix compares actual pending patch without changing the editor",
  );
  await c.apply(prepared.id, c.state.contextId);
  await ready();
  assert.ok(doc.getText().includes("70000"));
  assert.equal(doc.isDirty, true);
  const disk = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
  assert.ok(disk.includes("50000"), "apply must not save automatically");
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  await vscode.commands.executeCommand("undo");
  await until(() => doc.getText().includes("60000"), "native undo");
  await ready();
  reports.push(
    "apply changes editor only; native undo restores the previous value",
  );

  const oldContext = c.state.contextId;
  const stale = await c.prepare(oldContext, {
    ruleId: rule().id,
    value: "80000",
  });
  const sourceEditor = await vscode.window.showTextDocument(
    doc,
    vscode.ViewColumn.One,
  );
  await sourceEditor.edit((b) =>
    b.insert(new vscode.Position(0, 0), "// changed after preview\n"),
  );
  await assert.rejects(() => c.apply(stale.id, oldContext));
  await assert.rejects(() =>
    c.compare(
      oldContext,
      "calculateShipping",
      [{ label: "1", args: [60000] }],
      stale.id,
    ),
  );
  assert.equal(doc.getText().includes("80000"), false);
  await ready();
  reports.push("stale preview rejected after an intervening editor change");

  await c.scan();
  await ready();
  const imports = c.state.analysis!.imports;
  assert.ok(
    imports.some((i) => i.target?.endsWith("helper.ts")),
    "relative imports linked",
  );
  await assert.rejects(() => c.select("../../outside-workspace.ts"));
  const simulation = await c.simulate(
    c.state.contextId,
    "calculateShipping",
    "[59999]",
  );
  assert.equal(simulation.ok, true);
  assert.equal(simulation.result, 3000);
  reports.push(
    "workspace graph resolves relative imports, restricts navigation and simulates inputs",
  );

  const natural = await c.prepare(c.state.contextId, {
    request: "무료 배송 기준을 90000으로 변경",
  });
  const naturalContext = c.state.contextId;
  const helper = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, "helper.ts"),
  );
  await vscode.window.showTextDocument(helper, vscode.ViewColumn.One);
  await until(
    () =>
      !c.state.busy && c.state.analysis?.path.endsWith("helper.ts") === true,
    "switch editor",
  );
  await assert.rejects(() => c.apply(natural.id, naturalContext));
  assert.equal(doc.getText().includes("90000"), false);
  reports.push(
    "natural-language change prepared; switching files invalidates it",
  );

  await c.setDocument(doc);
  await ready();
  await c.source(c.state.contextId, 3);
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 2);
  reports.push("explanation source link selects the correct editor line");
  const report = {
    vscode: vscode.version,
    checks: reports,
    passed: reports.length,
    timestamp: new Date().toISOString(),
  };
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, "..", "extension-integration.json"),
    Buffer.from(JSON.stringify(report, null, 2)),
  );
  console.log("PUREOBOM INTEGRATION PASSED", JSON.stringify(report));
  // Close dirty documents without touching the on-disk fixtures.
  await vscode.commands.executeCommand(
    "workbench.action.revertAndCloseActiveEditor",
  );
  c.dispose();
}
