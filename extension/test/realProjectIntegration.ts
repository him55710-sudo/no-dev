import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Controller } from "../src/controller";
const exec = promisify(execFile);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function ready(c: Controller) {
  const deadline = Date.now() + 25000;
  while (c.state.busy || !c.state.analysis) {
    if (Date.now() > deadline) throw Error("Analysis timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Explicit developer integration against the disposable, pinned public repository.
// The model cannot choose paths, commands, interpreter or test arguments.
export async function run() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const file = join(root, "src", "itsdangerous", "encoding.py");
  const python = process.env.PUREOBOM_PROJECT_PYTHON!;
  const reportFile = process.env.PUREOBOM_PROJECT_REPORT!;
  const original = await readFile(file, "utf8");
  const pytest = async () => {
    const result = await exec(python, ["-m", "pytest", "-q"], {
      cwd: root,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 2000000,
    });
    return {
      command: "python -m pytest -q",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    kind: "actual Ollama + actual VS Code + external project tests",
    project: "https://github.com/pallets/itsdangerous",
    commit: (
      await exec("git", ["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim(),
    file: "src/itsdangerous/encoding.py",
    sourceSha256: hash(original),
    vscode: vscode.version,
  };
  const extension = vscode.extensions.getExtension<{
    controller: Controller;
    openPanel: () => Promise<void>;
  }>("pureobom-local.pureobom")!;
  const api = await extension.activate(),
    c = api.controller;
  const config = vscode.workspace.getConfiguration("pureobom"),
    oldPort = config.inspect<number>("ollamaPort")?.globalValue;
  let doc: vscode.TextDocument | undefined;
  try {
    report.baseline = await pytest();
    await config.update(
      "ollamaPort",
      Number(process.env.PUREOBOM_PROJECT_PORT || "11435"),
      vscode.ConfigurationTarget.Global,
    );
    doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await api.openPanel();
    await c.setDocument(doc);
    await ready(c);
    const instruction =
      "want_bytes 함수에서 중간 변수 재할당 없이 입력이 문자열이면 인코딩한 바이트를 바로 반환하고, 바이트 입력이면 기존 객체를 그대로 반환하도록 고쳐줘. 인코딩·오류 처리의 의미와 나머지 코드는 그대로 유지해 줘. 속도 향상은 측정 전이므로 주장하지 마.";
    report.instruction = instruction;
    const result = await c.assistant.generate(c.state.contextId, {
      model: process.env.PUREOBOM_PROJECT_MODEL || "qwen2.5-coder:3b",
      task: "optimize",
      lang: "ko",
      instruction,
    });
    report.proposal = result;
    assert.ok(
      result.edits.length,
      "real model must propose a change for this case",
    );
    assert.equal(result.validation.status, "syntax-passed");
    await c.assistant.source(result.id, c.state.contextId, 0);
    assert.equal(
      doc.getText(vscode.window.activeTextEditor!.selection),
      result.citations[0].quote,
    );
    const preview = await c.assistant.preview(result.id, c.state.contextId);
    const candidate = (
      await vscode.workspace.openTextDocument(vscode.Uri.parse(preview.after))
    ).getText();
    assert.equal(doc.getText(), original, "preview preserves original source");
    await c.assistant.apply(result.id, c.state.contextId, true);
    await ready(c);
    assert.equal(doc.getText(), candidate);
    assert.equal(
      await readFile(file, "utf8"),
      original,
      "apply does not save implicitly",
    );
    assert.ok(await doc.save());
    report.candidateSha256 = hash(candidate);
    report.after = await pytest();
    await vscode.commands.executeCommand("undo");
    await ready(c);
    assert.equal(doc.getText(), original, "single undo restores source");
    assert.ok(await doc.save());
    assert.equal(await readFile(file, "utf8"), original);
    report.checks = [
      "real local model response",
      "exact source citation selected",
      "native diff reviewed",
      "isolated Python ast.parse passed",
      "actual editor apply",
      "before/after project tests passed",
      "native undo and save restored original file",
    ];
    report.restored = true;
    report.performance =
      "Not measured; no speedup claim. The requested rewrite removes one assignment but this test does not prove optimization benefit.";
    console.log(
      "PUREOBOM REAL PROJECT PASSED",
      JSON.stringify({
        model: result.model,
        elapsedMs: result.elapsedMs,
        edits: result.edits.length,
      }),
    );
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    // Runner restricts the workspace to our disposable test-results clone.
    if ((await readFile(file, "utf8")) !== original)
      await writeFile(file, original);
    await config.update(
      "ollamaPort",
      oldPort,
      vscode.ConfigurationTarget.Global,
    );
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    c.dispose();
  }
}
