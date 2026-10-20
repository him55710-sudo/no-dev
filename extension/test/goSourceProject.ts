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
  const file = join(root, "uuid.go");
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
    project: "https://github.com/google/uuid",
    commit: "0f11ee6918f41a04c201eceeadf612a377bc7fbc",
    file: "uuid.go",
    sourceSha256: hash(original),
    vscode: vscode.version,
    kind: "actual VS Code Go AST reading, exact initializer edit, upstream task checks and undo; known regression; no model or optimization claim",
    command: "go test -mod=readonly -count=1 -json ./...",
  };
  async function until(check: () => boolean) {
    const end = Date.now() + 180000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(`Go project timeout: ${JSON.stringify(c.checks.result)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    await vscode.workspace
      .getConfiguration("pureobom")
      .update(
        "analysisGo",
        process.env.PUREOBOM_TEST_GO,
        vscode.ConfigurationTarget.Global,
      );
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    const a = c.state.analysis!;
    assert.ok(a.go?.version);
    assert.equal(a.go.truncated, false);
    const fn = a.functions.find((f) => f.name === "ParseBytes")!;
    assert.ok(fn);
    const rule = a.rules.find(
      (r) => r.scope === "ParseBytes" && r.name === "i" && r.raw === "0",
    )!;
    assert.ok(rule);
    assert.equal(original.slice(rule.start, rule.end), "0");
    report.go = a.go;
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
        await unlink(process.env.PUREOBOM_GO_SOURCE_EVENTS!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "Google UUID Go AST regression",
      )!;
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      const events = (
        await readFile(process.env.PUREOBOM_GO_SOURCE_EVENTS!, "utf8")
      )
        .trim()
        .split(/\r?\n/)
        .map((s) => JSON.parse(s));
      const tests = events.filter(
        (e) => e.Test && ["pass", "fail", "skip"].includes(e.Action),
      );
      assert.ok(tests.length > 0, "Go emitted actual test results");
      return {
        result: c.checks.result,
        counts: {
          passed: tests.filter((e) => e.Action === "pass").length,
          failed: tests.filter((e) => e.Action === "fail").length,
          skipped: tests.filter((e) => e.Action === "skip").length,
        },
        failedTests: tests
          .filter((e) => e.Action === "fail")
          .map((e) => e.Test),
        outputSha256: hash(JSON.stringify(events)),
      };
    }
    const baseline = await runTask();
    report.baseline = baseline;
    assert.equal(baseline.result?.status, "passed");
    assert.equal(baseline.counts.failed, 0);
    const context = c.state.contextId;
    const patch = await c.prepare(context, { ruleId: rule.id, value: "2" });
    const preview = await c.preview(patch.id, context);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "go");
    assert.equal(doc.getText(), original);
    assert.equal(
      after.getText(),
      original.slice(0, rule.start) + "2" + original.slice(rule.end),
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
      (t) => t.name === "Google UUID Go AST regression",
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
    assert.deepEqual(restored.counts, baseline.counts);
    assert.equal(await readFile(file, "utf8"), original);
    report.originalRestored = true;
    report.restoredSha256 = hash(doc.getText());
    console.log(
      "PUREOBOM GO SOURCE PROJECT PASSED",
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
      process.env.PUREOBOM_GO_SOURCE_REPORT!,
      JSON.stringify(report, null, 2),
    );
    c.dispose();
  }
}
