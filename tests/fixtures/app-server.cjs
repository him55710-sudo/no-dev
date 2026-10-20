// A deterministic protocol peer. Real-process handshake is checked separately.
const readline = require("node:readline");
const scenario = process.argv[2];
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const done = (status = "completed") =>
  send({
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: {
        id: "turn",
        status,
        error: status === "failed" ? { message: "Fixture failed" } : null,
      },
    },
  });
let turnRequest;
readline
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      const text = Buffer.from(
        JSON.stringify({
          id: message.id,
          result: { userAgent: "테스트 protocol" },
        }) + "\n",
      );
      // Split within a multi-byte UTF-8 character.
      const split = text.indexOf(Buffer.from("테")) + 1;
      process.stdout.write(text.subarray(0, split));
      setTimeout(() => process.stdout.write(text.subarray(split)), 1);
    } else if (message.method === "account/read")
      send({
        id: message.id,
        result: {
          account: { type: "chatgpt", email: "must-not-leak@example.invalid" },
          requiresOpenaiAuth: true,
        },
      });
    else if (message.method === "thread/start")
      send({
        id: message.id,
        result: {
          thread: { id: "thread" },
          sandbox: {
            type:
              scenario === "unsafe"
                ? "dangerFullAccess"
                : scenario === "read-only"
                  ? "readOnly"
                  : "workspaceWrite",
          },
          approvalPolicy: "on-request",
        },
      });
    else if (message.method === "turn/start") {
      if (scenario === "read-only")
        send({ method: "fixture/readOnly", params: message.params });
      turnRequest = message.id;
      if (scenario === "early") {
        done();
        setTimeout(
          () => send({ id: message.id, result: { turn: { id: "turn" } } }),
          10,
        );
      } else {
        send({ id: message.id, result: { turn: { id: "turn" } } });
        if (scenario === "failure") done("failed");
        else if (
          [
            "approval",
            "approvals-pending",
            "approval-hang",
            "approval-resolved",
            "approval-budget",
          ].includes(scenario)
        ) {
          const ask = () =>
            send({
              id: 10,
              method: "item/commandExecution/requestApproval",
              params: {
                threadId: "thread",
                turnId: "turn",
                itemId: "item",
                command: "node --test",
              },
            });
          if (scenario === "approval-budget") setTimeout(ask, 600);
          else ask();
          if (scenario === "approvals-pending")
            send({
              id: 12,
              method: "item/fileChange/requestApproval",
              params: { threadId: "thread", turnId: "turn", itemId: "file" },
            });
        } else if (scenario === "unsupported")
          send({ id: 11, method: "item/tool/requestUserInput", params: {} });
        else if (scenario !== "hang") done();
      }
    } else if (message.method === "fixture/resolve") {
      send({ id: message.id, result: {} });
      send({ method: "serverRequest/resolved", params: { requestId: 10 } });
    } else if (message.id === 10) {
      send({ method: "fixture/decision", params: message.result });
      if (scenario === "approval-resolved")
        send({ method: "serverRequest/resolved", params: { requestId: 10 } });
      if (scenario === "approval-budget") setTimeout(() => done(), 700);
      else if (!["approvals-pending", "approval-hang"].includes(scenario))
        done();
    } else if (message.id === 12) {
      send({ method: "fixture/decision", params: message.result });
      done();
    } else if (message.id === 11) {
      send({ method: "fixture/unsupported", params: message.error });
      done();
    } else if (message.method === "turn/interrupt") {
      send({ id: message.id, result: {} });
      done("interrupted");
    }
  })
  .on("close", () => process.exit(0));
