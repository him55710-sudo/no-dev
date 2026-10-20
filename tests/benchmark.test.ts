import { describe, expect, it } from "vitest";
import {
  compareBenchmarks,
  distribution,
  readBenchmark,
  summarizeBenchmark,
  type BenchmarkResult,
} from "../src/core/benchmark";
const result = (): BenchmarkResult => ({
  schema: 1,
  warmupRuns: 1,
  memoryMethod: "wait4-maxrss",
  environment: {
    platform: "Linux",
    arch: "x86_64",
    python: "3.12.10",
    executableSha256: "a".repeat(64),
  },
  samples: [10, 11, 12, 13, 14, 15, 100].map((elapsedMs) => ({
    elapsedMs,
    peakRssBytes: 1024,
    stdoutSha256: "b".repeat(64),
    stdoutBytes: 2,
    stderrBytes: 0,
  })),
});
describe("observed command measurements", () => {
  it("uses median and median absolute deviation instead of hiding outliers", () => {
    expect(distribution([100, 10, 11, 12, 13, 14, 15])).toEqual({
      median: 13,
      min: 10,
      max: 100,
      mad: 2,
    });
    expect(() => distribution([NaN])).toThrow();
    expect(() => distribution([])).toThrow();
  });
  it("validates all seven bounded worker samples and copies only known fields", () => {
    const valid = result();
    expect(readBenchmark({ ...valid, privateValue: "never forward" })).toEqual(
      valid,
    );
    for (const value of [
      null,
      {},
      { ...valid, samples: [] },
      { ...valid, warmupRuns: 0 },
      ...[NaN, Infinity, -1, 40000].map((elapsedMs) => ({
        ...valid,
        samples: valid.samples.map((s) => ({ ...s, elapsedMs })),
      })),
    ])
      expect(() => readBenchmark(value)).toThrow();
    expect(() =>
      readBenchmark({
        ...valid,
        samples: valid.samples.map((s) => ({ ...s, stdoutBytes: 4194305 })),
      }),
    ).toThrow();
  });
  it("does not calculate a speedup for unstable or different output", () => {
    const a = result(),
      b = result();
    b.samples[2].stdoutSha256 = "c".repeat(64);
    expect(summarizeBenchmark(b).stableOutput).toBe(false);
    expect(compareBenchmarks(a, b).timeChangePercent).toBeNull();
    b.samples.forEach((s) => {
      s.stdoutSha256 = "c".repeat(64);
    });
    expect(compareBenchmarks(a, b).outputsMatch).toBe(false);
  });
  it("separates OS compatibility, missing memory, overlapping ranges and changed executables", () => {
    const a = result(),
      b = result();
    b.samples.forEach((s) => {
      s.elapsedMs *= 0.5;
      s.peakRssBytes = null;
    });
    b.environment.executableSha256 = "d".repeat(64);
    expect(compareBenchmarks(a, b)).toMatchObject({
      compatible: true,
      executableChanged: true,
      rangesOverlap: true,
      timeChangePercent: -50,
      memoryChangePercent: null,
    });
    b.environment.platform = "Windows";
    expect(compareBenchmarks(a, b).timeChangePercent).toBeNull();
    const launcher = { ...b, memoryNote: "windows-venv-launcher" as const };
    expect(readBenchmark(launcher).memoryNote).toBe("windows-venv-launcher");
    expect(summarizeBenchmark(launcher).memory).toBeNull();
  });
});
