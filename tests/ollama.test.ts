import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OllamaClient } from "../extension/src/ollama";
import type { AssistantInput } from "../src/core/localAssistant";

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
async function server(
  handler: (req: IncomingMessage, res: ServerResponse, body: any) => void,
) {
  const s = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    handler(req, res, raw ? JSON.parse(raw) : undefined);
  });
  servers.push(s);
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return (s.address() as AddressInfo).port;
}
const input: AssistantInput = {
  source: "fee = 3000\n",
  language: "python",
  lang: "ko",
  task: "explain",
  instruction: "",
};
const model = {
  name: "local:3b",
  digest: "a".repeat(64),
  size: 1900000000,
  details: { format: "gguf" },
};
function reply(res: ServerResponse, value: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}
function fixture(path: string | undefined) {
  if (path === "/api/status") return { cloud: { disabled: true } };
  if (path === "/api/tags") return { models: [model] };
  if (path === "/api/show")
    return {
      details: { format: "gguf" },
      model_info: { "general.architecture": "qwen2" },
      capabilities: ["completion"],
    };
  return {
    done: true,
    done_reason: "stop",
    message: {
      content: JSON.stringify({
        summary: "배송비",
        citations: [{ quote: "fee = 3000", explanation: "값" }],
        edits: [],
        risks: [],
        checks: [],
      }),
    },
  };
}
describe("Ollama loopback protocol (controlled HTTP fixture, not real inference)", () => {
  it("checks local-only mode and model metadata before sending only the explicit file", async () => {
    const seen: { route?: string; body: any }[] = [];
    const port = await server((req, res, body) => {
      seen.push({ route: req.url, body });
      reply(res, fixture(req.url));
    });
    const result = await new OllamaClient(port).generate(model.name, input);
    expect(seen.map((s) => s.route)).toEqual([
      "/api/status",
      "/api/tags",
      "/api/show",
      "/api/status",
      "/api/chat",
    ]);
    expect(result.proposal.citations[0].line).toBe(1);
    const chat = seen.at(-1)!.body;
    expect(JSON.parse(chat.messages[1].content).source).toBe(input.source);
    expect(chat).not.toHaveProperty("tools");
    expect(chat).not.toHaveProperty("api_key");
    expect(chat.stream).toBe(false);
  });
  it("rejects enabled cloud before source transmission", async () => {
    const seen: string[] = [];
    const port = await server((req, res) => {
      seen.push(req.url!);
      reply(res, { cloud: { disabled: false } });
    });
    await expect(
      new OllamaClient(port).generate(model.name, input),
    ).rejects.toThrow(/OLLAMA_NO_CLOUD/);
    expect(seen).toEqual(["/api/status"]);
  });
  it("filters cloud aliases and rejects remote metadata before chat", async () => {
    let chat = false;
    const port = await server((req, res) => {
      if (req.url === "/api/chat") chat = true;
      reply(
        res,
        req.url === "/api/tags"
          ? {
              models: [
                model,
                { ...model, name: "x:cloud" },
                { ...model, name: "alias", remote_host: "https://ollama.com" },
              ],
            }
          : req.url === "/api/show"
            ? { ...fixture(req.url), remote_model: "upstream" }
            : fixture(req.url),
      );
    });
    expect(await new OllamaClient(port).models()).toEqual([
      { name: model.name, digest: model.digest, size: model.size },
    ]);
    await expect(
      new OllamaClient(port).generate(model.name, input),
    ).rejects.toThrow(/local text model/);
    expect(chat).toBe(false);
  });
  it("does not follow redirects", async () => {
    const port = await server((_req, res) => {
      res.writeHead(302, { Location: "http://example.com/" });
      res.end();
    });
    await expect(new OllamaClient(port).models()).rejects.toThrow(/302/);
  });
  it("handles cancellation, timeout and oversized responses", async () => {
    const port = await server((req, res) => {
      if (req.url !== "/api/chat") reply(res, fixture(req.url));
    });
    const controller = new AbortController();
    const pending = new OllamaClient(port).generate(
      model.name,
      input,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow(/cancelled/);
    await expect(
      new OllamaClient(port, 30).generate(model.name, input),
    ).rejects.toThrow(/timed out/);
    const big = await server((_req, res) =>
      res.end(" ".repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(new OllamaClient(big).models()).rejects.toThrow(/2MB/);
  });
  it("rejects partial or tool-bearing completions", async () => {
    const port = await server((req, res) =>
      reply(
        res,
        req.url === "/api/chat"
          ? { ...fixture(req.url), done_reason: "length" }
          : fixture(req.url),
      ),
    );
    await expect(
      new OllamaClient(port).generate(model.name, input),
    ).rejects.toThrow(/Incomplete/);
  });
});
