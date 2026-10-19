import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { Socket } from "node:net";
import { z } from "zod";
import { digest } from "./records";
import { jobSchema } from "../../../src/workspace/job";
import {
  changeRequestSchema,
  livingSpecSchema,
} from "../../../src/workspace/spec";
import {
  executionContextSchema,
  executionUseSchema,
} from "../../../src/workspace/execution";

export const hostSnapshotSchema = z
  .object({
    state: jobSchema.optional(),
    savedSpec: z
      .string()
      .max(1024 * 1024)
      .optional(),
    running: z.boolean(),
  })
  .strict();
export type HostSnapshot = z.infer<typeof hostSnapshotSchema>;
export const hostRecordSchema = z
  .object({
    version: z.literal(1),
    root: z.string(),
    storage: z.string(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const startOptionsSchema = z
  .object({
    executable: executionContextSchema.shape.executable,
    model: executionContextSchema.shape.model.optional(),
    checks: executionUseSchema.shape.checks,
    allowExternal: z.literal(true),
    specSnapshot: livingSpecSchema.optional(),
    verification: executionContextSchema
      .pick({ manager: true, scripts: true })
      .optional(),
  })
  .strict();
export const hostRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("history") }).strict(),
  z
    .object({ action: z.literal("restore"), workspaceId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("start"),
      request: changeRequestSchema,
      options: startOptionsSchema,
    })
    .strict(),
  z.object({ action: z.literal("cancel"), jobId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("decide"),
      jobId: z.string().uuid(),
      approvalId: z.string(),
      decision: z.enum(["accept", "decline", "cancel"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("file"),
      jobId: z.string().uuid(),
      reviewId: z.string(),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("review"),
      jobId: z.string().uuid(),
      decision: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["apply", "undo", "recover"]),
      jobId: z.string().uuid(),
      reviewId: z.string(),
    })
    .strict(),
]);
export type HostRequest = z.infer<typeof hostRequestSchema>;

/** The endpoint is project-wide, including when another editor profile uses different storage. */
export async function hostLocation(root: string, storage: string) {
  root = await realpath(root);
  await mkdir(storage, { recursive: true });
  storage = await realpath(storage);
  const key = digest(process.platform === "win32" ? root.toLowerCase() : root);
  const directory = resolve(storage, ".hosts", key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await realpath(directory)) !== directory)
    throw Error("실행 연결 기록 경로가 바뀌었습니다.");
  const endpoint =
    process.platform === "win32"
      ? { path: "\\\\.\\pipe\\pureobom-agent-" + key }
      : process.platform === "linux"
        ? { path: "\0pureobom-agent-" + key }
        : {
            host: "127.0.0.1",
            // Keep the fallback separate from the transaction lease port range.
            port: 15000 + (Number.parseInt(key.slice(0, 8), 16) % 16000),
          };
  return {
    root,
    storage,
    endpoint,
    record: resolve(directory, "connection.json"),
  };
}

// Bound both inbound frames and a slow client's queued output. Capabilities never reach the Webview.
const maxFrameBytes = 32 * 1024 * 1024;
export function sendHostMessage(socket: Socket, value: unknown) {
  const line = JSON.stringify(value) + "\n";
  if (
    Buffer.byteLength(line) > maxFrameBytes ||
    socket.writableLength > maxFrameBytes
  ) {
    socket.destroy();
    return;
  }
  if (!socket.destroyed) socket.write(line);
}
export function receiveHostMessages(
  socket: Socket,
  receive: (message: unknown) => void,
) {
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    if (Buffer.byteLength(buffered) > maxFrameBytes) {
      socket.destroy();
      return;
    }
    let end: number;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        receive(JSON.parse(line));
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}
