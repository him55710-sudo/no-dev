import { expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runBenchmark } from "../extension/src/benchmarkRunner";
const python = process.platform === "win32" ? "python" : "python3";
const script = resolve("extension/runtime/benchmark.py");
const plan = (code: string) => ({
  argv: [process.execPath, "-e", code],
  cwd: process.cwd(),
  env: {},
});
it("measures seven real processes, stable output hashes and available OS peak memory", async () => {
  const progress: number[] = [];
  const measured = await runBenchmark(
    python,
    script,
    plan(
      "const b=Buffer.alloc(16*1024*1024,1); setTimeout(()=>console.log(b.length),60)",
    ),
    new AbortController().signal,
    (value) => progress.push(value),
  );
  expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(measured.samples).toHaveLength(7);
  expect(
    measured.samples.every(
      (s) =>
        s.elapsedMs > 50 &&
        s.peakRssBytes !== null &&
        s.peakRssBytes > 16 * 1024 * 1024,
    ),
  ).toBe(true);
  expect(new Set(measured.samples.map((s) => s.stdoutSha256)).size).toBe(1);
}, 20000);
it("rejects a real failing process and bounded output overflow", async () => {
  await expect(
    runBenchmark(
      python,
      script,
      plan("console.error('fixture failure');process.exit(7)"),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(/exited 7/);
  await expect(
    runBenchmark(
      python,
      script,
      plan("process.stdout.write('x'.repeat(4194305))"),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(/4 MiB/);
}, 15000);
it("cancels a live process tree without accepting a partial result", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pureobom-cancel-"));
  const heartbeat = resolve(directory, "heartbeat.txt");
  const descendant = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'.'),50)`;
  const controller = new AbortController();
  const pending = runBenchmark(
    python,
    script,
    plan(
      `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000)`,
    ),
    controller.signal,
    () => {},
  );
  const timeout = setTimeout(() => controller.abort(), 8000);
  // Attach the rejection handler immediately, even if setup times out.
  const rejected = expect(pending).rejects.toThrow(/cancelled/);
  try {
    const deadline = Date.now() + 6000;
    while (!(await readFile(heartbeat, "utf8").catch(() => ""))) {
      if (Date.now() > deadline) throw Error("Descendant never started");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    controller.abort();
    await rejected;
    const stopped = await readFile(heartbeat, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readFile(heartbeat, "utf8")).toBe(stopped);
  } finally {
    controller.abort();
    await rejected;
    clearTimeout(timeout);
    await unlink(heartbeat).catch(() => {});
    await rmdir(directory);
  }
}, 15000);
it("stops a real command at the 30-second limit without a partial measurement", async () => {
  const started = Date.now();
  await expect(
    runBenchmark(
      python,
      script,
      plan("setInterval(()=>{},1000)"),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow(/30 seconds/);
  expect(Date.now() - started).toBeGreaterThanOrEqual(29000);
}, 40000);
it("reports a missing Python executable and an already cancelled request", async () => {
  await expect(
    runBenchmark(
      resolve("missing-python-executable"),
      script,
      plan("process.exit(0)"),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    runBenchmark(
      python,
      script,
      plan("process.exit(0)"),
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow(/cancelled/);
});
