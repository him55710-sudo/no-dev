import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Controller } from "../src/controller";
import { storyLines } from "../../src/core/storyReport";

/** Deliberate, reviewed regression: verifies model-free edits and actual upstream tests. */
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const file = join(root, "src/itsdangerous/url_safe.py");
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
    project: "https://github.com/pallets/itsdangerous",
    commit: "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd",
    file: "src/itsdangerous/url_safe.py",
    sourceSha256: hash(original),
    vscode: vscode.version,
    kind: "actual VS Code Python AST reading, exact boolean edit, upstream task checks and undo; known regression; no model or optimization claim",
    command: "python -m pytest -q --tb=no --junitxml=<outside-workspace>",
  };
  async function until(check: () => boolean) {
    const end = Date.now() + 120000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(
          `Python source project timeout: ${JSON.stringify(c.checks.result)}`,
        );
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    await vscode.workspace
      .getConfiguration("pureobom")
      .update(
        "analysisPython",
        process.env.PUREOBOM_PYTHON_SOURCE_EXECUTABLE,
        vscode.ConfigurationTarget.Global,
      );
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    const analysis = c.state.analysis!;
    assert.ok(analysis.python?.version);
    assert.ok(
      analysis.functions.some(
        (f) => f.name === "URLSafeSerializerMixin.load_payload",
      ),
    );
    assert.equal(analysis.python.truncated, false);
    const rule = analysis.rules.find(
      (r) => r.name === "decompress" && r.raw === "False",
    )!;
    assert.ok(rule);
    assert.equal(original.slice(rule.start, rule.end), "False");
    report.python = analysis.python;
    report.analysis = {
      explained: analysis.explained,
      total: analysis.total,
      functions: analysis.functions.map((f) => f.name),
      selectedRule: rule,
      ko: analysis.functions.map((fn) => ({
        name: fn.name,
        lines: storyLines(fn.steps, "ko"),
      })),
      en: analysis.functions.map((fn) => ({
        name: fn.name,
        lines: storyLines(fn.steps, "en"),
      })),
    };
    await c.source(c.state.contextId, rule.line);
    assert.equal(
      vscode.window.activeTextEditor!.selection.active.line,
      rule.line - 1,
    );
    async function runTask() {
      try {
        await unlink(process.env.PUREOBOM_PYTHON_SOURCE_XML!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "itsdangerous Python AST regression",
      );
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      const attrs = (
        await readFile(process.env.PUREOBOM_PYTHON_SOURCE_XML!, "utf8")
      ).match(/<testsuite\b([^>]*)>/)?.[1];
      assert.ok(attrs);
      const counts = Object.fromEntries(
        ["tests", "failures", "errors", "skipped"].map((key) => [
          key,
          Number(attrs.match(new RegExp(`${key}="([0-9]+)"`))?.[1]),
        ]),
      );
      for (const n of Object.values(counts)) assert.ok(Number.isInteger(n));
      return { result: c.checks.result, counts };
    }
    const baseline = await runTask();
    report.baseline = baseline;
    assert.equal(baseline.result?.status, "passed");
    assert.deepEqual(baseline.counts, {
      tests: 297,
      failures: 0,
      errors: 0,
      skipped: 0,
    });
    const context = c.state.contextId;
    const patch = await c.prepare(context, { ruleId: rule.id, value: "True" });
    const preview = await c.preview(patch.id, context);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "python");
    assert.equal(doc.getText(), original);
    assert.equal(
      after.getText(),
      original.slice(0, rule.start) + "True" + original.slice(rule.end),
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
      (t) => t.name === "itsdangerous Python AST regression",
    )!;
    await assert.rejects(
      c.checks.start(c.state.contextId, choice.id, true),
      /unsaved/,
    );
    report.unsavedBlocked = true;
    assert.ok(await doc.save());
    await ready();
    const regression = await runTask();
    report.regression = regression;
    assert.equal(regression.result?.status, "failed");
    assert.equal(regression.result?.exitCode, 1);
    assert.equal(regression.counts.tests, 297);
    assert.ok(regression.counts.failures > 0);
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
    console.log(
      "PUREOBOM PYTHON SOURCE PROJECT PASSED",
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
      process.env.PUREOBOM_PYTHON_SOURCE_REPORT!,
      JSON.stringify(report, null, 2),
    );
    c.dispose();
  }
}
