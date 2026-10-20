import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function functionFormatChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const original =
    "const outside=42;\nfunction total(rows: number[]) { let amount=0, index=0; while(index<rows.length) { amount+=rows[index]; index++; } return amount; }\nconst untouched=()=>2;\n";
  const doc = await vscode.workspace.openTextDocument({
    language: "typescript",
    content: original,
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await c.setDocument(doc);
  await ready();
  const fn = () => c.state.analysis!.functions.find((f) => f.name === "total")!;
  const context = c.state.contextId;
  const patch = await c.prepareFormat(context, fn().id);
  assert.ok("id" in patch);
  assert.equal(patch.kind, "function-format");
  await assert.rejects(
    c.apply(patch.id, context),
    /Preview the code diff first/,
  );
  assert.equal(doc.getText(), original);
  const preview = await c.preview(patch.id, context, "en");
  const candidate = (
    await vscode.workspace.openTextDocument(vscode.Uri.parse(preview.after))
  ).getText();
  assert.ok(
    candidate.includes(
      "while (index < rows.length) {\n    amount += rows[index];\n    index++;\n  }",
    ),
  );
  assert.ok(candidate.startsWith("const outside=42;\n"));
  assert.ok(candidate.endsWith("\nconst untouched=()=>2;\n"));
  await c.apply(patch.id, context);
  await ready();
  assert.equal(doc.getText(), candidate);
  const noChange = await c.prepareFormat(c.state.contextId, fn().id);
  assert.ok("unchanged" in noChange);
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("undo");
  await c.refresh();
  await ready();
  assert.equal(doc.getText(), original);
  await assert.rejects(c.apply(patch.id, context));
  reports.push(
    "Local JS/TS function formatting: required native diff, preserved surrounding code, apply, no-op detection, one native undo restores exact source; no model",
  );
  const staleContext = c.state.contextId;
  const stale = await c.prepareFormat(staleContext, fn().id);
  assert.ok("id" in stale);
  await c.preview(stale.id, staleContext);
  const editor = await vscode.window.showTextDocument(
    doc,
    vscode.ViewColumn.One,
  );
  await editor.edit((edit) =>
    edit.insert(new vscode.Position(0, 0), "// changed\n"),
  );
  await c.refresh();
  await ready();
  await assert.rejects(c.apply(stale.id, staleContext));
  assert.ok(doc.getText().startsWith("// changed\n"));
  await vscode.commands.executeCommand("undo");
  await c.refresh();
  await ready();
  assert.equal(doc.getText(), original);
  reports.push(
    "Local JS/TS formatting refuses an already reviewed proposal after the document changes",
  );
  for (const group of vscode.window.tabGroups.all)
    for (const tab of [...group.tabs])
      if (
        tab.input instanceof vscode.TabInputTextDiff &&
        tab.input.original.scheme === "pureobom-preview"
      )
        await vscode.window.tabGroups.close(tab);
}
