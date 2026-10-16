import * as assert from "node:assert/strict";
import { resolve } from "node:path";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function javaSourceChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const configuration = vscode.workspace.getConfiguration("pureobom");
  const previous =
    configuration.inspect<string>("analysisJavaHome")?.globalValue;
  const home =
    process.env.PUREOBOM_TEST_JAVA_HOME || process.env.JAVA_HOME || "";
  try {
    await configuration.update(
      "analysisJavaHome",
      home,
      vscode.ConfigurationTarget.Global,
    );
    const doc = await vscode.workspace.openTextDocument({
      language: "java",
      content:
        'class Sample {\r\n // 😀 데이터\r\n long limit = 9007199254740993L;\r\n String 이름 = "한글";\r\n int calculate(int amount) {\r\n  if (amount < 0) throw new IllegalArgumentException("negative");\r\n  return amount >= limit ? 0 : 3000;\r\n }\r\n}\r\n',
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await c.setDocument(doc);
    await ready();
    const source = doc.getText();
    assert.ok(c.state.analysis?.java?.version);
    assert.equal(c.state.analysis!.functions[0].name, "Sample.calculate(int)");
    assert.equal(c.state.analysis!.functions[0].simulatable, false);
    const rule = c.state.analysis!.rules.find((r) => r.name === "limit")!;
    assert.equal(rule.value, "9007199254740993L");
    assert.equal(source.slice(rule.start, rule.end), rule.raw);
    assert.equal(rule.line, 3);
    await c.source(c.state.contextId, rule.line);
    assert.equal(vscode.window.activeTextEditor!.selection.active.line, 2);
    const context = c.state.contextId;
    const patch = await c.prepare(context, {
      request: "change limit to 9007199254740995L",
    });
    const preview = await c.preview(patch.id, context);
    const before = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.before),
    );
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "java");
    assert.equal(before.getText(), source);
    assert.equal(doc.getText(), source);
    assert.equal(
      after.getText(),
      source.replace("9007199254740993L", "9007199254740995L"),
    );
    await c.apply(patch.id, context);
    await ready();
    assert.equal(doc.getText(), after.getText());
    assert.equal(
      c.state.analysis!.rules.find((r) => r.name === "limit")!.value,
      "9007199254740995L",
    );
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), source);
    await assert.rejects(c.apply(patch.id, context));
    reports.push(
      "Java AST: actual JDK parser, Unicode/CRLF source anchors, exact long integer edit, native Java diff, apply/reanalysis/undo and used-patch rejection",
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
      "analysisJavaHome",
      resolve(home || ".", "pureobom-no-such-jdk"),
      vscode.ConfigurationTarget.Global,
    );
    await c.refresh();
    await ready();
    assert.equal(c.state.analysis!.kind, "text");
    assert.equal(c.state.analysis!.rules.length, 0);
    assert.match(c.state.javaNotice!, /JDK unavailable/);
    assert.equal(doc.getText(), source);
    await configuration.update(
      "analysisJavaHome",
      home,
      vscode.ConfigurationTarget.Global,
    );
    await c.refresh();
    await ready();
    assert.ok(c.state.analysis!.java);
    assert.equal(c.state.javaNotice, undefined);
    reports.push(
      "Java AST: Unicode string preview, stale source rejection, explicit missing-JDK notice and restored analysis without source mutation",
    );
  } finally {
    await configuration.update(
      "analysisJavaHome",
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
