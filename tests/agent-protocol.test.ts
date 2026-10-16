import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CodexAppServer } from "../extension/src/agent/appServer";
function client(scenario: string) {
  return new CodexAppServer({
    executable: process.execPath,
    cwd: process.cwd(),
    args: [resolve("tests/fixtures/app-server.cjs"), scenario],
    requestTimeoutMs: 2000,
  });
}
describe("Codex App Server protocol", () => {
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
  it("cancels a live turn and closes its process; a late success cannot revive it", async () => {
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
