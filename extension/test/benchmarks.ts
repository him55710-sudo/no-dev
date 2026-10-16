import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";
import { compareBenchmarks } from "../../src/core/benchmark";

export async function benchmarkChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  const root = vscode.workspace.workspaceFolders![0].uri;
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, "shipping.ts"),
  );
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  await c.setDocument(doc);
  await ready();
  const original = doc.getText();
  async function until(check: () => boolean, label: string) {
    const end = Date.now() + 30000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(`${label}: ${JSON.stringify(c.benchmarks.state)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function prepare(name = "Pureobom benchmark") {
    await ready();
    const task = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === name,
    );
    assert.ok(task);
    return c.benchmarks.prepare(c.state.contextId, task.id);
  }
  async function done() {
    await until(
      () => !["running", "stopping"].includes(c.benchmarks.state.status),
      "measurement completion",
    );
  }
  async function replace(text: string, save = true) {
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    });
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length),
        ),
        text,
      ),
    );
    if (save) await doc.save();
    await c.setDocument(doc);
    await ready();
    // Let the disk watcher consume our own save before recording the next phase.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  try {
    await assert.rejects(prepare("Pureobom check shell"), /process task/);
    const initial = await prepare();
    assert.equal(
      initial.argv.at(-1),
      doc.uri.fsPath,
      "file variable resolved for the reviewed command",
    );
    await assert.rejects(
      c.benchmarks.start(c.state.contextId, initial.id, "baseline", false),
      /Review/,
    );
    await assert.rejects(
      c.benchmarks.start(c.state.contextId, initial.id, "candidate", true),
      /baseline/,
    );
    await c.benchmarks.start(c.state.contextId, initial.id, "baseline", true);
    const otherTask = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "Pureobom check success",
    )!;
    await assert.rejects(
      c.checks.start(c.state.contextId, otherTask.id, true),
      /already running/,
    );
    await done();
    assert.equal(
      c.benchmarks.state.status,
      "complete",
      JSON.stringify(c.benchmarks.state),
    );
    const baseline = c.benchmarks.state.baseline!;
    assert.equal(baseline.result.samples.length, 7);
    assert.equal(baseline.check, undefined, "no invented test proof");
    assert.equal(
      c.state.benchmark?.baseline?.sourceSha256,
      baseline.sourceSha256,
    );
    reports.push(
      "measurement: real process task, variable resolution, review required, missing baseline rejected, checks cannot overlap, seven elapsed/peak-memory samples published",
    );

    await replace("// bench-slow\n" + original, false);
    await assert.rejects(prepare(), /unsaved/);
    assert.equal(doc.isDirty, true, "measurement does not save code");
    await doc.save();
    await c.setDocument(doc);
    await ready();
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(
      c.benchmarks.state.invalidReason,
      undefined,
      "target edit between phases preserves baseline",
    );
    const checkTask = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "Pureobom check success",
    )!;
    await c.checks.start(c.state.contextId, checkTask.id, true);
    await until(
      () => c.checks.result?.status === "passed",
      "project check before candidate",
    );
    const candidate = await prepare();
    await c.benchmarks.start(
      c.state.contextId,
      candidate.id,
      "candidate",
      true,
    );
    await done();
    assert.equal(
      c.benchmarks.state.status,
      "complete",
      JSON.stringify(c.benchmarks.state),
    );
    assert.ok(
      c.benchmarks.state.candidate?.check,
      "captures the actual successful project check",
    );
    const compared = compareBenchmarks(
      baseline.result,
      c.benchmarks.state.candidate!.result,
    );
    assert.equal(compared.outputsMatch, true);
    assert.ok(
      compared.timeChangePercent !== null,
      "reports the measured change without asserting hardware-dependent timing",
    );
    assert.equal(c.benchmarks.report().candidate?.result.samples.length, 7);
    reports.push(
      "measurement: unsaved code blocked; saved target edit preserves baseline; actual project-check evidence and seven candidate samples exported with matching output",
    );

    await replace("// bench-output\n" + original);
    assert.equal(c.benchmarks.state.candidateStale, true);
    const different = await prepare();
    await c.benchmarks.start(
      c.state.contextId,
      different.id,
      "candidate",
      true,
    );
    await done();
    assert.equal(
      c.benchmarks.state.status,
      "complete",
      JSON.stringify(c.benchmarks.state),
    );
    assert.equal(c.benchmarks.report().comparison?.outputsMatch, false);
    assert.equal(c.benchmarks.report().comparison?.timeChangePercent, null);
    reports.push(
      "measurement: later target edit marks candidate stale; changed stdout prevents an improvement percentage",
    );

    const cancelling = await prepare("Pureobom check cancel");
    await c.benchmarks.start(
      c.state.contextId,
      cancelling.id,
      "baseline",
      true,
    );
    c.benchmarks.cancel();
    await done();
    assert.equal(c.benchmarks.state.status, "cancelled");
    assert.equal(c.benchmarks.state.baseline, undefined);
    const retry = await prepare();
    await c.benchmarks.start(c.state.contextId, retry.id, "baseline", true);
    await done();
    assert.equal(
      c.benchmarks.state.status,
      "complete",
      JSON.stringify(c.benchmarks.state),
    );
    const helper = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(root, "helper.ts"),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      helper.uri,
      new vscode.Position(0, 0),
      "// benchmark dependency changed\n",
    );
    await vscode.workspace.applyEdit(edit);
    assert.ok(c.benchmarks.state.invalidReason);
    await vscode.window.showTextDocument(helper);
    await vscode.commands.executeCommand("undo");
    await vscode.window.showTextDocument(doc);
    await c.setDocument(doc);
    await ready();
    const invalid = await prepare();
    await assert.rejects(
      c.benchmarks.start(c.state.contextId, invalid.id, "candidate", true),
      /baseline/,
    );
    reports.push(
      "measurement: immediate cancellation rejects partial results and permits retry; another file edit invalidates comparison even after undo",
    );

    const stale = await prepare();
    await replace(original);
    await assert.rejects(
      c.benchmarks.start(c.state.contextId, stale.id, "baseline", true),
      /again/,
    );
    const failing = await prepare("Pureobom check failure");
    await c.benchmarks.start(c.state.contextId, failing.id, "baseline", true);
    await done();
    assert.equal(c.benchmarks.state.status, "failed");
    assert.match(c.benchmarks.state.error!, /exited 7/);
    assert.equal(c.benchmarks.state.baseline, undefined);
    reports.push(
      "measurement: stale prepared command cannot run; actual exit 7 is a failure without a fabricated baseline",
    );
  } catch (error) {
    console.error(
      "Benchmark integration failed",
      String(error),
      JSON.stringify(c.benchmarks.state),
      reports,
    );
    throw error;
  } finally {
    await replace(original);
  }
}
