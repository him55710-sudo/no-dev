import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Controller } from "../src/controller";
import { storyLines } from "../../src/core/storyReport";

/** Known wrong initializer, to prove real upstream tests reject a syntax-valid edit. */
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const file = join(
    root,
    "com.eclipsesource.json/src/main/java/com/eclipsesource/json/JsonParser.java",
  );
  const original = await readFile(file, "utf8");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const api = await vscode.extensions
    .getExtension<{
      controller: Controller;
      openPanel: () => Promise<void>;
    }>("pureobom-local.pureobom")!
    .activate();
  const c = api.controller;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    project: "https://github.com/ralfstx/minimal-json",
    commit: "5518c876226ae07f8291d6b41209bc3c979f4a55",
    file: "com.eclipsesource.json/src/main/java/com/eclipsesource/json/JsonParser.java",
    sourceSha256: hash(original),
    vscode: vscode.version,
    kind: "actual VS Code Java AST reading, exact initializer edit, upstream task checks and undo; known regression; no model or optimization claim",
    command:
      "node scripts/run-minimal-json-tests.mjs PROJECT REPORT (javac --release 8; original JUnit dependencies)",
  };
  async function until(check: () => boolean) {
    const end = Date.now() + 180000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(`Java project timeout: ${JSON.stringify(c.checks.result)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    await vscode.workspace
      .getConfiguration("pureobom")
      .update(
        "analysisJavaHome",
        process.env.PUREOBOM_TEST_JAVA_HOME,
        vscode.ConfigurationTarget.Global,
      );
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    const a = c.state.analysis!;
    assert.ok(a.java?.version);
    report.displayTruncated = a.java.truncated;
    const fn = a.functions.find((f) => f.name === "JsonParser.readArray()")!;
    assert.ok(fn);
    const rule = a.rules.find(
      (r) => r.name === "MAX_NESTING_LEVEL" && r.raw === "1000",
    )!;
    assert.ok(rule);
    assert.equal(original.slice(rule.start, rule.end), "1000");
    report.java = a.java;
    report.analysis = {
      explained: a.explained,
      total: a.total,
      functions: a.functions.map((f) => f.name),
      selectedRule: rule,
      ko: storyLines(fn.steps, "ko"),
      en: storyLines(fn.steps, "en"),
    };
    await c.source(c.state.contextId, rule.line);
    assert.equal(
      vscode.window.activeTextEditor!.selection.active.line,
      rule.line - 1,
    );
    async function runTask() {
      try {
        await unlink(process.env.PUREOBOM_JAVA_SOURCE_EVENTS!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "minimal-json Java AST regression",
      )!;
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      const outcome = JSON.parse(
        await readFile(process.env.PUREOBOM_JAVA_SOURCE_EVENTS!, "utf8"),
      );
      assert.equal(outcome.error, undefined);
      assert.equal(outcome.counts.run, 452);
      return { result: c.checks.result, ...outcome };
    }
    const baseline = await runTask();
    report.baseline = baseline;
    assert.equal(baseline.result?.status, "passed");
    assert.equal(baseline.counts.failed, 0);
    const context = c.state.contextId;
    const patch = await c.prepare(context, { ruleId: rule.id, value: "1" });
    const preview = await c.preview(patch.id, context);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "java");
    assert.equal(doc.getText(), original);
    assert.equal(
      after.getText(),
      original.slice(0, rule.start) + "1" + original.slice(rule.end),
    );
    report.change = {
      before: patch.oldText,
      after: patch.newText,
      start: rule.start,
      end: rule.end,
      semanticChecked: false,
    };
    await c.apply(patch.id, context);
    await ready();
    assert.equal(doc.getText(), after.getText());
    assert.equal(await readFile(file, "utf8"), original);
    const choice = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "minimal-json Java AST regression",
    )!;
    await assert.rejects(
      c.checks.start(c.state.contextId, choice.id, true),
      /unsaved/,
    );
    report.unsavedBlocked = true;
    assert.ok(await doc.save());
    await ready();
    report.changedSha256 = hash(doc.getText());
    const regression = await runTask();
    report.regression = regression;
    assert.equal(regression.result?.status, "failed");
    assert.equal(regression.result?.exitCode, 1);
    assert.ok(regression.counts.failed > 0);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), original);
    assert.ok(await doc.save());
    await ready();
    const restored = await runTask();
    report.restored = restored;
    assert.equal(restored.result?.status, "passed");
    assert.equal(restored.counts.failed, 0);
    assert.equal(restored.counts.run, baseline.counts.run);
    assert.equal(await readFile(file, "utf8"), original);
    report.originalRestored = true;
    report.restoredSha256 = hash(doc.getText());
    console.log(
      "PUREOBOM JAVA SOURCE PROJECT PASSED",
      JSON.stringify({
        baseline: baseline.counts,
        regression: regression.counts,
        restored: restored.counts,
      }),
    );
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    if ((await readFile(file, "utf8")) !== original)
      await writeFile(file, original);
    await writeFile(
      process.env.PUREOBOM_JAVA_SOURCE_REPORT!,
      JSON.stringify(report, null, 2),
    );
    c.dispose();
  }
}
