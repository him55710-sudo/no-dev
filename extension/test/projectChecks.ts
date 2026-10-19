import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { Controller } from "../src/controller";

export async function projectChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  // These are owned integration fixtures. Discard edits left by earlier tests.
  for (const doc of vscode.workspace.textDocuments.filter((d) => d.isDirty)) {
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
  }
  const root = vscode.workspace.workspaceFolders![0].uri;
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, "shipping.ts"),
  );
  const editor = await vscode.window.showTextDocument(
    doc,
    vscode.ViewColumn.One,
  );
  await c.setDocument(doc);
  await ready();
  async function until(check: () => boolean, message: string) {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > 20000)
        throw Error(`Timed out ${message}: ${JSON.stringify(c.checks.result)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async function task(name: string) {
    const tasks = await c.checks.list(c.state.contextId);
    assert.ok(
      tasks.every((item) => !item.name.endsWith("background")),
      "background task excluded",
    );
    const selected = tasks.find((item) => item.name === name);
    assert.ok(
      selected,
      `configured task found: ${name}: ${JSON.stringify(tasks)}`,
    );
    return selected;
  }
  const success = await task("Pureobom check success");
  assert.equal(success.kind, "process");
  assert.ok(success.command.includes("assertion passed"));
  await assert.rejects(
    c.checks.start(c.state.contextId, success.id, false),
    /Review/,
  );
  await assert.rejects(
    c.checks.start(c.state.contextId, "invented-command", true),
    /Refresh/,
  );
  await c.checks.start(c.state.contextId, success.id, true);
  await until(
    () => c.checks.result?.status === "passed",
    "real process exit 0",
  );
  assert.equal(c.checks.result?.exitCode, 0);
  assert.match(c.checks.result!.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(c.checks.result?.stale, false, JSON.stringify(c.checks.result));
  assert.equal(c.state.projectCheck?.id, c.checks.result!.id);
  const terminalConfig = vscode.workspace.getConfiguration(
    "terminal.integrated",
  );
  const oldFont = terminalConfig.inspect<number>("fontSize")?.globalValue;
  const envKey = `env.${process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux"}`;
  const oldEnvironment =
    terminalConfig.inspect<Record<string, string | null>>(envKey)?.globalValue;
  try {
    await terminalConfig.update(
      "fontSize",
      17,
      vscode.ConfigurationTarget.Global,
    );
    assert.equal(
      c.checks.result?.stale,
      false,
      "terminal appearance does not invalidate code checks",
    );
    await terminalConfig.update(
      envKey,
      { ...oldEnvironment, PUREOBOM_CHECK_FIXTURE: "1" },
      vscode.ConfigurationTarget.Global,
    );
    await until(
      () => c.checks.result?.stale === true,
      "effective task environment change invalidates check",
    );
  } finally {
    await terminalConfig.update(
      "fontSize",
      oldFont,
      vscode.ConfigurationTarget.Global,
    );
    await terminalConfig.update(
      envKey,
      oldEnvironment,
      vscode.ConfigurationTarget.Global,
    );
  }
  reports.push(
    "project check: configured process runs in VS Code; review and known task ID required; real exit 0 and saved-file SHA-256 recorded",
  );

  const failure = await task("Pureobom check failure");
  await c.checks.start(c.state.contextId, failure.id, true);
  await until(() => c.checks.result?.status === "failed", "exit 7 failure");
  assert.equal(c.checks.result?.exitCode, 7);
  reports.push(
    "project check: actual nonzero exit 7 is a failure, never a pass",
  );

  await editor.edit((edit) =>
    edit.insert(new vscode.Position(0, 0), "// unsaved\n"),
  );
  await ready();
  const blocked = await task("Pureobom check success");
  await assert.rejects(
    c.checks.start(c.state.contextId, blocked.id, true),
    /unsaved/,
  );
  assert.equal(doc.isDirty, true, "must not automatically save");
  // A task may leave the terminal focused; route the native undo to this file.
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
  await vscode.commands.executeCommand("undo");
  await ready();
  assert.equal(doc.isDirty, false);
  const delayed = await task("Pureobom check delayed");
  await c.checks.start(c.state.contextId, delayed.id, true);
  await assert.rejects(
    c.checks.start(c.state.contextId, delayed.id, true),
    /already running/,
  );
  const helper = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(root, "helper.ts"),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.insert(helper.uri, new vscode.Position(0, 0), "// dependency changed\n");
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await until(
    () => c.checks.result?.stale === true,
    "unsaved dependency invalidation",
  );
  await until(
    () => c.checks.result?.status === "passed",
    "delayed process exit",
  );
  assert.equal(
    c.checks.result?.stale,
    true,
    "exit 0 must not clear stale state",
  );
  const helperEditor = await vscode.window.showTextDocument(helper);
  await vscode.commands.executeCommand("undo");
  assert.equal(helperEditor.document.isDirty, false);
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await c.setDocument(doc);
  await ready();
  reports.push(
    "project check: unsaved edits block execution without saving; concurrent run rejected; a different file edit invalidates an otherwise successful result",
  );

  const cancel = await task("Pureobom check cancel");
  await c.checks.start(c.state.contextId, cancel.id, true);
  c.checks.cancel();
  await until(
    () => c.checks.result?.status === "cancelled",
    "task termination",
  );
  reports.push(
    "project check: explicit cancellation terminates its actual task and is not reported as success",
  );
  const shell = await task("Pureobom check shell");
  assert.equal(shell.kind, "shell");
  await c.checks.start(c.state.contextId, shell.id, true);
  await until(
    () =>
      !["running", "stopping"].includes(c.checks.result?.status || "running"),
    "shell task after cancellation",
  );
  assert.equal(
    c.checks.result?.status,
    "passed",
    JSON.stringify(c.checks.result),
  );
  const outdated = await task("Pureobom check success");
  const configUri = vscode.Uri.joinPath(root, ".vscode/tasks.json");
  const originalConfig = await vscode.workspace.fs.readFile(configUri);
  try {
    const config = JSON.parse(Buffer.from(originalConfig).toString());
    config.tasks[0].args = ["-e", "process.exit(3)"];
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(JSON.stringify(config)),
    );
    let updated = false;
    const end = Date.now() + 10000;
    while (!updated && Date.now() < end) {
      updated = (await vscode.tasks.fetchTasks()).some(
        (item) =>
          item.name === "Pureobom check success" &&
          item.execution instanceof vscode.ProcessExecution &&
          item.execution.args.includes("process.exit(3)"),
      );
      if (!updated) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(updated, "VS Code reloaded the changed task command");
    await assert.rejects(
      c.checks.start(c.state.contextId, outdated.id, true),
      /Refresh/,
    );
    assert.equal(c.checks.result?.id, c.state.projectCheck?.id);
  } finally {
    await vscode.workspace.fs.writeFile(configUri, originalConfig);
    // The next workflow must not race VS Code reloading the restored fixture.
    const deadline = Date.now() + 10000;
    while (true) {
      const configured = vscode.workspace
        .getConfiguration("tasks", root)
        .get<{ label: string; args: string[] }[]>("tasks", []);
      const fetched = await vscode.tasks.fetchTasks();
      if (
        configured.some(
          (t) =>
            t.label === "Pureobom check success" &&
            t.args.some(
              (arg) =>
                typeof arg === "string" && arg.includes("assertion passed"),
            ),
        ) &&
        fetched.some(
          (t) =>
            t.name === "Pureobom check success" &&
            t.execution instanceof vscode.ProcessExecution &&
            t.execution.args.some((arg) => arg.includes("assertion passed")),
        )
      )
        break;
      if (Date.now() > deadline)
        throw Error("Restored tasks fixture did not reload");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  reports.push(
    "project check: shell task works after cancellation; background tasks excluded; changed command rejected until reviewed again",
  );
}
