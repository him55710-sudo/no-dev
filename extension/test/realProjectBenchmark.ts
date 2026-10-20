import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Controller } from "../src/controller";

/** Replay one previously reviewed model edit, using the actual product measurement API. */
export async function realProjectBenchmark(
  c: Controller,
  root: string,
  reportFile: string,
) {
  const uri = vscode.Uri.file(join(root, "src/itsdangerous/encoding.py"));
  const original = await readFile(uri.fsPath, "utf8");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  assert.equal(
    hash(original),
    "6546d4dcaca3a497dc280795fabd49d76fda2a19f68be6441560ffc5b48bcfac",
  );
  const before = "s = s.encode(encoding, errors)",
    after = "return s if isinstance(s, bytes) else s.encode(encoding, errors)";
  assert.equal(original.split(before).length, 2);
  assert.equal(
    hash(original.replace(before, after)),
    "301ca67927dfbfaa6dcd2670f8abdd04d698f7901d5acc573c999ee15c8446c1",
  );
  const xml = reportFile.replace(/\.json$/, ".junit.xml");
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    project: "https://github.com/pallets/itsdangerous",
    commit: "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd",
    vscode: vscode.version,
    kind: "Actual VS Code before/after measurement; replay of one previously reviewed qwen2.5-coder:3b edit; no new inference",
    edit: { before, after },
    adopted: false,
  };
  async function until(check: () => boolean) {
    const end = Date.now() + 120000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(
          `Timed out: ${JSON.stringify({ check: c.checks.result, benchmark: c.benchmarks.state })}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    await c.setDocument(doc);
    await until(() => !c.state.busy && !!c.state.analysis);
    async function testProject() {
      const task = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "itsdangerous pytest",
      )!;
      await c.checks.start(c.state.contextId, task.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      assert.equal(
        c.checks.result?.status,
        "passed",
        JSON.stringify(c.checks.result),
      );
      assert.equal(
        c.checks.result?.stale,
        false,
        JSON.stringify(c.checks.result),
      );
      const attributes = (await readFile(xml, "utf8")).match(
        /<testsuite\b([^>]*)>/,
      )![1];
      const counts = Object.fromEntries(
        ["tests", "failures", "errors", "skipped"].map((key) => [
          key,
          Number(attributes.match(new RegExp(`${key}="([0-9]+)"`))?.[1]),
        ]),
      );
      assert.equal(counts.tests, 297);
      assert.equal(counts.failures, 0);
      assert.equal(counts.errors, 0);
      return counts;
    }
    async function measure(phase: "baseline" | "candidate") {
      const task = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "itsdangerous measure",
      )!;
      const plan = await c.benchmarks.prepare(c.state.contextId, task.id);
      await c.benchmarks.start(c.state.contextId, plan.id, phase, true);
      await until(
        () => !["running", "stopping"].includes(c.benchmarks.state.status),
      );
      assert.equal(
        c.benchmarks.state.status,
        "complete",
        JSON.stringify(c.benchmarks.state),
      );
    }
    report.baselineTests = await testProject();
    await measure("baseline");
    const offset = original.indexOf(before);
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(
          doc.positionAt(offset),
          doc.positionAt(offset + before.length),
        ),
        after,
      ),
    );
    assert.equal(doc.isDirty, true);
    await doc.save();
    await c.setDocument(doc);
    await until(() => !c.state.busy && !!c.state.analysis);
    await new Promise((resolve) => setTimeout(resolve, 500));
    report.candidateTests = await testProject();
    await measure("candidate");
    const measurement = c.benchmarks.report();
    report.measurement = measurement;
    assert.equal(c.benchmarks.report().comparison?.outputsMatch, true);
    assert.ok(
      c.benchmarks.state.baseline?.check && c.benchmarks.state.candidate?.check,
    );
    assert.equal(c.benchmarks.state.invalidReason, undefined);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("undo");
    assert.equal(doc.getText(), original);
    await doc.save();
    await c.setDocument(doc);
    await until(() => !c.state.busy && !!c.state.analysis);
    await new Promise((resolve) => setTimeout(resolve, 500));
    report.restoredTests = await testProject();
    report.originalRestored = (await readFile(uri.fsPath, "utf8")) === original;
    console.log(
      "PUREOBOM PROJECT BENCHMARK PASSED",
      JSON.stringify(measurement.comparison),
    );
  } catch (e) {
    report.error = String(e);
    throw e;
  } finally {
    if ((await readFile(uri.fsPath, "utf8")) !== original)
      await writeFile(uri.fsPath, original);
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    c.dispose();
  }
}
