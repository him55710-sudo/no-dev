import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function sqlSourceChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const doc = await vscode.workspace.openTextDocument({
    language: "sql",
    content:
      "-- 😀\r\nSELECT 'O''Brien' AS name, 9007199254740993 AS n LIMIT 1;",
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await c.setDocument(doc);
  await ready();
  assert.equal(c.state.analysis!.sql?.dialect, undefined);
  assert.equal(c.state.analysis!.rules.length, 0);
  await assert.rejects(c.setSqlDialect(c.state.contextId, "postgresql"));
  await c.setSqlDialect(c.state.contextId, "sqlite");
  await ready();
  const original = doc.getText();
  const rule = c.state.analysis!.rules[0];
  assert.equal(rule.value, "O'Brien");
  assert.equal(rule.line, 2);
  await c.source(c.state.contextId, rule.line);
  assert.equal(vscode.window.activeTextEditor!.selection.active.line, 1);
  const context = c.state.contextId;
  const patch = await c.prepare(context, {
    ruleId: rule.id,
    value: "x'; DROP TABLE authors; -- 😀",
  });
  const preview = await c.preview(patch.id, context);
  const after = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(preview.after),
  );
  assert.equal(after.languageId, "sql");
  assert.equal(doc.getText(), original);
  assert.ok(after.getText().includes("'x''; DROP TABLE authors; -- 😀'"));
  await c.apply(patch.id, context);
  await ready();
  assert.equal(doc.getText(), after.getText());
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("undo");
  await c.refresh();
  await ready();
  assert.equal(doc.getText(), original);
  await assert.rejects(c.apply(patch.id, context));
  const oldContext = c.state.contextId;
  const numeric = c.state.analysis!.rules.find(
    (r) => r.raw === "9007199254740993",
  )!;
  const pending = await c.prepare(oldContext, {
    ruleId: numeric.id,
    value: "9223372036854775807",
  });
  await c.setSqlDialect(oldContext, "");
  await ready();
  assert.equal(c.state.analysis!.rules.length, 0);
  await assert.rejects(c.apply(pending.id, oldContext));
  await c.setSqlDialect(c.state.contextId, "sqlite");
  await ready();
  const next = c.state.contextId;
  const bigintPatch = await c.prepare(next, {
    ruleId: c.state.analysis!.rules.find((r) => r.raw === "9007199254740993")!
      .id,
    value: "9223372036854775807",
  });
  await c.preview(bigintPatch.id, next);
  await c.apply(bigintPatch.id, next);
  await ready();
  assert.ok(doc.getText().includes("9223372036854775807"));
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("undo");
  await c.refresh();
  await ready();
  assert.equal(doc.getText(), original);
  const other = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "SELECT 2;",
  });
  await vscode.window.showTextDocument(other, vscode.ViewColumn.One);
  await c.setDocument(other);
  await ready();
  assert.equal(c.state.analysis!.sql?.dialect, undefined);
  assert.equal(c.state.analysis!.rules.length, 0);
  reports.push(
    "SQLite: explicit per-document dialect, untitled SQL, Unicode/CRLF source navigation, native SQL diff, quote-safe string edit, large integer preservation, apply/reanalysis/undo, dialect-change invalidation and no implicit selection on other files",
  );
  for (const group of vscode.window.tabGroups.all)
    for (const tab of [...group.tabs])
      if (
        tab.input instanceof vscode.TabInputTextDiff &&
        tab.input.original.scheme === "pureobom-preview"
      )
        await vscode.window.tabGroups.close(tab);
}
