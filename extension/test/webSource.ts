import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function webSourceChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  for (const language of ["html", "css"] as const) {
    const doc = await vscode.workspace.openTextDocument({
      language,
      content:
        language === "html"
          ? '<!doctype html>\r\n<p title="안녕 &amp; 😀">배송 안내</p>\r\n<script>throw Error("never execute")</script>'
          : "/* 😀 유지 */\r\n@media (min-width: 700px) { .grid { gap: 12.0000px !important; } }",
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await c.setDocument(doc);
    await ready();
    const original = doc.getText();
    assert.equal(c.state.analysis!.web?.language, language);
    const rule = c.state.analysis!.rules[0];
    assert.equal(rule.line, 2);
    assert.equal(original.slice(rule.start, rule.end), rule.raw);
    await c.source(c.state.contextId, rule.line);
    assert.equal(vscode.window.activeTextEditor!.selection.active.line, 1);
    const context = c.state.contextId;
    const value = language === "html" ? '새 "문구" & 😀' : "24px";
    const patch = await c.prepare(context, { ruleId: rule.id, value });
    const preview = await c.preview(patch.id, context);
    const before = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.before),
    );
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, language);
    assert.equal(before.getText(), original);
    assert.equal(doc.getText(), original);
    assert.equal(
      after.getText(),
      language === "html"
        ? original.replace('"안녕 &amp; 😀"', '"새 &quot;문구&quot; &amp; 😀"')
        : original.replace("12.0000px", "24px"),
    );
    await c.apply(patch.id, context);
    await ready();
    assert.equal(doc.getText(), after.getText());
    assert.equal(c.state.analysis!.rules[0].value, value);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), original);
    await assert.rejects(c.apply(patch.id, context));
    const staleContext = c.state.contextId;
    const stale = await c.prepare(staleContext, {
      ruleId: c.state.analysis!.rules[0].id,
      value,
    });
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    await editor.edit((builder) =>
      builder.insert(new vscode.Position(0, 0), "\n"),
    );
    await c.refresh();
    await ready();
    await assert.rejects(c.apply(stale.id, staleContext));
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), original);
    if (language === "css")
      await assert.rejects(
        c.prepare(c.state.contextId, {
          ruleId: c.state.analysis!.rules[0].id,
          value: "24px; display:none",
        }),
      );
    reports.push(
      `${language.toUpperCase()} parser: untitled file, Unicode/CRLF anchors, source navigation, native language diff, exact value edit, apply/reanalysis/undo, used/stale patch rejection${language === "css" ? ", declaration breakout rejection" : ", entity-safe text attribute replacement"}`,
    );
  }
  for (const group of vscode.window.tabGroups.all)
    for (const tab of [...group.tabs])
      if (
        tab.input instanceof vscode.TabInputTextDiff &&
        tab.input.original.scheme === "pureobom-preview"
      )
        await vscode.window.tabGroups.close(tab);
}
