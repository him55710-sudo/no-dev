import { describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { CodexAppServer } from "../extension/src/agent/appServer";
function client(scenario: string) {
  return new CodexAppServer({
    executable: process.execPath,
    cwd: process.cwd(),
    args: [resolve("tests/fixtures/app-server.cjs"), scenario],
    // Includes cold Windows PowerShell/.NET startup. Turn-budget assertions below
    // still use their explicit 500/1000ms clocks after protocol initialization.
    requestTimeoutMs: 15000,
  });
}
describe("Codex App Server protocol", { timeout: 45000 }, () => {
  it("uses read-only turns and a structured response contract for project explanations", async () => {
    const server = client("read-only");
    let received: Record<string, unknown> | undefined;
    server.onEvent((event) => {
      if (event.method === "fixture/readOnly") received = event.params;
    });
    await server.start();
    const outputSchema = {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    };
    await server.run({
      prompt: "한국어 설명",
      signal: new AbortController().signal,
      readOnly: true,
      outputSchema,
    });
    expect(received?.sandboxPolicy).toEqual({ type: "readOnly" });
    expect(received?.outputSchema).toEqual(outputSchema);
    const mismatched = client("early");
    await mismatched.start();
    await expect(
      mismatched.run({
        prompt: "설명",
        signal: new AbortController().signal,
        readOnly: true,
      }),
    ).rejects.toThrow(/실행 제한/);
  });
  it("decodes split UTF-8, redacts identity, and handles terminal events before the response", async () => {
    const server = client("early");
    expect((await server.start()).userAgent).toBe("테스트 protocol");
    expect(await server.account()).toEqual({
      signedIn: true,
      type: "chatgpt",
      requiresOpenaiAuth: true,
    });
    const result = await server.run({
      prompt: "Test",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("completed");
    await expect(server.request("account/read", {})).rejects.toThrow(/닫았/);
  });
  it("never converts a failed turn or widened sandbox into success", async () => {
    for (const scenario of ["failure", "unsafe"]) {
      const server = client(scenario);
      await server.start();
      await expect(
        server.run({ prompt: "Test", signal: new AbortController().signal }),
      ).rejects.toThrow(
        scenario === "failure" ? /Fixture failed/ : /실행 제한/,
      );
    }
  });
  it("declines unhandled approvals and only accepts the exact requested decision", async () => {
    for (const userDecision of [undefined, "accept"] as const) {
      const server = client("approval"),
        decisions: unknown[] = [];
      server.onEvent((event) => {
        if (event.method === "fixture/decision")
          decisions.push(event.params.decision);
      });
      if (userDecision)
        server.onApproval((request) => {
          expect(request.details.command).toBe("node --test");
          server.decide(request.id, userDecision);
        });
      await server.start();
      await server.run({
        prompt: "Test",
        signal: new AbortController().signal,
      });
      expect(decisions).toEqual([userDecision ?? "decline"]);
      expect(() => server.decide("10", "accept")).toThrow(/끝났거나/);
    }
  });
  it("rejects unsupported server calls explicitly", async () => {
    const server = client("unsupported"),
      codes: unknown[] = [];
    server.onEvent((event) => {
      if (event.method === "fixture/unsupported") codes.push(event.params.code);
    });
    await server.start();
    await server.run({ prompt: "Test", signal: new AbortController().signal });
    expect(codes).toEqual([-32601]);
  });
  it("keeps a live turn open while multiple approvals are being reviewed", async () => {
    const server = client("approvals-pending");
    const approvals: string[] = [];
    let ready!: () => void;
    const received = new Promise<void>((resolve) => {
      ready = resolve;
    });
    server.onApproval((request) => {
      approvals.push(request.id);
      if (approvals.length === 2) ready();
    });
    await server.start();
    const run = server.run({
      prompt: "Test",
      signal: new AbortController().signal,
      timeoutMs: 1000,
    });
    void run.catch(() => {});
    try {
      await received;
      await delay(600);
      server.decide(approvals[0], "accept");
      // The second request still pauses the timer. Total review exceeds budget.
      await delay(1200);
      server.decide(approvals[1], "decline");
      expect((await run).status).toBe("completed");
    } finally {
      await server.close();
    }
  });
  it("resumes the remaining execution budget after a decision", async () => {
    const server = client("approval-hang");
    let approve!: (id: string) => void;
    const received = new Promise<string>((resolve) => {
      approve = resolve;
    });
    server.onApproval((request) => approve(request.id));
    await server.start();
    const run = server.run({
      prompt: "Test",
      signal: new AbortController().signal,
      timeoutMs: 500,
    });
    void run.catch(() => {});
    try {
      const id = await received;
      await delay(750);
      server.decide(id, "accept");
      await expect(run).rejects.toThrow(/제한 시간/);
      await expect(server.request("account/read", {})).rejects.toThrow(/닫았/);
    } finally {
      await server.close();
    }
  });
  it("cancels while an approval is paused and rejects a late decision", async () => {
    const server = client("approval-hang"),
      abort = new AbortController();
    let approve!: (id: string) => void;
    const received = new Promise<string>((resolve) => {
      approve = resolve;
    });
    server.onApproval((request) => approve(request.id));
    await server.start();
    const run = server.run({
      prompt: "Test",
      signal: abort.signal,
      timeoutMs: 500,
    });
    void run.catch(() => {});
    const id = await received;
    await delay(750);
    abort.abort();
    await expect(run).rejects.toThrow(/취소/);
    expect(() => server.decide(id, "accept")).toThrow(/끝났거나|닫았/);
  });
  it("does not reset the elapsed execution budget when approval finishes", async () => {
    const server = client("approval-budget");
    let approve!: (id: string) => void;
    const received = new Promise<string>((resolve) => {
      approve = resolve;
    });
    server.onApproval((request) => approve(request.id));
    await server.start();
    const run = server.run({
      prompt: "Test",
      signal: new AbortController().signal,
      timeoutMs: 1000,
    });
    void run.catch(() => {});
    try {
      const id = await received;
      await delay(1200);
      server.decide(id, "accept");
      // The peer executes 600ms before approval and would complete 700ms after.
      // Resetting the 1000ms budget would incorrectly let that completion win.
      await expect(run).rejects.toThrow(/제한 시간/);
    } finally {
      await server.close();
    }
  });
  it("resumes after the server resolves an approval without a client decision", async () => {
    const server = client("approval-resolved");
    let ready!: () => void;
    const received = new Promise<void>((resolve) => {
      ready = resolve;
    });
    server.onApproval(() => ready());
    await server.start();
    const run = server.run({
      prompt: "Test",
      signal: new AbortController().signal,
      timeoutMs: 500,
    });
    void run.catch(() => {});
    try {
      await received;
      await delay(750);
      await server.request("fixture/resolve", {});
      await expect(run).rejects.toThrow(/제한 시간/);
      expect(() => server.decide("10", "accept")).toThrow(/끝났거나|닫았/);
    } finally {
      await server.close();
    }
  });
  it("rejects cancellation received after a terminal frame but before run resolves", async () => {
    const server = client("hang"),
      abort = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    await server.start();
    let settled = false;
    const run = server.run({
      prompt: "Test",
      signal: abort.signal,
      onSession: () => ready(),
    });
    const outcome = run.then(
      (value) => {
        settled = true;
        return { status: "resolved", value } as const;
      },
      (error: Error) => {
        settled = true;
        return { status: "rejected", error } as const;
      },
    );
    let completions = 0;
    let cancelledBeforeSettlement = false;
    // Register after run's own listener: the completion promise is already
    // resolved, but its awaiting continuation has not consumed it yet.
    const remove = server.onEvent(({ method }) => {
      if (method !== "turn/completed") return;
      completions++;
      cancelledBeforeSettlement = !settled;
      abort.abort(Error("구현 작업을 취소했습니다."));
    });
    try {
      await started;
      await server.request("fixture/complete", {});
      const result = await outcome;
      expect(completions).toBe(1);
      expect(cancelledBeforeSettlement).toBe(true);
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.error.message).toMatch(/취소/);
      await expect(server.request("thread/start", {})).rejects.toThrow(/닫았/);
    } finally {
      remove();
      abort.abort();
      await server.close();
      await outcome;
    }
  });
  it("drops buffered events and approvals after cancellation closes the connection", async () => {
    const server = client("hang"),
      abort = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const events: string[] = [],
      approvals: string[] = [];
    server.onEvent(({ method }) => {
      events.push(method);
      if (method === "fixture/cancel") abort.abort();
    });
    server.onApproval(({ id }) => approvals.push(id));
    await server.start();
    const run = server.run({
      prompt: "Test",
      signal: abort.signal,
      onSession: () => ready(),
    });
    const outcome = run.catch((error: Error) => error);
    try {
      await started;
      // Feed one complete transport chunk directly so the OS cannot split the
      // frames and accidentally hide the buffered-after-close regression.
      server["receive"](
        Buffer.from(
          [
            { method: "fixture/cancel", params: {} },
            {
              id: 20,
              method: "item/fileChange/requestApproval",
              params: { threadId: "thread", turnId: "turn", itemId: "late" },
            },
            { method: "item/agentMessage/delta", params: { delta: "late" } },
            {
              method: "turn/completed",
              params: {
                threadId: "thread",
                turn: { id: "turn", status: "completed", error: null },
              },
            },
          ]
            .map((frame) => JSON.stringify(frame) + "\n")
            .join(""),
        ),
      );
      const result = await outcome;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/취소/);
      expect(approvals).toEqual([]);
      expect(events).toEqual(["fixture/cancel"]);
      expect(() => server.decide("20", "accept")).toThrow(/이미 끝났거나/);
    } finally {
      abort.abort();
      await server.close();
      await outcome;
    }
  });
  it("cancels a live turn and closes its process", async () => {
    const server = client("hang"),
      abort = new AbortController();
    await server.start();
    await expect(
      server.run({
        prompt: "Test",
        signal: abort.signal,
        onSession: () => abort.abort(),
      }),
    ).rejects.toThrow();
    await expect(server.request("thread/start", {})).rejects.toThrow(/닫았/);
  });
});
