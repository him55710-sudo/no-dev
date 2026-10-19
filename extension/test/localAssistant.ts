import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Controller } from "../src/controller";

/** Actual VS Code editor integration; Ollama HTTP responses are controlled fixtures. */
export async function localAssistantChecks(
  c: Controller,
  ready: () => Promise<void>,
  reports: string[],
) {
  let mode:
      | "normal"
      | "hold"
      | "invalid"
      | "go-valid"
      | "go-invalid"
      | "csharp-valid"
      | "csharp-invalid"
      | "java-valid"
      | "java-invalid"
      | "sql-valid"
      | "sql-invalid" = "normal",
    chatSeen = false;
  const model = {
    name: "fixture:local",
    size: 1900000000,
    digest: "a".repeat(64),
    details: { format: "gguf" },
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString(),
      body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/status") {
      res.end(JSON.stringify({ cloud: { disabled: true } }));
      return;
    }
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [model] }));
      return;
    }
    if (req.url === "/api/show") {
      res.end(
        JSON.stringify({
          details: { format: "gguf" },
          model_info: { "general.architecture": "fixture" },
          capabilities: ["completion"],
        }),
      );
      return;
    }
    chatSeen = true;
    if (mode === "hold") return;
    const input = JSON.parse(body.messages[1].content);
    const quote = mode.startsWith("sql-")
      ? "3000"
      : mode === "invalid"
        ? "const fee = 3000;"
        : "fee = 3000";
    assert.ok(input.source.includes(quote));
    const edits = mode.startsWith("sql-")
      ? [
          {
            before: quote,
            after: mode === "sql-valid" ? "4000" : ")",
            reason: "SQLite 문법 검증용 변경",
          },
        ]
      : mode.startsWith("go-") ||
          mode.startsWith("java-") ||
          mode.startsWith("csharp-")
        ? [
            {
              before: quote,
              after: mode.endsWith("-invalid") ? "fee = " : "fee = 4000",
              reason: "언어별 문법 검증용 변경",
            },
          ]
        : mode === "invalid"
          ? [
              {
                before: quote,
                after: "const fee = ;",
                reason: "문법 오류 검증용",
              },
            ]
          : [
              {
                before: "fee = 3000",
                after: "fee = 4000",
                reason: "배송비 변경",
              },
              {
                before: "threshold = 50000",
                after: "threshold = 70000",
                reason: "기준 변경",
              },
            ];
    const citations = edits.map((edit) => ({
      quote: edit.before,
      explanation: "변경 지점의 원문",
    }));
    res.end(
      JSON.stringify({
        done: true,
        done_reason: "stop",
        message: {
          content: JSON.stringify({
            summary: "검증용 제안",
            citations,
            edits,
            risks: [],
            checks: ["실제 프로젝트 테스트 필요"],
          }),
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = vscode.workspace.getConfiguration("pureobom"),
    oldPort = config.inspect<number>("ollamaPort")?.globalValue,
    oldJavaHome = config.inspect<string>("analysisJavaHome")?.globalValue;
  await config.update(
    "ollamaPort",
    (server.address() as AddressInfo).port,
    vscode.ConfigurationTarget.Global,
  );
  const source = "# Python fixture\nfee = 3000\nthreshold = 50000\n";
  const root = vscode.workspace.workspaceFolders![0].uri;
  const uri = vscode.Uri.joinPath(root, "local-assistant-fixture.py");
  await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await c.setDocument(doc);
    await ready();
    assert.equal(c.state.language, "python");
    assert.equal(c.state.analysis!.kind, "script");
    assert.ok(
      c.state.analysis!.python?.version,
      "Python uses its own installed AST parser",
    );
    assert.deepEqual(
      c.state.analysis!.rules.map(({ name, raw, syntax }) => ({
        name,
        raw,
        syntax,
      })),
      [
        { name: "fee", raw: "3000", syntax: "python" },
        { name: "threshold", raw: "50000", syntax: "python" },
      ],
    );
    const payload = {
      model: model.name,
      task: "edit",
      lang: "ko",
      instruction: "배송비와 기준을 바꿔줘",
    };
    const result = await c.assistant.generate(c.state.contextId, payload);
    assert.ok(
      ["syntax-passed", "unavailable"].includes(result.validation.status),
      "Python syntax is checked when the local interpreter is available",
    );
    assert.equal(
      doc.getText(),
      source,
      "generation must not modify the editor",
    );
    await c.assistant.source(result.id, c.state.contextId, 0);
    assert.equal(
      doc.getText(vscode.window.activeTextEditor!.selection),
      "fee = 3000",
    );
    await assert.rejects(
      () => c.assistant.apply(result.id, c.state.contextId, true),
      /diff first/,
    );
    const preview = await c.assistant.preview(result.id, c.state.contextId);
    const after = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(preview.after),
    );
    assert.ok(after.getText().includes("fee = 4000\nthreshold = 70000"));
    assert.ok(preview.after.endsWith(".py"));
    await assert.rejects(
      () => c.assistant.apply(result.id, c.state.contextId, false),
      /Acknowledge/,
    );
    await c.assistant.apply(result.id, c.state.contextId, true);
    await ready();
    assert.ok(doc.getText().includes("fee = 4000\nthreshold = 70000"));
    assert.equal(
      Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(),
      source,
    );
    await vscode.commands.executeCommand("undo");
    await ready();
    assert.equal(doc.getText(), source, "one undo restores both edit ranges");
    reports.push(
      "local AI controlled fixture: actual Python document, source quote selection, native diff, explicit apply, two-range undo and no implicit save",
    );

    const staleContext = c.state.contextId;
    const stale = await c.assistant.generate(staleContext, payload);
    const editor = await vscode.window.showTextDocument(
      doc,
      vscode.ViewColumn.One,
    );
    await editor.edit((b) =>
      b.insert(new vscode.Position(0, 0), "# intervening edit\n"),
    );
    await ready();
    await assert.rejects(() => c.assistant.preview(stale.id, staleContext));
    await vscode.commands.executeCommand("undo");
    await ready();
    mode = "hold";
    chatSeen = false;
    const cancelled = c.assistant.generate(c.state.contextId, payload);
    // Attach rejection immediately; the document-change event can cancel asynchronously.
    const cancellation = assert.rejects(cancelled, /cancelled|changed/);
    const deadline = Date.now() + 10000;
    while (!chatSeen && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(chatSeen);
    c.assistant.cancel();
    await cancellation;
    assert.equal(doc.getText(), source);
    reports.push(
      "local AI controlled fixture: stale proposal blocked and in-flight request cancelled without changing source",
    );

    mode = "invalid";
    const tsDoc = await vscode.workspace.openTextDocument({
      language: "typescript",
      content: "const fee = 3000;\n",
    });
    await vscode.window.showTextDocument(tsDoc, vscode.ViewColumn.One);
    await c.setDocument(tsDoc);
    await ready();
    const invalid = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(invalid.validation.status, "syntax-failed");
    await c.assistant.preview(invalid.id, c.state.contextId);
    await assert.rejects(
      () => c.assistant.apply(invalid.id, c.state.contextId, true),
      /syntax-invalid/,
    );
    assert.equal(tsDoc.getText(), "const fee = 3000;\n");
    reports.push(
      "local AI controlled fixture: malformed TypeScript proposal remains reviewable but cannot be applied",
    );

    const goDoc = await vscode.workspace.openTextDocument({
      language: "go",
      content: "package sample\nconst fee = 3000\n",
    });
    await vscode.window.showTextDocument(goDoc, vscode.ViewColumn.One);
    await c.setDocument(goDoc);
    await ready();
    assert.ok(c.state.analysis!.go);
    mode = "go-valid";
    const validGo = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(validGo.validation.status, "syntax-passed");
    assert.match(
      validGo.validation.detail,
      /types, ranges, behavior and performance unchecked/,
    );
    mode = "go-invalid";
    const invalidGo = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(invalidGo.validation.status, "syntax-failed");
    const goPreview = await c.assistant.preview(
      invalidGo.id,
      c.state.contextId,
    );
    assert.ok(goPreview.after.endsWith(".go"));
    await assert.rejects(
      () => c.assistant.apply(invalidGo.id, c.state.contextId, true),
      /syntax-invalid/,
    );
    assert.equal(goDoc.getText(), "package sample\nconst fee = 3000\n");
    reports.push(
      "local AI controlled fixture: actual Go parser accepts valid syntax, rejects a malformed proposal, preserves native Go diff and blocks invalid apply without claiming type checks",
    );
    await config.update(
      "analysisJavaHome",
      process.env.PUREOBOM_TEST_JAVA_HOME || process.env.JAVA_HOME || "",
      vscode.ConfigurationTarget.Global,
    );
    const javaDoc = await vscode.workspace.openTextDocument({
      language: "java",
      content: "class Sample { int fee = 3000; }\n",
    });
    await vscode.window.showTextDocument(javaDoc, vscode.ViewColumn.One);
    await c.setDocument(javaDoc);
    await ready();
    assert.ok(c.state.analysis!.java);
    mode = "java-valid";
    const validJava = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(validJava.validation.status, "syntax-passed");
    assert.match(
      validJava.validation.detail,
      /types, dependencies, behavior and performance unchecked/,
    );
    mode = "java-invalid";
    const invalidJava = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(invalidJava.validation.status, "syntax-failed");
    const javaPreview = await c.assistant.preview(
      invalidJava.id,
      c.state.contextId,
    );
    assert.ok(javaPreview.after.endsWith(".java"));
    await assert.rejects(
      () => c.assistant.apply(invalidJava.id, c.state.contextId, true),
      /syntax-invalid/,
    );
    assert.equal(javaDoc.getText(), "class Sample { int fee = 3000; }\n");
    reports.push(
      "local AI controlled fixture: actual Java parser accepts valid syntax, rejects a malformed proposal, preserves native Java diff and blocks invalid apply without claiming type or dependency checks",
    );
    const previousDotnet =
      config.inspect<string>("analysisDotnet")?.globalValue;
    await config.update(
      "analysisDotnet",
      process.env.PUREOBOM_TEST_DOTNET || "",
      vscode.ConfigurationTarget.Global,
    );
    try {
      const csharpDoc = await vscode.workspace.openTextDocument({
        language: "csharp",
        content: "class Sample { int fee = 3000; }\n",
      });
      await vscode.window.showTextDocument(csharpDoc, vscode.ViewColumn.One);
      await c.setDocument(csharpDoc);
      await ready();
      assert.ok(c.state.analysis!.csharp);
      mode = "csharp-valid";
      const validCSharp = await c.assistant.generate(
        c.state.contextId,
        payload,
      );
      assert.equal(validCSharp.validation.status, "syntax-passed");
      assert.match(
        validCSharp.validation.detail,
        /types, dependencies, behavior and performance unchecked/,
      );
      mode = "csharp-invalid";
      const invalidCSharp = await c.assistant.generate(
        c.state.contextId,
        payload,
      );
      assert.equal(invalidCSharp.validation.status, "syntax-failed");
      const csharpPreview = await c.assistant.preview(
        invalidCSharp.id,
        c.state.contextId,
      );
      assert.ok(csharpPreview.after.endsWith(".cs"));
      await assert.rejects(
        () => c.assistant.apply(invalidCSharp.id, c.state.contextId, true),
        /syntax-invalid/,
      );
      assert.equal(csharpDoc.getText(), "class Sample { int fee = 3000; }\n");
      reports.push(
        "local AI controlled fixture: actual C# parser accepts valid syntax, rejects a malformed proposal, preserves native C# diff and blocks invalid apply without claiming type or dependency checks",
      );
    } finally {
      await config.update(
        "analysisDotnet",
        previousDotnet,
        vscode.ConfigurationTarget.Global,
      );
    }
    const sqlDoc = await vscode.workspace.openTextDocument({
      language: "sql",
      content: "SELECT 3000 AS fee;",
    });
    await vscode.window.showTextDocument(sqlDoc, vscode.ViewColumn.One);
    await c.setDocument(sqlDoc);
    await ready();
    mode = "sql-valid";
    const unspecified = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(unspecified.validation.status, "unavailable");
    await c.setSqlDialect(c.state.contextId, "sqlite");
    await ready();
    const validSql = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(validSql.validation.status, "syntax-passed");
    assert.match(
      validSql.validation.detail,
      /results and performance unchecked/,
    );
    mode = "sql-invalid";
    const invalidSql = await c.assistant.generate(c.state.contextId, payload);
    assert.equal(invalidSql.validation.status, "syntax-failed");
    const sqlPreview = await c.assistant.preview(
      invalidSql.id,
      c.state.contextId,
    );
    assert.ok(sqlPreview.after.endsWith(".sql"));
    await assert.rejects(
      c.assistant.apply(invalidSql.id, c.state.contextId, true),
      /syntax-invalid/,
    );
    assert.equal(sqlDoc.getText(), "SELECT 3000 AS fee;");
    reports.push(
      "local AI controlled fixture: unspecified SQL remains unchecked, explicitly selected SQLite parses a valid proposal, rejects malformed SQL, preserves SQL diff and blocks invalid apply",
    );
  } finally {
    c.assistant.cancel();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await config.update(
      "ollamaPort",
      oldPort,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "analysisJavaHome",
      oldJavaHome,
      vscode.ConfigurationTarget.Global,
    );
  }
}
