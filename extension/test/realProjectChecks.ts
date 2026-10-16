import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { Controller } from "../src/controller";

/** Opt-in fixture: explicit known regression, not execution of model-generated code. */
export async function realProjectChecks(
  c: Controller,
  root: string,
  python: string,
  reportFile: string,
) {
  const uri = vscode.Uri.file(join(root, "src/itsdangerous/encoding.py"));
  const original = await readFile(uri.fsPath, "utf8");
  const digest = createHash("sha256").update(original).digest("hex");
  assert.equal(
    digest,
    "6546d4dcaca3a497dc280795fabd49d76fda2a19f68be6441560ffc5b48bcfac",
  );
  const configFolder = join(root, ".vscode"),
    configFile = join(configFolder, "tasks.json");
  const xmlFile = reportFile.replace(/\.json$/, ".junit.xml");
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    kind: "actual VS Code project-check workflow; known regression; no model",
    project: "https://github.com/pallets/itsdangerous",
    commit: "096c8d42545d3b68ea21a4f890fb2b2d8979c0bd",
    vscode: vscode.version,
    sourceSha256: digest,
    command: "python -m pytest -x -q --junitxml=<outside-workspace>",
  };
  let madeFolder = false,
    wroteConfig = false;
  async function until(check: () => boolean) {
    const end = Date.now() + 120000;
    while (!check()) {
      if (Date.now() > end)
        throw Error(
          `Project check timeout: ${JSON.stringify(c.checks.result)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    try {
      await mkdir(configFolder);
      madeFolder = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    await writeFile(
      configFile,
      JSON.stringify(
        {
          version: "2.0.0",
          tasks: [
            {
              label: "itsdangerous pytest",
              type: "process",
              command: python,
              args: ["-m", "pytest", "-x", "-q", `--junitxml=${xmlFile}`],
              options: { cwd: root },
              group: "test",
              problemMatcher: [],
            },
          ],
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    wroteConfig = true;
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    await c.setDocument(doc);
    const ready = () => until(() => !c.state.busy && !!c.state.analysis);
    await ready();
    async function runTask() {
      const choice = (await c.checks.list(c.state.contextId)).find(
        (t) => t.name === "itsdangerous pytest",
      );
      assert.ok(choice);
      await c.checks.start(c.state.contextId, choice.id, true);
      await until(
        () =>
          !["running", "stopping"].includes(
            c.checks.result?.status || "running",
          ),
      );
      const attributes = (await readFile(xmlFile, "utf8")).match(
        /<testsuite\b([^>]*)>/,
      )?.[1];
      assert.ok(attributes);
      const counts = Object.fromEntries(
        ["tests", "failures", "errors", "skipped"].map((key) => [
          key,
          Number(attributes.match(new RegExp(`${key}="([0-9]+)"`))?.[1]),
        ]),
      );
      return { result: c.checks.result, counts };
    }
    const baseline = await runTask();
    report.baseline = baseline;
    assert.equal(baseline.result?.status, "passed");
    assert.equal(baseline.counts.tests, 297);
    assert.equal(baseline.counts.failures, 0);
    const offset = original.indexOf("    return s");
    assert.ok(offset >= 0);
    await editor.edit((builder) =>
      builder.replace(
        new vscode.Range(
          doc.positionAt(offset),
          doc.positionAt(offset + "    return s".length),
        ),
        '    return b""',
      ),
    );
    await ready();
    const choice = (await c.checks.list(c.state.contextId)).find(
      (t) => t.name === "itsdangerous pytest",
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
    assert.ok(regression.counts.failures >= 1);
    await vscode.commands.executeCommand("undo");
    await ready();
    assert.equal(doc.getText(), original);
    assert.ok(await doc.save());
    await ready();
    const restored = await runTask();
    report.restored = restored;
    assert.equal(restored.result?.status, "passed");
    assert.equal(restored.counts.tests, 297);
    assert.equal(await readFile(uri.fsPath, "utf8"), original);
    report.originalRestored = true;
    console.log(
      "PUREOBOM PROJECT CHECKS PASSED",
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
    if ((await readFile(uri.fsPath, "utf8")) !== original)
      await writeFile(uri.fsPath, original);
    if (wroteConfig) await unlink(configFile);
    if (madeFolder) await rmdir(configFolder);
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    c.dispose();
  }
}
