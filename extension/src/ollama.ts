import { request as httpRequest } from "node:http";
import {
  assistantMessages,
  assistantContextSize,
  assistantLimits,
  assistantSchema,
  parseAssistantProposal,
  validateAssistantInput,
  type AssistantInput,
} from "../../src/core/localAssistant";

export type LocalModel = { name: string; digest: string; size: number };
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const localName = (s: unknown): s is string =>
  typeof s === "string" &&
  s.length <= 200 &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(s) &&
  !/cloud|https?:|@/i.test(s);

/** Node's direct HTTP client: fixed numeric loopback, no proxy discovery or redirects. */
export class OllamaClient {
  readonly origin: string;
  constructor(
    readonly port = 11434,
    private timeoutMs = 180000,
  ) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw Error("Invalid local Ollama port");
    this.origin = `http://127.0.0.1:${port}`;
  }
  private json(
    route: string,
    body: unknown,
    signal?: AbortSignal,
    timeout = this.timeoutMs,
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Error("요청을 취소했습니다. / Request cancelled."));
        return;
      }
      let settled = false;
      const bytes =
        body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const done = (error?: Error, value?: Record<string, any>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        error ? reject(error) : resolve(value!);
      };
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: this.port,
          path: route,
          method: bytes ? "POST" : "GET",
          agent: false,
          headers: {
            Accept: "application/json",
            ...(bytes
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": bytes.length,
                }
              : {}),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.destroy();
            done(
              Error(
                `Ollama HTTP ${res.statusCode}. 로컬 전용 설정과 모델을 확인하세요. / Check local-only mode and the installed model.`,
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > 2 * 1024 * 1024) {
              done(
                Error(
                  "Ollama 응답이 너무 큽니다. / Ollama response exceeds 2MB.",
                ),
              );
              res.destroy();
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (!value || typeof value !== "object" || Array.isArray(value))
                throw Error();
              done(undefined, value);
            } catch {
              done(
                Error(
                  "Ollama의 응답을 읽을 수 없습니다. / Invalid Ollama JSON response.",
                ),
              );
            }
          });
          res.on("error", () =>
            done(
              Error(
                "Ollama 연결이 끊겼습니다. / Ollama connection interrupted.",
              ),
            ),
          );
        },
      );
      const cancel = () => {
        done(Error("요청을 취소했습니다. / Request cancelled."));
        req.destroy();
      };
      const timer = setTimeout(() => {
        done(
          Error(
            "로컬 모델 응답 시간이 초과되었습니다. / Local model request timed out.",
          ),
        );
        req.destroy();
      }, timeout);
      signal?.addEventListener("abort", cancel, { once: true });
      req.on("error", () =>
        done(
          Error(
            "Ollama에 연결할 수 없습니다. 로컬 서버를 실행하세요. / Cannot connect to Ollama. Start the local server.",
          ),
        ),
      );
      req.end(bytes);
    });
  }
  private async localOnly(signal?: AbortSignal) {
    const status = await this.json("/api/status", undefined, signal, 5000);
    if (object(status.cloud).disabled !== true)
      throw Error(
        "Ollama를 OLLAMA_NO_CLOUD=1로 실행하고 다시 연결하세요. / Start Ollama with OLLAMA_NO_CLOUD=1 and reconnect.",
      );
  }
  async models(signal?: AbortSignal): Promise<LocalModel[]> {
    await this.localOnly(signal);
    const result = await this.json("/api/tags", undefined, signal, 5000);
    if (!Array.isArray(result.models)) throw Error("Invalid Ollama model list");
    return result.models
      .filter((raw: unknown) => {
        const m = object(raw);
        return (
          localName(m.name) &&
          !m.remote_host &&
          !m.remote_model &&
          typeof m.size === "number" &&
          m.size > 1000000 &&
          typeof m.digest === "string" &&
          /^[a-f0-9]{64}$/i.test(m.digest) &&
          object(m.details).format === "gguf"
        );
      })
      .slice(0, 100)
      .map((m: LocalModel) => ({
        name: m.name,
        digest: m.digest,
        size: m.size,
      }));
  }
  async generate(
    modelName: string,
    input: AssistantInput,
    signal?: AbortSignal,
  ) {
    validateAssistantInput(input);
    if (!localName(modelName))
      throw Error(
        "설치된 로컬 모델을 선택하세요. / Select an installed local model.",
      );
    const model = (await this.models(signal)).find((m) => m.name === modelName);
    if (!model)
      throw Error(
        "선택한 로컬 모델이 없습니다. / Selected local model is unavailable.",
      );
    const info = await this.json(
      "/api/show",
      { model: model.name },
      signal,
      10000,
    );
    if (
      info.remote_host ||
      info.remote_model ||
      object(info.details).format !== "gguf" ||
      typeof object(info.model_info)["general.architecture"] !== "string" ||
      !Array.isArray(info.capabilities) ||
      !info.capabilities.includes("completion")
    )
      throw Error(
        "로컬 텍스트 모델임을 확인할 수 없습니다. / Could not verify a local text model.",
      );
    // Verify local-only mode again immediately before any source leaves the extension.
    await this.localOnly(signal);
    const messages = assistantMessages(input);
    const contextSize = assistantContextSize(messages);
    const started = Date.now();
    const result = await this.json(
      "/api/chat",
      {
        model: model.name,
        stream: false,
        messages,
        format: assistantSchema,
        options: {
          temperature: 0,
          num_ctx: contextSize,
          num_predict: assistantLimits.outputTokens,
        },
        keep_alive: "5m",
      },
      signal,
    );
    if (
      result.remote_host ||
      result.remote_model ||
      result.done !== true ||
      result.done_reason !== "stop" ||
      typeof object(result.message).content !== "string" ||
      object(result.message).tool_calls?.length
    )
      throw Error(
        "완성된 로컬 응답이 아닙니다. / Incomplete or non-local model response.",
      );
    return {
      model,
      elapsedMs: Date.now() - started,
      contextSize,
      proposal: parseAssistantProposal(result.message.content, input),
    };
  }
}
