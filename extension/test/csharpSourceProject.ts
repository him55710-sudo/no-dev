import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Controller } from "../src/controller";
import { storyLines } from "../../src/core/storyReport";

export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const path = join(root, "src/GuardClauses/GuardAgainstNegativeExtensions.cs");
  const originalBytes = await readFile(path);
  const diskOriginal = originalBytes.toString("utf8");
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
    project: "https://github.com/ardalis/GuardClauses",
    commit: "f96b823e4228252b2927cce3effa550c16b558a5",
    file: "src/GuardClauses/GuardAgainstNegativeExtensions.cs",
    sourceSha256: hash(diskOriginal),
    vscode: vscode.version,
    kind: "Known negative-boundary regression through actual VS Code source reading, literal edit, native diff, task execution and undo. Original upstream GuardClauses net8.0 test project; no model or optimization claim.",
  };
  async function until(check: () => boolean) {
    const deadline = Date.now() + 240000;
    while (!check()) {
      if (Date.now() > deadline)
        throw Error(`C# project timed out: ${JSON.stringify(c.checks.result)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const config = vscode.workspace.getConfiguration("pureobom");
  const previous = config.inspect<string>("analysisDotnet")?.globalValue;
  await config.update(
    "analysisDotnet",
    process.env.PUREOBOM_TEST_DOTNET || "",
    vscode.ConfigurationTarget.Global,
  );
  try {
    const doc = await vscode.workspace.openTextDocument(path);
    // VS Code strips the UTF-8 BOM from its text model and retains it on save.
    // Rule offsets and patches refer to the editor text, not the encoded bytes.
    const original = doc.getText();
    report.encoding = {
      utf8Bom: originalBytes.subarray(0, 3).toString("hex") === "efbbbf",
      editorTextSha256: hash(original),
      diskCharacters: diskOriginal.length,
      editorCharacters: original.length,
    };
    assert.equal(original, diskOriginal.replace(/^\uFEFF/, ""));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    const a = c.state.analysis!;
    assert.equal(a.csharp?.truncated, false);
    const needle = "input.CompareTo(default(T)) < 0";
    const target = original.indexOf(needle) + needle.length - 1;
    assert.ok(target >= needle.length - 1);
    const rule = a.rules.find((r) => r.start === target && r.raw === "0")!;
    assert.ok(rule);
    assert.equal(original.slice(rule.start, rule.end), "0");
    report.analysis = {
      csharp: a.csharp,
      explained: a.explained,
      total: a.total,
      selectedRule: rule,
      ko: a.functions
        .filter((f) => f.start <= rule.start && f.end >= rule.end)
        .flatMap((f) => storyLines(f.steps, "ko")),
      en: a.functions
        .filter((f) => f.start <= rule.start && f.end >= rule.end)
        .flatMap((f) => storyLines(f.steps, "en")),
    };
    await c.source(c.state.contextId, rule.line);
    assert.equal(
      vscode.window.activeTextEditor!.selection.active.line,
      rule.line - 1,
    );
    async function task() {
      try {
        await unlink(process.env.PUREOBOM_CSHARP_SOURCE_EVENTS!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "GuardClauses C# regression",
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
        await readFile(process.env.PUREOBOM_CSHARP_SOURCE_EVENTS!, "utf8"),
      );
      assert.equal(result.error, undefined);
      assert.equal(result.counts.passed + result.counts.failed, 959);
      assert.equal(result.exitCode, c.checks.result?.exitCode);
      return { result: c.checks.result, ...result };
    }
    const baseline = await task();
    report.baseline = baseline;
    assert.equal(baseline.result.status, "passed");
    assert.equal(baseline.counts.passed, 959);
    const context = c.state.contextId;
    const patch = await c.prepare(context, { ruleId: rule.id, value: "1" });
    const preview = await c.preview(patch.id, context);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "csharp");
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
    assert.deepEqual(await readFile(path), originalBytes);
    const choice = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "GuardClauses C# regression",
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
    assert.ok(regression.counts.failed > 0);
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
    assert.equal(restored.counts.passed, 959);
    assert.deepEqual(await readFile(path), originalBytes);
    report.originalRestored = true;
    report.restoredSha256 = hash((await readFile(path)).toString("utf8"));
    report.restoredEditorSha256 = hash(doc.getText());
    console.log(
      "PUREOBOM CSHARP SOURCE PROJECT PASSED",
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
    if (!(await readFile(path)).equals(originalBytes))
      await writeFile(path, originalBytes);
    await writeFile(
      process.env.PUREOBOM_CSHARP_SOURCE_REPORT!,
      JSON.stringify(report, null, 2),
    );
    await config.update(
      "analysisDotnet",
      previous,
      vscode.ConfigurationTarget.Global,
    );
    c.dispose();
  }
}
