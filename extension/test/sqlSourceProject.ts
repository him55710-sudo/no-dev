import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Controller } from "../src/controller";
import { storyLines } from "../../src/core/storyReport";

export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const path = join(root, "examples/authors/sqlite/query.sql");
  const original = await readFile(path, "utf8");
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const api = await vscode.extensions
    .getExtension<{
      controller: Controller;
      openPanel: () => Promise<void>;
    }>("pureobom-local.pureobom")!
    .activate();
  const c = api.controller;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    project: "https://github.com/sqlc-dev/sqlc",
    commit: "c69308b521a50f92fee48ae623702c5550c49d95",
    file: "examples/authors/sqlite/query.sql",
    sourceSha256: hash(original),
    vscode: vscode.version,
    kind: "Known LIMIT regression through actual VS Code source reading, literal edit, native diff, task execution and undo. Original upstream SQLite example test only; no model or optimization claim.",
  };
  async function until(check: () => boolean) {
    const deadline = Date.now() + 240000;
    while (!check()) {
      if (Date.now() > deadline)
        throw Error(
          `SQL project timed out: ${JSON.stringify(c.checks.result)}`,
        );
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    const doc = await vscode.workspace.openTextDocument(path);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    assert.equal(c.state.analysis!.sql?.dialect, undefined);
    await c.setSqlDialect(c.state.contextId, "sqlite");
    await ready();
    const a = c.state.analysis!;
    assert.equal(a.sql?.truncated, false);
    const rule = a.rules.find((r) => r.raw === "1")!;
    assert.ok(rule);
    assert.equal(original.slice(rule.start, rule.end), "1");
    report.analysis = {
      sql: a.sql,
      explained: a.explained,
      total: a.total,
      selectedRule: rule,
      ko: storyLines(a.steps, "ko"),
      en: storyLines(a.steps, "en"),
    };
    await c.source(c.state.contextId, rule.line);
    assert.equal(
      vscode.window.activeTextEditor!.selection.active.line,
      rule.line - 1,
    );
    async function task() {
      try {
        await unlink(process.env.PUREOBOM_SQL_SOURCE_EVENTS!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "sqlc SQLite regression",
      )!;
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      const result = JSON.parse(
        await readFile(process.env.PUREOBOM_SQL_SOURCE_EVENTS!, "utf8"),
      );
      assert.equal(result.error, undefined);
      assert.equal(result.counts.passed + result.counts.failed, 1);
      assert.equal(result.exitCode, c.checks.result?.exitCode);
      return { result: c.checks.result, ...result };
    }
    const baseline = await task();
    report.baseline = baseline;
    assert.equal(baseline.result.status, "passed");
    assert.equal(baseline.counts.passed, 1);
    const context = c.state.contextId;
    const patch = await c.prepare(context, { ruleId: rule.id, value: "0" });
    const preview = await c.preview(patch.id, context);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "sql");
    assert.equal(doc.getText(), original);
    assert.equal(
      after.getText(),
      original.slice(0, rule.start) + "0" + original.slice(rule.end),
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
    assert.equal(await readFile(path, "utf8"), original);
    const choice = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "sqlc SQLite regression",
    )!;
    await assert.rejects(
      c.checks.start(c.state.contextId, choice.id, true),
      /unsaved/,
    );
    report.unsavedBlocked = true;
    assert.ok(await doc.save());
    await ready();
    report.changedSha256 = hash(doc.getText());
    const regression = await task();
    report.regression = regression;
    assert.equal(regression.result.status, "failed");
    assert.equal(regression.counts.failed, 1);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), original);
    assert.ok(await doc.save());
    await ready();
    const restored = await task();
    report.restored = restored;
    assert.equal(restored.result.status, "passed");
    assert.equal(restored.counts.passed, 1);
    assert.equal(await readFile(path, "utf8"), original);
    report.originalRestored = true;
    report.restoredSha256 = hash(doc.getText());
    console.log(
      "PUREOBOM SQL SOURCE PROJECT PASSED",
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
    if ((await readFile(path, "utf8")) !== original)
      await writeFile(path, original);
    await writeFile(
      process.env.PUREOBOM_SQL_SOURCE_REPORT!,
      JSON.stringify(report, null, 2),
    );
    c.dispose();
  }
}
