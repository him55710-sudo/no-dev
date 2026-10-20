import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Controller } from "../src/controller";

// A reviewed fixed regression exercises external JS tests, not model semantics.
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const file = join(root, "src/index.js");
  const original = await readFile(file, "utf8");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  assert.equal(
    hash(original.replace(/\r\n/g, "\n")),
    "a577c500f65ed167cea489dd39c149c36880f959fc6ca24e4e1cc545cb7a53e1",
  );
  const extension = vscode.extensions.getExtension<{
    controller: Controller;
    openPanel: () => Promise<void>;
  }>("pureobom-local.pureobom")!;
  const api = await extension.activate(),
    c = api.controller;
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    project: "https://github.com/lukeed/clsx",
    commit: "925494cf31bcd97d3337aacd34e659e80cae7fe2",
    kind: "actual VS Code project-check workflow; known JS regression; no model inference or optimization claim",
    file: "src/index.js",
    sourceSha256: hash(original),
    vscode: vscode.version,
    command:
      "uvu -r esm test (unchanged upstream tests, Node 20.18.1 via VS Code Electron)",
  };
  async function until(check: () => boolean) {
    const end = Date.now() + 120000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(
          `clsx integration timeout: ${JSON.stringify(c.checks.result)}`,
        );
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    async function runTask() {
      // Do not attribute previous counts to a command that failed before
      // its adapter could write a fresh report.
      try {
        await unlink(process.env.PUREOBOM_CLSX_TASK_REPORT!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "clsx upstream tests",
      );
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      return {
        result: c.checks.result,
        output: JSON.parse(
          await readFile(process.env.PUREOBOM_CLSX_TASK_REPORT!, "utf8"),
        ),
      };
    }
    const baseline = await runTask();
    report.baseline = baseline;
    assert.equal(baseline.result?.status, "passed");
    assert.equal(baseline.output.counts.total, 32);
    assert.equal(baseline.output.counts.passed, 32);
    const before = "if (x = toVal(tmp))",
      after = "if (false)";
    const offset = original.indexOf(before);
    assert.ok(offset >= 0);
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    assert.ok(
      await editor.edit((b) =>
        b.replace(
          new vscode.Range(
            doc.positionAt(offset),
            doc.positionAt(offset + before.length),
          ),
          after,
        ),
      ),
    );
    await ready();
    const choice = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "clsx upstream tests",
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
    report.regressionChange = { before, after };
    assert.equal(regression.result?.status, "failed");
    assert.equal(regression.result?.exitCode, 1);
    assert.ok(regression.output.counts.passed < regression.output.counts.total);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("undo");
    await ready();
    assert.equal(doc.getText(), original);
    assert.ok(await doc.save());
    await ready();
    const restored = await runTask();
    report.restored = restored;
    assert.equal(restored.result?.status, "passed");
    assert.equal(restored.output.counts.passed, 32);
    assert.equal(await readFile(file, "utf8"), original);
    report.originalRestored = true;
    console.log(
      "PUREOBOM CLSX CHECKS PASSED",
      JSON.stringify({
        baseline: baseline.output.counts,
        regression: regression.output.counts,
        restored: restored.output.counts,
      }),
    );
  } catch (e) {
    report.error = String(e);
    throw e;
  } finally {
    if ((await readFile(file, "utf8")) !== original)
      await writeFile(file, original);
    await writeFile(
      process.env.PUREOBOM_CLSX_REPORT!,
      JSON.stringify(report, null, 2),
    );
    c.dispose();
  }
}
