import { spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ImplementationJobs } from "./jobs";
import type {
  JobHistoryEntry,
  ImplementationJob,
} from "../../../src/workspace/job";
import type { FileProposal } from "./gitWorkspace";
import { readRecord } from "./records";
import {
  hostLocation,
  hostRecordSchema,
  hostRequestSchema,
  hostSnapshotSchema,
  receiveHostMessages,
  sendHostMessage,
  type HostRequest,
  type HostSnapshot,
} from "./hostProtocol";

const disconnectedMessage =
  "실행 상태 연결이 끊겼습니다. 작업은 계속될 수 있습니다. 작업 기록을 새로고침해 현재 상태를 확인해 주세요.";
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** UI-side connection only. Disposing detaches; cancellation is always explicit. */
export class ManagedImplementationJobs {
  private snapshot: HostSnapshot = { running: false };
  private socket?: Socket;
  private root?: string;
  private connecting?: Promise<void>;
  private disposed = false;
  private requests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  get state() {
    return this.snapshot.state;
  }
  get savedSpec() {
    return this.snapshot.savedSpec;
  }
  get isRunning() {
    return this.snapshot.running;
  }
  constructor(
    private storage: string,
    private runtime: string,
    private changed: (
      job: ImplementationJob | undefined,
      connectionError?: string,
    ) => void,
  ) {}
  private publish(snapshot: unknown) {
    this.snapshot = hostSnapshotSchema.parse(snapshot);
    this.changed(this.state);
  }
  private async connect(root: string) {
    if (this.disposed) throw Error("구현 화면 연결이 닫혔습니다.");
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.establish(root).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async establish(root: string) {
    const location = await hostLocation(root, this.storage);
    if (this.root && this.root !== location.root)
      throw Error("다른 프로젝트의 실행 연결입니다.");
    this.root = location.root;
    let launched = false;
    let launchError: Error | undefined;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (this.disposed) throw Error("구현 화면 연결이 닫혔습니다.");
      let socket: Socket;
      try {
        socket = await new Promise<Socket>((done, reject) => {
          const candidate = createConnection(location.endpoint);
          const timer = setTimeout(() => {
            candidate.destroy();
            reject(Error("실행 연결 응답을 확인하지 못했습니다."));
          }, 1500);
          candidate.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          candidate.once("connect", () => {
            clearTimeout(timer);
            done(candidate);
          });
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // An observation timeout, busy pipe or authentication error is NOT a missing host.
        if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
        if (!launched) {
          launched = true;
          const child = spawn(
            process.execPath,
            [this.runtime, location.root, location.storage],
            {
              cwd: location.storage,
              env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
              windowsHide: true,
              detached: true,
              stdio: "ignore",
              shell: false,
            },
          );
          child.once("error", (error) => {
            launchError = error;
          });
          child.unref();
        }
        if (launchError) throw launchError;
        await delay(100);
        continue;
      }
      try {
        const record = await readRecord(
          location.record,
          hostRecordSchema,
          16384,
        );
        if (
          record.root !== location.root ||
          record.storage !== location.storage
        )
          throw Error(
            "다른 편집기 프로필의 실행 연결입니다. 해당 창에서 작업을 확인해 주세요.",
          );
        await new Promise<void>((done, reject) => {
          let attached = false;
          const timer = setTimeout(() => {
            socket.destroy();
            reject(Error("실행 연결 인증을 확인하지 못했습니다."));
          }, 2000);
          socket.once("close", () => {
            clearTimeout(timer);
            if (!attached)
              reject(Error("실행 연결 인증을 확인하지 못했습니다."));
            if (this.socket === socket) {
              this.socket = undefined;
              for (const pending of this.requests.values()) {
                clearTimeout(pending.timer);
                pending.reject(Error(disconnectedMessage));
              }
              this.requests.clear();
              if (!this.disposed) this.changed(this.state, disconnectedMessage);
            }
          });
          receiveHostMessages(socket, (raw) => {
            const message = z
              .object({
                hello: z.literal(1).optional(),
                id: z.string().uuid().optional(),
                error: z.string().optional(),
                result: z.unknown().optional(),
                snapshot: hostSnapshotSchema,
              })
              .strict()
              .parse(raw);
            if (!attached) {
              if (message.hello !== 1) throw Error("Invalid host handshake");
              if (this.disposed) {
                socket.destroy();
                return;
              }
              attached = true;
              this.socket = socket;
              clearTimeout(timer);
              this.publish(message.snapshot);
              done();
              return;
            }
            this.publish(message.snapshot);
            if (message.id) {
              const pending = this.requests.get(message.id);
              if (pending) {
                this.requests.delete(message.id);
                clearTimeout(pending.timer);
                if (message.error) pending.reject(Error(message.error));
                else pending.resolve(message.result);
              }
            }
          });
          sendHostMessage(socket, { version: 1, token: record.token });
        });
        return;
      } catch (error) {
        socket.destroy();
        // The winner may have bound its endpoint before publishing its new token.
        if (Date.now() + 100 >= deadline) throw error;
        await delay(100);
      }
    }
    throw Error(
      "구현 실행기에 연결하지 못했습니다. 자동으로 구현을 다시 시작하지 않았습니다.",
    );
  }
  private async call<T>(request: HostRequest): Promise<T> {
    request = hostRequestSchema.parse(request);
    if (!this.socket || this.socket.destroyed || this.disposed)
      throw Error(disconnectedMessage);
    const socket = this.socket,
      id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(
          Error(
            "요청 결과를 아직 확인하지 못했습니다. 작업 기록을 새로고침해 확인해 주세요. 같은 요청을 자동으로 반복하지 않습니다.",
          ),
        );
      }, 180000);
      this.requests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      sendHostMessage(socket, { id, request });
    });
  }
  async history(root: string) {
    try {
      await this.connect(root);
      return await this.call<{ entries: JobHistoryEntry[]; errors: string[] }>({
        action: "history",
      });
    } catch (error) {
      if (!this.disposed)
        this.changed(
          this.state,
          error instanceof Error ? error.message : String(error),
        );
      throw error;
    }
  }
  async start(
    root: string,
    request: Parameters<ImplementationJobs["start"]>[1],
    options: Parameters<ImplementationJobs["start"]>[2],
  ) {
    await this.connect(root);
    return this.call<ImplementationJob>({
      action: "start",
      request,
      options: { ...options, allowExternal: options.allowExternal as true },
    });
  }
  async restore(root: string, workspaceId: string) {
    await this.connect(root);
    return this.call<ImplementationJob>({ action: "restore", workspaceId });
  }
  async resume(
    root: string,
    jobId: string,
    options: Parameters<ImplementationJobs["resume"]>[1],
  ) {
    await this.connect(root);
    return this.call<ImplementationJob>({
      action: "resume",
      jobId,
      options: { ...options, allowExternal: options.allowExternal as true },
    });
  }
  private jobId() {
    if (!this.state) throw Error("구현 작업이 없습니다.");
    return this.state.id;
  }
  decide(
    approvalId: string,
    decision: "accept" | "decline" | "cancel",
    jobId = this.jobId(),
  ) {
    return this.call({ action: "decide", jobId, approvalId, decision });
  }
  cancel(jobId = this.jobId()) {
    return this.call({ action: "cancel", jobId });
  }
  file(index: number, reviewId = this.state?.reviewId ?? "") {
    return this.call<FileProposal>({
      action: "file",
      jobId: this.jobId(),
      reviewId,
      index,
    });
  }
  reviewDecision(decision: unknown) {
    return this.call({ action: "review", jobId: this.jobId(), decision });
  }
  apply(reviewId: string) {
    return this.call({ action: "apply", jobId: this.jobId(), reviewId });
  }
  undo(reviewId: string) {
    return this.call({ action: "undo", jobId: this.jobId(), reviewId });
  }
  recover(reviewId: string) {
    return this.call({ action: "recover", jobId: this.jobId(), reviewId });
  }
  dispose() {
    this.disposed = true;
    this.socket?.destroy();
  }
}
