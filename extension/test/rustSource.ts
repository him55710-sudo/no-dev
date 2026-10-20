import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function rustSourceChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const doc = await vscode.workspace.openTextDocument({
    language: "rust",
    content:
      '// 😀 한글\r\nconst LIMIT:u64 = 9007199254740993u64;\r\nfn choose(x:i32)->&\'static str { match x { 0 => r#"한글"#, _ => "other" } }\r\n',
  });
  try {
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await c.setDocument(doc);
    await ready();
    const source = doc.getText(),
      context = c.state.contextId;
    assert.ok(c.state.analysis?.rust);
    assert.equal(c.state.rustNotice, undefined);
    assert.equal(c.state.analysis!.functions[0].name, "choose");
    assert.equal(c.state.analysis!.functions[0].steps[0].branches!.length, 2);
    assert.equal(c.state.analysis!.functions[0].simulatable, false);
    const rule = c.state.analysis!.rules.find(
      (r) => r.raw === "9007199254740993u64",
    )!;
    assert.equal(source.slice(rule.start, rule.end), rule.raw);
    assert.equal(rule.line, 2);
    await c.source(context, rule.line);
    assert.equal(vscode.window.activeTextEditor!.selection.active.line, 1);
    const patch = await c.prepare(context, {
      request: `change ${rule.label.en} to 9007199254740995u64`,
    });
    const preview = await c.preview(patch.id, context);
    const before = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.before),
    );
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "rust");
    assert.equal(before.getText(), source);
    assert.equal(doc.getText(), source);
    assert.equal(
      after.getText(),
      source.replace("9007199254740993u64", "9007199254740995u64"),
    );
    await c.apply(patch.id, context);
    await ready();
    assert.equal(doc.getText(), after.getText());
    assert.equal(
      c.state.analysis!.rules.find((r) => r.start === rule.start)!.value,
      "9007199254740995u64",
    );
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), source);
    await assert.rejects(c.apply(patch.id, context));
    reports.push(
      "Rust bundled WASM: UTF-16/CRLF anchors, match arms, source navigation, huge integer natural-language edit, native Rust diff, apply/reanalysis/undo and used-patch rejection without a Rust SDK",
    );

    const oldContext = c.state.contextId;
    const stringRule = c.state.analysis!.rules.find((r) => r.value === "한글")!;
    const stale = await c.prepare(oldContext, {
      ruleId: stringRule.id,
      value: '새 이름😀 "#',
    });
    assert.equal(stale.newText, 'r##"새 이름😀 "#"##');
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    await editor.edit((b) =>
      b.insert(new vscode.Position(0, 0), "fn broken( {\n"),
    );
    await c.refresh();
    await ready();
    await assert.rejects(c.apply(stale.id, oldContext));
    assert.equal(c.state.analysis!.syntaxValid, false);
    assert.equal(c.state.analysis!.rules.length, 0);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), source);
    assert.equal(c.state.analysis!.syntaxValid, true);
    reports.push(
      "Rust bundled WASM: raw-string delimiter preview, stale edit rejection, syntax-error edits withheld and exact source recovery",
    );
  } finally {
    for (const group of vscode.window.tabGroups.all)
      for (const tab of [...group.tabs])
        if (
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input.original.scheme === "pureobom-preview"
        )
          await vscode.window.tabGroups.close(tab);
  }
}
