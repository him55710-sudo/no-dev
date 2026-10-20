// Explicit fault-injection peer. No model or external service runs here.
// Copied as `app-server` into a disposable clone by test-permission-failure.mjs.
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
const plan = JSON.parse(readFileSync(".pureobom-failure.json", "utf8"));
assert.equal(plan.kind, "pureobom-controlled-missing-server-guards");
assert.ok(
  lstatSync(".git").isFile(),
  "Run only in the isolated implementation worktree",
);
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const reply = (id, result) => send({ id, result });
const finish = (status) =>
  send({
    method: "turn/completed",
    params: { threadId: "fault-thread", turn: { id: "fault-turn", status } },
  });
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "initialize")
      reply(message.id, {
        userAgent: "Pureobom controlled missing-server-guards fixture; NOT AI",
      });
    else if (message.method === "account/read")
      reply(message.id, { account: null, requiresOpenaiAuth: false });
    else if (message.method === "thread/start")
      reply(message.id, {
        thread: { id: "fault-thread" },
        sandbox: { type: "workspaceWrite" },
        approvalPolicy: "on-request",
      });
    else if (message.method === "turn/start") {
      reply(message.id, { turn: { id: "fault-turn" } });
      send({
        id: "fault-files",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "fault-thread",
          turnId: "fault-turn",
          itemId: "fault-files",
          reason:
            "CONTROLLED TEST: copy the recorded candidate into this disposable worktree and omit only the two server-side membership guards. UI and locked tests remain unchanged.",
          grantRoot: process.cwd(),
        },
      });
    } else if (message.id === "fault-files") {
      if (message.result?.decision !== "accept") {
        finish("interrupted");
        return;
      }
      for (const file of plan.files) {
        const target = resolve(file.path),
          rel = relative(process.cwd(), target);
        assert.ok(rel && !rel.startsWith("..") && !rel.startsWith("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.after);
      }
      send({
        method: "item/agentMessage/delta",
        params: {
          delta:
            "Controlled fault kept the recorded UI restrictions but omitted two server guards. Deliberately repeats the fault on the repair attempt; no model ran.",
        },
      });
      finish("completed");
    } else if (message.method === "turn/interrupt") {
      reply(message.id, {});
      finish("interrupted");
    }
  })
  .on("close", () => process.exit(0));
