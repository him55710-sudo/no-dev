import { createServer } from "node:net";
import type { Socket } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ImplementationJobs } from "./jobs";
import { writeRecord } from "./records";
import {
  hostLocation,
  hostRequestSchema,
  receiveHostMessages,
  sendHostMessage,
} from "./hostProtocol";

/** Owns a job independently of a VS Code window. No provider work starts on attachment. */
export async function runAgentHost(
  root: string,
  storage: string,
  idleMs = 30000,
) {
  const location = await hostLocation(root, storage);
  const token = randomBytes(32).toString("hex");
  const sockets = new Set<Socket>(),
    clients = new Set<Socket>();
  let lastUse = Date.now(),
    queued = 0,
    queue = Promise.resolve();
  const snapshot = () => ({
    state: jobs.state,
    savedSpec: jobs.savedSpec,
    running: jobs.isRunning,
  });
  const jobs = new ImplementationJobs(location.storage, () => {
    lastUse = Date.now();
    for (const socket of clients)
      sendHostMessage(socket, { snapshot: snapshot() });
  });
  // Listening owns the exclusive OS lease before the capability is published.
  let ready: Promise<void>;
  const server = createServer((socket) => {
    sockets.add(socket);
    let authenticated = false,
      authenticating = false,
      pending = 0;
    const timeout = setTimeout(() => socket.destroy(), 5000);
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timeout);
      clients.delete(socket);
      sockets.delete(socket);
      lastUse = Date.now();
    });
    receiveHostMessages(socket, (raw) => {
      if (!authenticated) {
        if (authenticating) {
          socket.destroy();
          return;
        }
        authenticating = true;
        const hello = z
          .object({
            version: z.literal(1),
            token: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse(raw);
        void ready
          .then(() => {
            if (socket.destroyed) return;
            if (
              !timingSafeEqual(
                Buffer.from(hello.token, "hex"),
                Buffer.from(token, "hex"),
              )
            ) {
              socket.destroy();
              return;
            }
            authenticated = true;
            clearTimeout(timeout);
            clients.add(socket);
            sendHostMessage(socket, { hello: 1, snapshot: snapshot() });
          })
          .catch(() => socket.destroy());
        return;
      }
      const message = z
        .object({ id: z.string().uuid(), request: hostRequestSchema })
        .strict()
        .parse(raw);
      if (++pending > 16) {
        socket.destroy();
        return;
      }
      queued++;
      // Serialize actions across every attached window. Never replay lost requests.
      queue = queue.then(async () => {
        try {
          const request = message.request;
          let result: unknown;
          if ("jobId" in request && request.jobId !== jobs.state?.id)
            throw Error(
              "현재 작업이 바뀌었습니다. 작업 기록을 새로 확인해 주세요.",
            );
          switch (request.action) {
            case "history":
              result = await jobs.history(location.root);
              break;
            case "restore":
              result =
                jobs.isRunning && jobs.state?.id === request.workspaceId
                  ? jobs.state
                  : await jobs.restore(location.root, request.workspaceId);
              break;
            case "start":
              result = jobs.start(
                location.root,
                request.request,
                request.options,
              );
              break;
            case "cancel":
              jobs.cancel();
              break;
            case "resume":
              result = await jobs.resume(location.root, request.options);
              break;
            case "decide":
              jobs.decide(request.approvalId, request.decision);
              break;
            case "file":
              if (request.reviewId !== jobs.state?.reviewId)
                throw Error("현재 검토한 변경이 아닙니다.");
              result = jobs.file(request.index);
              break;
            case "review":
              await jobs.reviewDecision(request.decision);
              break;
            case "apply":
              await jobs.apply(request.reviewId);
              break;
            case "undo":
              await jobs.undo(request.reviewId);
              break;
            case "recover":
              await jobs.recover(request.reviewId);
              break;
          }
          sendHostMessage(socket, {
            id: message.id,
            result,
            snapshot: snapshot(),
          });
        } catch (error) {
          sendHostMessage(socket, {
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
            snapshot: snapshot(),
          });
        } finally {
          queued--;
          pending--;
          lastUse = Date.now();
        }
      });
    });
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen({ ...location.endpoint, exclusive: true }, done);
  });
  ready = writeRecord(location.record, {
    version: 1,
    root: location.root,
    storage: location.storage,
    token,
  });
  try {
    await ready;
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    server.close();
    throw error;
  }
  const idle = setInterval(
    () => {
      if (
        clients.size ||
        queued ||
        jobs.isRunning ||
        Date.now() - lastUse < idleMs
      )
        return;
      clearInterval(idle);
      for (const socket of sockets) socket.destroy();
      server.close();
      jobs.dispose();
    },
    Math.min(1000, idleMs),
  );
  return { server, jobs };
}
