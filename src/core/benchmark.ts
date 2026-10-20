export type BenchmarkSample = {
  elapsedMs: number;
  peakRssBytes: number | null;
  stdoutSha256: string;
  stdoutBytes: number;
  stderrBytes: number;
};
export type BenchmarkResult = {
  schema: 1;
  warmupRuns: number;
  memoryMethod: "windows-peak-working-set" | "wait4-maxrss";
  memoryNote?: "windows-venv-launcher";
  environment: {
    platform: string;
    arch: string;
    python: string;
    executableSha256: string;
  };
  samples: BenchmarkSample[];
};
export type Distribution = {
  median: number;
  min: number;
  max: number;
  mad: number;
};
export function distribution(values: number[]): Distribution {
  if (!values.length || values.some((n) => !Number.isFinite(n) || n < 0))
    throw Error("Invalid measurement");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (a: number[]) =>
    (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2;
  const median = middle(sorted);
  return {
    median,
    min: sorted[0],
    max: sorted.at(-1)!,
    mad: middle(sorted.map((n) => Math.abs(n - median)).sort((a, b) => a - b)),
  };
}
export function readBenchmark(value: unknown): BenchmarkResult {
  const r = value as BenchmarkResult;
  const digest = (s: unknown) =>
    typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
  const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (
    !r ||
    r.schema !== 1 ||
    r.warmupRuns !== 1 ||
    !["windows-peak-working-set", "wait4-maxrss"].includes(r.memoryMethod) ||
    !r.environment ||
    (r.memoryNote !== undefined && r.memoryNote !== "windows-venv-launcher") ||
    ![r.environment.platform, r.environment.arch, r.environment.python].every(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 100,
    ) ||
    !digest(r.environment.executableSha256) ||
    !Array.isArray(r.samples) ||
    r.samples.length !== 7 ||
    r.samples.some(
      (s) =>
        !s ||
        !Number.isFinite(s.elapsedMs) ||
        s.elapsedMs <= 0 ||
        s.elapsedMs > 35000 ||
        !(
          s.peakRssBytes === null ||
          (count(s.peakRssBytes) && s.peakRssBytes > 0)
        ) ||
        !digest(s.stdoutSha256) ||
        !count(s.stdoutBytes) ||
        s.stdoutBytes > 4 * 1024 * 1024 ||
        !count(s.stderrBytes) ||
        s.stderrBytes > 4 * 1024 * 1024,
    )
  )
    throw Error(
      "측정 결과 형식이 올바르지 않습니다. / Invalid benchmark result.",
    );
  // Copy only validated fields; do not retain arbitrary worker properties.
  return {
    schema: 1,
    warmupRuns: 1,
    memoryMethod: r.memoryMethod,
    ...(r.memoryNote ? { memoryNote: r.memoryNote } : {}),
    environment: {
      platform: r.environment.platform,
      arch: r.environment.arch,
      python: r.environment.python,
      executableSha256: r.environment.executableSha256,
    },
    samples: r.samples.map((s) => ({
      elapsedMs: s.elapsedMs,
      peakRssBytes: s.peakRssBytes,
      stdoutSha256: s.stdoutSha256,
      stdoutBytes: s.stdoutBytes,
      stderrBytes: s.stderrBytes,
    })),
  };
}
export function summarizeBenchmark(result: BenchmarkResult) {
  const outputs = new Set(
    result.samples.map((s) => `${s.stdoutBytes}:${s.stdoutSha256}`),
  );
  return {
    time: distribution(result.samples.map((s) => s.elapsedMs)),
    memory: result.samples.every((s) => s.peakRssBytes !== null)
      ? distribution(result.samples.map((s) => s.peakRssBytes!))
      : null,
    stableOutput: outputs.size === 1,
    hasOutput: result.samples.some((s) => s.stdoutBytes > 0),
    hasStderr: result.samples.some((s) => s.stderrBytes > 0),
  };
}
export function compareBenchmarks(
  before: BenchmarkResult,
  after: BenchmarkResult,
) {
  const a = summarizeBenchmark(before),
    b = summarizeBenchmark(after);
  const compatible =
    before.memoryMethod === after.memoryMethod &&
    ["platform", "arch", "python"].every(
      (key) =>
        before.environment[key as keyof typeof before.environment] ===
        after.environment[key as keyof typeof after.environment],
    );
  const outputsMatch =
    a.stableOutput &&
    b.stableOutput &&
    before.samples[0].stdoutSha256 === after.samples[0].stdoutSha256 &&
    before.samples[0].stdoutBytes === after.samples[0].stdoutBytes;
  return {
    before: a,
    after: b,
    compatible,
    outputsMatch,
    executableChanged:
      before.environment.executableSha256 !==
      after.environment.executableSha256,
    // Observed ranges are not statistical confidence intervals.
    rangesOverlap: !(a.time.max < b.time.min || b.time.max < a.time.min),
    timeChangePercent:
      compatible && outputsMatch
        ? (b.time.median / a.time.median - 1) * 100
        : null,
    memoryChangePercent:
      compatible && outputsMatch && a.memory && b.memory
        ? (b.memory.median / a.memory.median - 1) * 100
        : null,
  };
}
