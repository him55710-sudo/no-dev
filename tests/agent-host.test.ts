import { beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { ManagedImplementationJobs } from "../extension/src/agent/managedJobs";
import { hostLocation } from "../extension/src/agent/hostProtocol";
import type { ChangeRequest } from "../src/workspace/spec";

const exec = promisify(execFile);
const parent = resolve("test-results/agent-host");
let runtime: string, clientBundle: string;
beforeAll(async () => {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, "bundles-"));
  runtime = resolve(directory, "host.cjs");
  clientBundle = resolve(directory, "client.cjs");
  // Only the idle interval differs. Real job manager, OS endpoint, child process,
  // Git worktree, stdio adapter, approvals, verification and transactions are used.
  await build({
    stdin: {
      contents:
        'import {runAgentHost} from "./extension/src/agent/host"; runAgentHost(process.argv[2],process.argv[3],500).catch(e=>{process.exitCode=e.code==="EADDRINUSE"?0:1;});',
      resolveDir: process.cwd(),
    },
    outfile: runtime,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
  await build({
    entryPoints: ["extension/src/agent/managedJobs.ts"],
    outfile: clientBundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
}, 60000);

async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 20000,
) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw Error("Timed out waiting for the specific fixture state");
    await delay(30);
  }
}
async function fixture() {
  const directory = await mkdtemp(resolve(parent, "run-"));
  const root = resolve(directory, "project"),
    storage = resolve(directory, "jobs"),
    trace = resolve(directory, "turns.txt");
  await cp("tests/fixtures/installed-recovery", root, { recursive: true });
  const peer = resolve(root, "app-server");
  await writeFile(
    peer,
    (await readFile(peer, "utf8"))
      .replace("import { lstatSync,", "import { appendFileSync, lstatSync,")
      .replace(
        "reply(message.id, { turn: {",
        `appendFileSync(${JSON.stringify(trace)}, "turn\\n");\n    reply(message.id, { turn: {`,
      ),
  );
  for (const args of [
    ["init"],
    ["config", "user.name", "Host fixture"],
    ["config", "user.email", "fixture@example.invalid"],
    ["config", "core.autocrlf", "false"],
    ["add", "."],
    ["commit", "-m", "fixture"],
  ])
    await exec("git", ["-C", root, ...args], { windowsHide: true });
  const content = {
    title: "Permission",
    purpose: "",
    desired: "Deny viewer writes in UI and server",
    policies: "",
    inputsOutputs: "",
    failures: "",
    invariants: ["Keep reads"],
    acceptance: ["Viewer denied", "Owner and editor allowed"],
  };
  const request: ChangeRequest = {
    id: "request",
    specId: "permission",
    specRevision: 1,
    graphRevision: "a".repeat(64),
    content,
    desired: content.desired,
    invariants: content.invariants,
    acceptance: content.acceptance,
    sources: [],
    scopePaths: ["policy.js", "service.js", "ui.js"],
  };
  const options = {
    executable: process.execPath,
    checks: ["test"] as ["test"],
    allowExternal: true,
  };
  return {
    directory,
    root,
    storage,
    trace,
    request,
    options,
    client: () => new ManagedImplementationJobs(storage, runtime, () => {}),
  };
}
async function closed(root: string, storage: string) {
  const { endpoint } = await hostLocation(root, storage);
  return new Promise<boolean>((done, reject) => {
    const socket = createConnection(endpoint);
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")) done(true);
      else reject(error);
    });
  });
}

describe("managed implementation host", { timeout: 60000 }, () => {
  it("outlives its original client process and reconnects to the same approval, checks, review, apply and undo", async () => {
    const f = await fixture();
    const script = `const {ManagedImplementationJobs}=require(process.argv[1]);
      const [root,storage,runtime,request,options]=JSON.parse(process.argv[2]);
      const c=new ManagedImplementationJobs(storage,runtime,job=>{if(job?.phase==='approval'){console.log(JSON.stringify(job));process.exit(0)}});
      c.start(root,request,options).catch(e=>{console.error(e);process.exit(1)});`;
    const initial = JSON.parse(
      (
        await exec(
          process.execPath,
          [
            "-e",
            script,
            clientBundle,
            JSON.stringify([f.root, f.storage, runtime, f.request, f.options]),
          ],
          { windowsHide: true, timeout: 30000 },
        )
      ).stdout,
    );
    await delay(800); // More than the host idle interval: pending approval keeps it alive.
    let c = f.client();
    try {
      const history = await c.history(f.root);
      expect(c.state?.id).toBe(initial.id);
      expect(c.state?.phase).toBe("approval");
      expect(c.state?.approvals).toEqual(initial.approvals);
      expect(history.entries).toHaveLength(1);
      expect(await readFile(f.trace, "utf8")).toBe("turn\n");
      await c.restore(f.root, initial.id);
      await c.decide(initial.approvals[0].id, "accept");
      c.dispose();
      await delay(800);
      c = f.client();
      await c.history(f.root);
      expect(c.state?.id).toBe(initial.id);
      await until(() => c.state?.phase === "review" && !c.isRunning);
      expect(c.state?.checks.map((check) => check.status)).toEqual(["passed"]);
      expect(c.state?.files.map((file) => file.path).sort()).toEqual([
        "policy.js",
        "service.js",
        "ui.js",
      ]);
      const decision = {
        jobId: c.state!.id,
        reviewId: c.state!.reviewId,
        approvedScopePaths: [],
        reviewedVerificationPaths: [],
        acceptUnverified: false,
        criteria: c.state!.assessment!.criteria.map((criterion) => ({
          id: criterion.id,
          outcome: "confirmed",
          note: "Controlled fixture assertions",
          checkNames: ["test"],
        })),
      };
      await c.reviewDecision(decision);
      const file = await c.file(0);
      expect(file.before).not.toBe(file.after);
      const original = await readFile(resolve(f.root, "policy.js"), "utf8");
      await c.apply(c.state!.reviewId!);
      expect(c.state?.phase).toBe("applied");
      await c.undo(c.state!.reviewId!);
      expect(c.state?.phase).toBe("undone");
      expect(await readFile(resolve(f.root, "policy.js"), "utf8")).toBe(
        original,
      );
      expect(
        (await exec("git", ["-C", f.root, "status", "--porcelain"])).stdout,
      ).toBe("");
    } finally {
      c.dispose();
    }
    await delay(1100);
    expect(await closed(f.root, f.storage)).toBe(true);
    const restored = f.client();
    try {
      await restored.history(f.root);
      expect(restored.state).toBeUndefined();
      await restored.restore(f.root, initial.id);
      expect(restored.state?.phase).toBe("undone");
      expect(await readFile(f.trace, "utf8")).toBe("turn\n");
    } finally {
      restored.dispose();
    }
  });

  it("serializes concurrent windows, rejects stale approval/cancel requests, and cancels through a new connection", async () => {
    const f = await fixture(),
      first = f.client(),
      second = f.client();
    try {
      await Promise.all([first.history(f.root), second.history(f.root)]);
      await expect(
        first.start(f.root, f.request, { ...f.options, allowExternal: false }),
      ).rejects.toThrow();
      const starts = await Promise.allSettled([
        first.start(f.root, f.request, f.options),
        second.start(f.root, f.request, f.options),
      ]);
      expect(
        starts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        starts.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      await until(() => second.state?.phase === "approval");
      const id = second.state!.id;
      const approval = second.state!.approvals[0].id;
      await expect(
        second.decide(approval, "accept", randomUUID()),
      ).rejects.toThrow(/현재 작업/);
      await expect(second.cancel(randomUUID())).rejects.toThrow(/현재 작업/);
      expect(second.state?.phase).toBe("approval");
      first.dispose();
      second.dispose();
      const third = f.client();
      try {
        await third.history(f.root);
        expect(third.state?.id).toBe(id);
        await third.cancel();
        await until(
          () => third.state?.phase === "cancelled" && !third.isRunning,
        );
        expect(third.state?.approvals).toEqual([]);
        expect((await third.history(f.root)).entries).toHaveLength(1);
        expect(await readFile(f.trace, "utf8")).toBe("turn\n");
      } finally {
        third.dispose();
      }
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("refuses unauthenticated clients and restores a dead host as interrupted without repeating inference", async () => {
    const f = await fixture();
    // Own this exact test child handle so termination cannot target an unrelated process.
    const worker = spawn(process.execPath, [runtime, f.root, f.storage], {
      windowsHide: true,
      stdio: "ignore",
    });
    const exited = new Promise<void>((done) =>
      worker.once("exit", () => done()),
    );
    await until(async () => !(await closed(f.root, f.storage)));
    const { endpoint } = await hostLocation(f.root, f.storage);
    let leaked = "";
    await new Promise<void>((done, reject) => {
      const socket = createConnection(endpoint);
      socket.once("error", reject);
      socket.on("data", (bytes) => {
        leaked += bytes.toString();
      });
      socket.once("close", () => done());
      socket.once("connect", () =>
        socket.write(
          JSON.stringify({ version: 1, token: "0".repeat(64) }) + "\n",
        ),
      );
    });
    expect(leaked).toBe("");
    let connectionError: string | undefined;
    const c = new ManagedImplementationJobs(
      f.storage,
      runtime,
      (_job, error) => {
        connectionError = error;
      },
    );
    try {
      await c.start(f.root, f.request, f.options);
      await until(() => c.state?.phase === "approval");
      const id = c.state!.id;
      // Ensure the persisted approval phase is complete before deliberate process death.
      await until(
        async () =>
          JSON.parse(await readFile(resolve(f.storage, id, "job.json"), "utf8"))
            .state.phase === "approval",
      );
      worker.kill();
      await exited;
      await until(() => !!connectionError);
      expect(c.state?.phase).toBe("approval"); // Loss of observation is not cancellation.
      await expect(
        c.decide(c.state!.approvals[0].id, "accept"),
      ).rejects.toThrow(/연결/);
      await c.history(f.root);
      await c.restore(f.root, id);
      expect(c.state?.phase).toBe("interrupted");
      expect(c.state?.approvals).toEqual([]);
      expect(c.state?.checks).toEqual([]);
      expect(await readFile(f.trace, "utf8")).toBe("turn\n");
    } finally {
      c.dispose();
      if (worker.exitCode === null) {
        worker.kill();
        await exited;
      }
    }
  });

  it("does not launch a replacement when an occupied endpoint fails to answer authentication", async () => {
    const f = await fixture();
    const location = await hostLocation(f.root, f.storage);
    await writeFile(
      location.record,
      JSON.stringify({
        version: 1,
        root: location.root,
        storage: location.storage,
        token: "a".repeat(64),
      }),
    );
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("data", () => {}); // Deliberately live but does not answer.
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(location.endpoint, done);
    });
    const marker = resolve(f.directory, "replacement-started.txt");
    const forbiddenRuntime = resolve(f.directory, "should-not-launch.cjs");
    await writeFile(
      forbiddenRuntime,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected replacement');`,
    );
    const c = new ManagedImplementationJobs(
      f.storage,
      forbiddenRuntime,
      () => {},
    );
    try {
      await expect(c.history(f.root)).rejects.toThrow(/연결/);
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(server.listening).toBe(true);
    } finally {
      c.dispose();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
