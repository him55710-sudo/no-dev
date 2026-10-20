import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function goSourceChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const configuration = vscode.workspace.getConfiguration("pureobom");
  const previous = configuration.inspect<string>("analysisGo")?.globalValue;
  try {
    await configuration.update(
      "analysisGo",
      process.env.PUREOBOM_TEST_GO || "go",
      vscode.ConfigurationTarget.Global,
    );
    const doc = await vscode.workspace.openTextDocument({
      language: "go",
      content:
        "package sample\r\n// 😀 데이터\r\nconst limit = 9007199254740993\r\nvar 이름 = `한글`\r\nfunc calculate(amount int) (int, error) {\r\n defer cleanup()\r\n if amount >= limit { return 0, nil }\r\n return 3000, nil\r\n}\r\n",
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await c.setDocument(doc);
    await ready();
    const source = doc.getText();
    assert.ok(
      c.state.analysis?.go?.version,
      JSON.stringify({
        goNotice: c.state.goNotice,
        error: c.state.error,
        kind: c.state.analysis?.kind,
        language: c.state.language,
        busy: c.state.busy,
      }),
    );
    assert.equal(c.state.analysis!.functions[0].name, "calculate");
    assert.equal(c.state.analysis!.functions[0].simulatable, false);
    const rule = c.state.analysis!.rules.find((r) => r.name === "limit")!;
    assert.equal(rule.value, "9007199254740993");
    assert.equal(source.slice(rule.start, rule.end), rule.raw);
    assert.equal(rule.line, 3);
    await c.source(c.state.contextId, rule.line);
    assert.equal(vscode.window.activeTextEditor!.selection.active.line, 2);
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
    assert.equal(after.languageId, "go");
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
      "Go AST: actual locally built standard-library helper, Unicode/CRLF source anchors, exact integer edit, native Go diff, apply/reanalysis/undo and used-patch rejection",
    );

    const oldContext = c.state.contextId;
    const stringRule = c.state.analysis!.rules.find((r) => r.name === "이름")!;
    const stale = await c.prepare(oldContext, {
      ruleId: stringRule.id,
      value: "새 이름😀",
    });
    assert.equal(stale.newText, '"새 이름😀"');
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), "// later\n"));
    await c.refresh();
    await ready();
    await assert.rejects(c.apply(stale.id, oldContext));
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), source);
    await configuration.update(
      "analysisGo",
      "pureobom-no-such-go",
      vscode.ConfigurationTarget.Global,
    );
    await c.refresh();
    await ready();
    assert.equal(c.state.analysis!.kind, "text");
    assert.equal(c.state.analysis!.rules.length, 0);
    assert.match(c.state.goNotice!, /Go unavailable/);
    assert.equal(doc.getText(), source);
    await configuration.update(
      "analysisGo",
      process.env.PUREOBOM_TEST_GO || "go",
      vscode.ConfigurationTarget.Global,
    );
    await c.refresh();
    await ready();
    assert.ok(c.state.analysis!.go);
    assert.equal(c.state.goNotice, undefined);
    reports.push(
      "Go AST: Unicode string preview, stale source rejection, explicit missing-SDK notice and restored analysis without source mutation",
    );
  } finally {
    await configuration.update(
      "analysisGo",
      previous,
      vscode.ConfigurationTarget.Global,
    );
    for (const group of vscode.window.tabGroups.all)
      for (const tab of [...group.tabs])
        if (
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.original.scheme === "pureobom-preview"
        )
          await vscode.window.tabGroups.close(tab);
  }
}
