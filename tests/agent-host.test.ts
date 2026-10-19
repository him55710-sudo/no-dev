import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
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
const observations: {
  root: string;
  startedAt: string;
  events: {
    elapsedMs: number;
    phase: string;
    running: boolean;
    message: string;
    connectionError?: string;
  }[];
}[] = [];
afterEach(async () => {
  await writeFile(
    resolve(parent, "observations.json"),
    JSON.stringify(observations, null, 2) + "\n",
  );
});
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
  // The two setup-cancellation cases can also exercise the exact installed host
  // bundle. Other cases intentionally rely on the source fixture's 500ms idle.
  if (process.env.PUREOBOM_TEST_AGENT_HOST) {
    runtime = resolve(process.env.PUREOBOM_TEST_AGENT_HOST);
    await access(runtime);
  }
}, 60000);

async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 20000,
) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw Error(
        "Timed out waiting for the specific fixture state. Latest observations: " +
          JSON.stringify(observations.at(-1)),
      );
    await delay(30);
  }
}
async function fixture() {
  const started = performance.now();
  const directory = await mkdtemp(resolve(parent, "run-"));
  const root = resolve(directory, "project"),
    storage = resolve(directory, "jobs"),
    trace = resolve(directory, "turns.txt");
  const observation = {
    root,
    startedAt: new Date().toISOString(),
    events: [] as (typeof observations)[number]["events"],
  };
  observations.push(observation);
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
    specSnapshot: {
      id: request.specId,
      revision: request.specRevision,
      targetIds: [request.specId],
      content,
      baseline: {
        graphRevision: request.graphRevision,
        observed: "",
        sources: [],
      },
      updatedAt: new Date().toISOString(),
    },
  };
  return {
    directory,
    root,
    storage,
    trace,
    request,
    options,
    client: (
      changed: ConstructorParameters<
        typeof ManagedImplementationJobs
      >[2] = () => {},
    ) => {
      const client = new ManagedImplementationJobs(
        storage,
        runtime,
        (job, connectionError) => {
          const last = observation.events.at(-1);
          const phase = job?.phase ?? "none";
          if (
            last?.phase !== phase ||
            last?.running !== client.isRunning ||
            last?.connectionError !== connectionError
          ) {
            observation.events.push({
              elapsedMs: Math.round(performance.now() - started),
              phase,
              running: client.isRunning,
              message: job?.message.slice(0, 200) ?? "",
              connectionError,
            });
            if (observation.events.length > 80) observation.events.shift();
          }
          changed(job, connectionError);
        },
      );
      return client;
    },
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
  it.each(["initialize", "account/read"])(
    "cancels a stalled %s before inference and confirms the provider stopped",
    async (method) => {
      const f = await fixture();
      const peer = resolve(f.root, "app-server");
      const ready = resolve(f.directory, "setup-ready.json");
      const writes = resolve(f.directory, "setup-writes.txt");
      const stop = resolve(f.directory, "stop-setup");
      await writeFile(
        peer,
        (await readFile(peer, "utf8"))
          .replace(
            "import { appendFileSync,",
            "import { existsSync, appendFileSync,",
          )
          .replace(
            "const message = JSON.parse(line);",
            `const message = JSON.parse(line);
            if (message.method === ${JSON.stringify(method)}) {
              writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid:process.pid}));
              writeFileSync(${JSON.stringify(writes)}, 'x');
              const deadline = Date.now() + 45000;
              setInterval(() => {
                if (existsSync(${JSON.stringify(stop)}) || Date.now() > deadline) process.exit();
                appendFileSync(${JSON.stringify(writes)}, 'x');
              }, 20);
              return;
            }`,
          )
          .replace(
            '.on("close", () => process.exit(0))',
            '.on("close", () => {})',
          ),
      );
      const original = await readFile(resolve(f.root, "policy.js"));
      const originalStatus = (
        await exec("git", ["-C", f.root, "status", "--porcelain"])
      ).stdout;
      const worker = spawn(process.execPath, [runtime, f.root, f.storage], {
        windowsHide: true,
        stdio: "ignore",
      });
      const exited = new Promise<void>((done) =>
        worker.once("exit", () => done()),
      );
      let observedPid: number | undefined;
      let cancelledWhileAlive = false;
      const c = f.client((job) => {
        if (job?.phase !== "cancelled" || observedPid === undefined) return;
        try {
          process.kill(observedPid, 0);
          cancelledWhileAlive = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      });
      try {
        await until(async () => !(await closed(f.root, f.storage)));
        await c.start(f.root, f.request, f.options);
        await until(async () => {
          try {
            await readFile(ready);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return false;
            throw error;
          }
        });
        const { pid } = JSON.parse(await readFile(ready, "utf8")) as {
          pid: number;
        };
        observedPid = pid;
        expect(c.isRunning).toBe(true);
        await c.cancel();
        await until(() => c.state?.phase === "cancelled" && !c.isRunning, 5000);
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
        expect(cancelledWhileAlive).toBe(false);
        const stoppedBytes = await readFile(writes);
        await delay(200);
        expect(await readFile(writes)).toEqual(stoppedBytes);
        expect(c.state?.approvals).toEqual([]);
        expect(c.state?.checks).toEqual([]);
        expect(c.state?.message).toBe("구현 작업을 취소했습니다.");
        expect((await c.history(f.root)).entries[0].phase).toBe("cancelled");
        await expect(readFile(f.trace)).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await readFile(resolve(f.root, "policy.js"))).toEqual(original);
        expect(
          (await exec("git", ["-C", f.root, "status", "--porcelain"])).stdout,
        ).toBe(originalStatus);
      } finally {
        // On platforms without owner-death containment, the fallback also stops
        // the deliberate stubborn peer when an earlier assertion has failed.
        await writeFile(stop, "fixture cleanup");
        c.dispose();
        if (worker.exitCode === null && worker.signalCode === null)
          worker.kill();
        await exited;
      }
    },
  );

  it("explicitly continues a dead job with its partial changes, new approval, fresh checks, review, apply and undo", async () => {
    const f = await fixture();
    const peer = resolve(f.root, "app-server");
    await writeFile(
      peer,
      (await readFile(peer, "utf8")).replace(
        "reply(message.id, { turn: {",
        `const continuation = message.params.input[0].text.includes('Continue an interrupted implementation.');
      if (!continuation) {
        writeFileSync('continuation.txt', 'partial change retained');
        writeFileSync('policy.js', '// unfinished implementation\\n' + readFileSync('policy.js', 'utf8'));
      } else if (readFileSync('continuation.txt', 'utf8') !== 'partial change retained' || !readFileSync('policy.js', 'utf8').startsWith('// unfinished implementation')) {
        throw Error('Continuation lost partial changes');
      }
      reply(message.id, { turn: {`,
      ),
    );
    const original = await readFile(resolve(f.root, "policy.js"), "utf8");
    const status = (await exec("git", ["-C", f.root, "status", "--porcelain"]))
      .stdout;
    const worker = spawn(process.execPath, [runtime, f.root, f.storage], {
      windowsHide: true,
      stdio: "ignore",
    });
    const exited = new Promise<void>((done) =>
      worker.once("exit", () => done()),
    );
    const c = f.client();
    try {
      await until(async () => !(await closed(f.root, f.storage)));
      await c.start(f.root, f.request, f.options);
      await until(() => c.state?.phase === "approval");
      const firstId = c.state!.id,
        firstPath = c.state!.worktree!,
        approval = c.state!.approvals[0].id;
      await until(
        async () =>
          JSON.parse(
            await readFile(resolve(f.storage, firstId, "job.json"), "utf8"),
          ).state.phase === "approval",
      );
      const partial = await readFile(resolve(firstPath, "policy.js"), "utf8");
      worker.kill();
      await exited;
      await until(async () => await closed(f.root, f.storage));
      c.dispose();
      const next = f.client();
      try {
        await next.restore(f.root, firstId);
        expect(next.state?.phase).toBe("interrupted");
        await expect(
          next.resume(f.root, firstId, { ...f.options, allowExternal: false }),
        ).rejects.toThrow();
        await expect(
          next.resume(f.root, firstId, {
            ...f.options,
            specSnapshot: { ...f.options.specSnapshot, revision: 2 },
          }),
        ).rejects.toThrow(/설계/);
        const resumed = await next.resume(f.root, firstId, f.options);
        expect(resumed.id).not.toBe(firstId);
        expect(resumed.continuedFrom).toBe(firstId);
        await until(() => next.state?.phase === "approval");
        expect(next.state?.checks).toEqual([]);
        expect(
          await readFile(resolve(next.state!.worktree!, "policy.js"), "utf8"),
        ).toBe(partial);
        await expect(next.decide(approval, "accept", firstId)).rejects.toThrow(
          /현재 작업/,
        );
        await expect(
          next.resume(f.root, resumed.id, f.options),
        ).rejects.toThrow(/중단된/);
        await next.decide(next.state!.approvals[0].id, "accept");
        await until(() => next.state?.phase === "review" && !next.isRunning);
        expect(next.state?.checks.map((check) => check.status)).toEqual([
          "passed",
        ]);
        expect(await readFile(f.trace, "utf8")).toBe("turn\nturn\n");
        expect(await readFile(resolve(firstPath, "policy.js"), "utf8")).toBe(
          partial,
        );
        const oldRecord = JSON.parse(
          await readFile(resolve(f.storage, firstId, "job.json"), "utf8"),
        );
        expect(oldRecord.state.phase).toBe("interrupted");
        expect(
          oldRecord.review.files.map((file: { path: string }) => file.path),
        ).toEqual(["continuation.txt", "policy.js"]);
        expect(next.state!.files.map((file) => file.path)).toEqual([
          "continuation.txt",
          "policy.js",
          "service.js",
          "ui.js",
        ]);
        await next.reviewDecision({
          jobId: next.state!.id,
          reviewId: next.state!.reviewId,
          approvedScopePaths: ["continuation.txt"],
          reviewedVerificationPaths: [],
          acceptUnverified: false,
          criteria: next.state!.assessment!.criteria.map((criterion) => ({
            id: criterion.id,
            outcome: "confirmed",
            note: "Controlled fixture assertions",
            checkNames: ["test"],
          })),
        });
        await next.apply(next.state!.reviewId!);
        expect(
          await readFile(resolve(f.root, "continuation.txt"), "utf8"),
        ).toBe("partial change retained");
        await next.undo(next.state!.reviewId!);
        expect(await readFile(resolve(f.root, "policy.js"), "utf8")).toBe(
          original,
        );
        expect(
          (await exec("git", ["-C", f.root, "status", "--porcelain"])).stdout,
        ).toBe(status);
        await next.restore(f.root, firstId);
        expect(next.state?.files).toHaveLength(2);
        expect((await next.file(1)).after).toBe(partial);
      } finally {
        if (next.isRunning) {
          await next.cancel();
          await until(() => !next.isRunning);
        }
        next.dispose();
      }
    } finally {
      c.dispose();
      if (worker.exitCode === null) {
        worker.kill();
        await exited;
      }
    }
  });
  it("outlives its original client process and reconnects to the same approval, checks, review, apply and undo", async () => {
    const f = await fixture();
    const script = `const {ManagedImplementationJobs}=require(process.argv[1]);
      const [root,storage,runtime,request,options]=JSON.parse(process.argv[2]);
      let lastPhase;
      const c=new ManagedImplementationJobs(storage,runtime,(job,error)=>{
        if(job?.phase!==lastPhase||error){console.error(JSON.stringify({phase:job?.phase,message:job?.message,error}));lastPhase=job?.phase;}
        if(job?.phase==='approval'){console.log(JSON.stringify(job));process.exit(0)}
        if(job?.phase==='failed'){process.exit(2)}
      });
      c.start(root,request,options).catch(e=>{console.error(e);process.exit(1)});`;
    let c = f.client();
    let initial: { id: string; approvals: { id: string }[] };
    try {
      initial = JSON.parse(
        (
          await exec(
            process.execPath,
            [
              "-e",
              script,
              clientBundle,
              JSON.stringify([
                f.root,
                f.storage,
                runtime,
                f.request,
                f.options,
              ]),
            ],
            { windowsHide: true, timeout: 30000 },
          )
        ).stdout,
      );
      await delay(800); // More than the host idle interval: pending approval keeps it alive.
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
      // Even a timeout launching the original client must clean up this fixture's
      // owned job. Reconnect to the same host; never terminate by a stored PID.
      if (!c.state) await c.history(f.root);
      if (c.isRunning) {
        await c.cancel();
        await until(() => !c.isRunning);
      }
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
      // A failed approval wait must not leave this fixture's detached host alive.
      const cleanup = f.client();
      try {
        await cleanup.history(f.root);
        if (cleanup.isRunning) {
          await cleanup.cancel();
          await until(() => !cleanup.isRunning);
        }
      } finally {
        cleanup.dispose();
      }
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
    const c = f.client((_job, error) => {
      connectionError = error;
    });
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

  it.runIf(process.platform === "win32")(
    "stops a stubborn provider and detached writer when its managed host dies, preserving the interrupted job and original",
    async () => {
      const f = await fixture();
      const peer = resolve(f.root, "app-server");
      const marker = resolve(f.directory, "writer.json");
      const stop = resolve(f.directory, "stop-writer");
      const original = await readFile(resolve(f.root, "policy.js"));
      const writer = `const fs=require('node:fs'),path=require('node:path');
      const target=path.join(process.cwd(),'late-write.txt');
      fs.writeFileSync(target,'x');
      fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,target}));
      const deadline=Date.now()+45000;
      setInterval(()=>{if(fs.existsSync(${JSON.stringify(stop)})||Date.now()>deadline)process.exit();fs.appendFileSync(target,'x');},20);`;
      await writeFile(
        peer,
        `import {spawn} from 'node:child_process';
      spawn(process.execPath,['-e',${JSON.stringify(writer)}],{detached:true,stdio:'ignore',windowsHide:true}).unref();
      setInterval(()=>{},1000);
      ${(await readFile(peer, "utf8")).replace('.on("close", () => process.exit(0))', '.on("close", () => {})')}`,
      );
      const worker = spawn(process.execPath, [runtime, f.root, f.storage], {
        windowsHide: true,
        stdio: "ignore",
      });
      const exited = new Promise<void>((done) =>
        worker.once("exit", () => done()),
      );
      const c = f.client();
      try {
        await until(async () => !(await closed(f.root, f.storage)));
        await c.start(f.root, f.request, f.options);
        await until(() => c.state?.phase === "approval");
        const id = c.state!.id;
        await until(
          async () =>
            JSON.parse(
              await readFile(resolve(f.storage, id, "job.json"), "utf8"),
            ).state.phase === "approval",
        );
        await until(async () => {
          try {
            await readFile(marker);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return false;
            throw error;
          }
        });
        const observed = JSON.parse(await readFile(marker, "utf8")) as {
          pid: number;
          target: string;
        };
        await until(async () => (await readFile(observed.target)).length > 0);
        expect(() => process.kill(observed.pid, 0)).not.toThrow();
        worker.kill();
        await exited;
        await until(() => {
          try {
            process.kill(observed.pid, 0);
            return false;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ESRCH";
          }
        });
        const last = await readFile(observed.target);
        await delay(200);
        expect(await readFile(observed.target)).toEqual(last);
        await c.history(f.root);
        await c.restore(f.root, id);
        expect(c.state?.phase).toBe("interrupted");
        expect(c.state?.approvals).toEqual([]);
        expect(c.state?.checks).toEqual([]);
        expect(await readFile(f.trace, "utf8")).toBe("turn\n");
        expect(await readFile(resolve(f.root, "policy.js"))).toEqual(original);
      } finally {
        await writeFile(stop, "fixture cleanup");
        c.dispose();
        if (worker.exitCode === null && worker.signalCode === null)
          worker.kill();
        await exited;
      }
    },
  );
});
