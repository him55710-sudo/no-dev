import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Controller } from "../src/controller";

type Upstream = {
  error?: string;
  exitCode: number;
  counts: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    testsWithoutExpectCalls: number;
  };
  failedTests: { fixture: string; index: number; name: string }[];
  raw: {
    fixtures: {
      name: string;
      tests: { name: string; errs: unknown[]; skipped: boolean }[];
    }[];
  };
};

/** Known wrong CSS value; compare the full suite with its existing failures. */
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const file = join(root, "modern-normalize.css");
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
    project: "https://github.com/sindresorhus/modern-normalize",
    commit: "3faa07fc91b8ffbe6243bc4f91e880a00185d0a2",
    file: "modern-normalize.css",
    sourceSha256: hash(original),
    vscode: vscode.version,
    kind: "Real VS Code source reading, exact CSS value edit, full upstream Chrome task checks and undo. Fixed regression, no model or optimization claim. Existing upstream failures are preserved.",
  };
  async function until(check: () => boolean) {
    const end = Date.now() + 360000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(`Web project timeout: ${JSON.stringify(c.checks.result)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const ready = () => until(() => !c.state.busy && !!c.state.analysis);
  const failureIds = (upstream: Upstream) =>
    upstream.failedTests.map((t) => `${t.fixture}/${t.index}/${t.name}`).sort();
  try {
    const html = await vscode.workspace.openTextDocument(
      join(root, "test/page/with-css.html"),
    );
    await vscode.window.showTextDocument(html, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(html);
    await ready();
    assert.equal(c.state.analysis!.web?.language, "html");
    assert.equal(c.state.analysis!.web?.truncated, false);
    assert.ok(
      c.state.analysis!.rules.some(
        (r) => r.value === "HyperText Markup Language",
      ),
    );
    report.html = {
      file: "test/page/with-css.html",
      sourceSha256: hash(html.getText()),
      web: c.state.analysis!.web,
      interface: c.state.analysis!.interface,
      rules: c.state.analysis!.rules,
    };
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await c.setDocument(doc);
    await ready();
    const a = c.state.analysis!;
    assert.equal(a.web?.language, "css");
    assert.equal(a.web?.truncated, false);
    const rule = a.rules.find(
      (r) => r.cssProperty === "box-sizing" && r.raw === "border-box",
    )!;
    assert.ok(rule);
    assert.equal(original.slice(rule.start, rule.end), "border-box");
    report.analysis = {
      web: a.web,
      interface: a.interface,
      selectedRule: rule,
      ruleCount: a.rules.length,
    };
    await c.source(c.state.contextId, rule.line);
    assert.equal(
      vscode.window.activeTextEditor!.selection.active.line,
      rule.line - 1,
    );
    async function runTask() {
      await unlink(process.env.PUREOBOM_WEB_SOURCE_TASK_REPORT!).catch(
        (error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        },
      );
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "modern-normalize upstream Chrome tests",
      )!;
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      const upstream = JSON.parse(
        await readFile(process.env.PUREOBOM_WEB_SOURCE_TASK_REPORT!, "utf8"),
      ) as Upstream;
      assert.equal(upstream.error, undefined);
      assert.ok(upstream.counts.total > 0);
      assert.equal(c.checks.result?.exitCode, upstream.exitCode);
      assert.equal(
        c.checks.result?.status,
        upstream.exitCode ? "failed" : "passed",
      );
      return { result: c.checks.result, upstream };
    }
    const baseline = await runTask();
    report.baseline = baseline;
    const boxModel = baseline.upstream.raw.fixtures.find(
      (f) => f.name === "Chrome Rules Tests",
    )!.tests[0];
    assert.equal(boxModel.name, "Use a better box model (opinionated).");
    assert.equal(boxModel.errs.length, 0);
    assert.equal(boxModel.skipped, false);
    const context = c.state.contextId;
    const patch = await c.prepare(context, {
      ruleId: rule.id,
      value: "content-box",
    });
    const preview = await c.preview(patch.id, context);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.equal(after.languageId, "css");
    assert.equal(doc.getText(), original);
    assert.equal(
      after.getText(),
      original.slice(0, rule.start) + "content-box" + original.slice(rule.end),
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
      (t) => t.name === "modern-normalize upstream Chrome tests",
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
    const priorFailures = failureIds(baseline.upstream);
    const newFailures = failureIds(regression.upstream).filter(
      (id) => !priorFailures.includes(id),
    );
    assert.ok(
      newFailures.includes(
        "Chrome Rules Tests/0/Use a better box model (opinionated).",
      ),
    );
    assert.ok(
      priorFailures.every((id) => failureIds(regression.upstream).includes(id)),
    );
    report.additionalFailures = newFailures;
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await c.refresh();
    await ready();
    assert.equal(doc.getText(), original);
    assert.ok(await doc.save());
    await ready();
    const restored = await runTask();
    report.restored = restored;
    assert.deepEqual(restored.upstream.counts, baseline.upstream.counts);
    assert.deepEqual(failureIds(restored.upstream), priorFailures);
    assert.equal(await readFile(file, "utf8"), original);
    report.originalRestored = true;
    report.restoredSha256 = hash(doc.getText());
    console.log(
      "PUREOBOM WEB SOURCE PROJECT FLOW PASSED",
      JSON.stringify({
        baseline: baseline.upstream.counts,
        regression: regression.upstream.counts,
        restored: restored.upstream.counts,
        additionalFailures: newFailures,
      }),
    );
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    if ((await readFile(file, "utf8")) !== original)
      await writeFile(file, original);
    await writeFile(
      process.env.PUREOBOM_WEB_SOURCE_REPORT!,
      JSON.stringify(report, null, 2),
    );
    c.dispose();
  }
}
