// Explicit opt-in: one real-model terminal invocation in a disposable fixture.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { build } from "esbuild";
if (process.env.PUREOBOM_RUN_CODEX !== "1")
  throw Error("Set PUREOBOM_RUN_CODEX=1 for this real-model integration test.");
await mkdir("test-results/process-scope-live", { recursive: true });
const root = await mkdtemp(resolve("test-results/process-scope-live/run-"));
const bundle = resolve(root, "adapter.mjs");
await build({
  entryPoints: ["extension/src/agent/appServer.ts"],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});
const { CodexAppServer } = await import(pathToFileURL(bundle).href);
const server = new CodexAppServer({
  executable: process.env.PUREOBOM_CODEX_PATH || "codex",
  cwd: root,
});
const commands = [],
  approvals = [];
const input = createInterface({ input: process.stdin, output: process.stdout });
server.onApproval((request) => {
  approvals.push({
    id: request.id,
    kind: request.kind,
    details: request.details,
  });
  console.log(JSON.stringify({ approval: request }));
  console.log(
    `Review the command, then enter: accept ${request.id} (or decline ${request.id})`,
  );
});
input.on("line", (line) => {
  const match = /^(accept|decline) (.+)$/.exec(line.trim());
  if (match) server.decide(match[2], match[1]);
});
server.onEvent((event) => {
  const item = event.params.item;
  if (event.method === "item/completed" && item?.type === "commandExecution") {
    commands.push({
      command: item.command,
      exitCode: item.exitCode,
      output:
        typeof item.aggregatedOutput === "string"
          ? item.aggregatedOutput.slice(-2000)
          : undefined,
    });
    console.log(JSON.stringify({ command: commands.at(-1) }));
  }
});
try {
  const connection = await server.start();
  const account = await server.account();
  assert(account.signedIn || !account.requiresOpenaiAuth);
  console.log(JSON.stringify({ root, connected: true }));
  const turn = await server.run({
    prompt: `This directory is an isolated integration fixture. Use one terminal command to run the installed Node executable at ${JSON.stringify(process.execPath)} and create scope-proof.json containing exactly {"ok":true}. Use Node's filesystem API. Do not use a patch/file-edit tool. Do not read unrelated files or directories, install packages, use the network, or start background services. Report completion after the command succeeds.`,
    signal: new AbortController().signal,
    timeoutMs: 180000,
  });
  assert.equal(turn.status, "completed");
  assert(
    commands.some((command) => command.exitCode === 0),
    "Real command execution must be observed",
  );
  const proof = JSON.parse(
    await readFile(resolve(root, "scope-proof.json"), "utf8"),
  );
  assert.deepEqual(proof, { ok: true });
  const report = {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    userAgent: connection.userAgent,
    inferenceRun: true,
    commands,
    approvals,
    proof,
    scope:
      "Actual Codex terminal execution inside a Windows job; not full product or recovery verification.",
  };
  await writeFile(
    "test-results/process-scope-live.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      success: true,
      report: "test-results/process-scope-live.json",
    }),
  );
} finally {
  await server.close();
  input.close();
}
