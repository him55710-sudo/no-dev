import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function pythonSourceChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const doc = await vscode.workspace.openTextDocument({
    language: "python",
    content:
      '# 😀 데이터\r\n이름 = "한글"; limit = 9007199254740993\r\nenabled = False\r\ndef calculate(amount):\r\n    try:\r\n        if amount < 0:\r\n            raise ValueError("negative")\r\n        return amount >= limit\r\n    finally:\r\n        cleanup()\r\n',
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await c.setDocument(doc);
  await ready();
  const source = doc.getText();
  assert.ok(c.state.analysis?.python?.version);
  assert.equal(c.state.analysis!.kind, "script");
  assert.equal(c.state.analysis!.functions[0].name, "calculate");
  assert.equal(c.state.analysis!.functions[0].simulatable, false);
  const rule = c.state.analysis!.rules.find((r) => r.name === "limit")!;
  assert.equal(rule.value, "9007199254740993");
  assert.equal(source.slice(rule.start, rule.end), rule.raw);
  assert.equal(rule.line, 2);
  await c.source(c.state.contextId, rule.line);
  assert.equal(vscode.window.activeTextEditor!.selection.active.line, 1);
  const context = c.state.contextId;
  const patch = await c.prepare(context, {
    request: "change limit to 9007199254740995",
  });
  const preview = await c.preview(patch.id, context);
  const before = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(preview.before),
  );
  const after = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(preview.after),
  );
  assert.equal(after.languageId, "python");
  assert.equal(before.getText(), source);
  assert.equal(doc.getText(), source);
  assert.equal(
    after.getText(),
    source.replace("9007199254740993", "9007199254740995"),
  );
  await c.apply(patch.id, context);
  await ready();
  assert.equal(doc.getText(), after.getText());
  assert.equal(
    c.state.analysis!.rules.find((r) => r.name === "limit")!.value,
    "9007199254740995",
  );
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("undo");
  await c.refresh();
  await ready();
  assert.equal(doc.getText(), source);
  await assert.rejects(c.apply(patch.id, context));
  reports.push(
    "Python AST: actual isolated interpreter, Unicode/CRLF source positions, model-free exact integer edit, native Python diff, explicit apply/reanalysis/undo and used-patch rejection",
  );

  const stale = await c.prepare(c.state.contextId, {
    request: "change enabled to True",
  });
  const oldContext = c.state.contextId;
  const editor = await vscode.window.showTextDocument(
    doc,
    vscode.ViewColumn.One,
  );
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), "# later\n"));
  await c.refresh();
  await ready();
  await assert.rejects(c.apply(stale.id, oldContext));
  await vscode.commands.executeCommand("undo");
  await c.refresh();
  await ready();
  assert.equal(doc.getText(), source);

  const configuration = vscode.workspace.getConfiguration("pureobom");
  const previous = configuration.inspect<string>("analysisPython")?.globalValue;
  try {
    await configuration.update(
      "analysisPython",
      "pureobom-no-such-python",
      vscode.ConfigurationTarget.Global,
    );
    await c.refresh();
    await ready();
    assert.equal(c.state.analysis!.kind, "text");
    assert.equal(c.state.analysis!.rules.length, 0);
    assert.match(c.state.pythonNotice!, /Python unavailable/);
    assert.equal(doc.getText(), source);
  } finally {
    await configuration.update(
      "analysisPython",
      previous,
      vscode.ConfigurationTarget.Global,
    );
    await c.refresh();
    await ready();
  }
  assert.ok(c.state.analysis!.python);
  assert.equal(c.state.pythonNotice, undefined);
  reports.push(
    "Python AST: intervening edits invalidate patches; a missing configured interpreter shows unavailable without changing source; restoring it restores analysis",
  );
  for (const group of vscode.window.tabGroups.all)
    for (const tab of [...group.tabs])
      if (
        tab.input instanceof vscode.TabInputTextDiff &&
        tab.input.original.scheme === "pureobom-preview"
      )
        await vscode.window.tabGroups.close(tab);
}
