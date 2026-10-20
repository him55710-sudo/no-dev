import { useEffect, useRef, useState } from "react";
import {
  compareBenchmarks,
  summarizeBenchmark,
} from "../../src/core/benchmark";
import type { Lang } from "../../src/core/types";
import type { BenchmarkPlan, Measurement } from "../src/benchmarks";
import type { ViewState } from "../src/protocol";
import type { ProjectTask } from "../src/projectChecks";
import { request } from "./bridge";

export function Benchmarks({
  state,
  lang,
  task,
}: {
  state: ViewState;
  lang: Lang;
  task?: ProjectTask;
}) {
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const [prepared, setPrepared] = useState<{
    plan: BenchmarkPlan;
    context: string;
    taskId: string;
  }>();
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({
    mounted: true,
    context: state.contextId,
    taskId: task?.id,
  });
  current.current.context = state.contextId;
  current.current.taskId = task?.id;
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  const plan =
    prepared?.context === state.contextId && prepared.taskId === task?.id
      ? prepared.plan
      : undefined;
  const result = state.benchmark;
  const running = result?.status === "running" || result?.status === "stopping";
  const checking =
    state.projectCheck?.status === "running" ||
    state.projectCheck?.status === "stopping";
  const disabled =
    busy || running || checking || state.busy || state.dirty || !state.trusted;
  const comparison =
    result?.baseline && result.candidate
      ? compareBenchmarks(result.baseline.result, result.candidate.result)
      : undefined;
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (current.current.mounted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current.current.mounted) setBusy(false);
    }
  }
  function measurement(item: Measurement, label: string) {
    const summary = summarizeBenchmark(item.result);
    return (
      <div className="project-check-result">
        <h4>
          {label} · {item.folder}/{item.file}
        </h4>
        {item.result.memoryNote === "windows-venv-launcher" ? (
          <p className="muted">
            {t(
              "Windows Python 가상환경 실행기는 별도 프로세스를 띄웁니다. 실행기 자체의 메모리는 비교에서 제외했습니다.",
              "The Windows Python venv launcher starts a separate process. Launcher-only memory is excluded from this comparison.",
            )}
          </p>
        ) : null}
        <p>
          {t("실행 시간 중앙값", "Median elapsed time")}:{" "}
          <strong>{summary.time.median.toFixed(2)} ms</strong> ·{" "}
          {t("관측 범위", "Observed range")}: {summary.time.min.toFixed(2)}–
          {summary.time.max.toFixed(2)} ms
        </p>
        <p>
          {t("프로세스 최대 메모리 중앙값", "Median peak process memory")}:{" "}
          {summary.memory
            ? `${(summary.memory.median / 1048576).toFixed(2)} MiB`
            : t("확인 불가", "Unavailable")}
        </p>
        <p>
          {item.check
            ? t(
                "이 파일 버전에서 프로젝트 명령 정상 종료 기록 있음",
                "A project check exited successfully for this file version",
              )
            : t(
                "이 파일 버전의 프로젝트 검사 기록 없음",
                "No project check recorded for this file version",
              )}
        </p>
        {!summary.stableOutput || !summary.hasOutput || summary.hasStderr ? (
          <p className="banner">
            {!summary.stableOutput
              ? t(
                  "실행마다 출력이 달라 비교에 사용할 수 없습니다.",
                  "Output differs between runs; unsuitable for comparison.",
                )
              : !summary.hasOutput
                ? t(
                    "출력이 없어 같은 결과인지 판단할 수 없습니다. 별도 테스트가 필요합니다.",
                    "No output to compare. Separate correctness tests are needed.",
                  )
                : t(
                    "표준 오류 출력이 있습니다. 명령을 별도로 실행해 내용을 확인하세요.",
                    "The command wrote to stderr. Run it separately to inspect that output.",
                  )}
          </p>
        ) : null}
        <details>
          <summary>
            {t(
              "원본 측정 7회와 파일 기록",
              "Seven raw measurements and file record",
            )}
          </summary>
          <p className="muted">SHA-256: {item.sourceSha256}</p>
          <p>
            {new Date(item.startedAt).toLocaleString(
              lang === "ko" ? "ko-KR" : "en-US",
            )}{" "}
            · {item.result.memoryMethod}
          </p>
          <pre>{JSON.stringify(item.result.samples, null, 2)}</pre>
        </details>
      </div>
    );
  }
  return (
    <section className="benchmark-panel">
      <h3>{t("변경 전후 성능 측정", "Measure before and after")}</h3>
      <p>
        {t(
          "위에서 반복 실행해도 되는 process 명령을 선택하세요. 변경 전 측정 → 코드 수정·저장·검사 → 같은 명령으로 변경 후 측정 순서입니다. 로컬 Python 3가 필요합니다.",
          "Select a repeatable process command above. Record a baseline, edit/save/check the code, then measure the same command again. Requires local Python 3.",
        )}
      </p>
      <button
        disabled={disabled || task?.kind !== "process"}
        onClick={() =>
          void act(async () => {
            const context = state.contextId,
              taskId = task!.id;
            const next = await request<BenchmarkPlan>(
              "benchmarkPrepare",
              { id: taskId },
              context,
            );
            if (
              current.current.mounted &&
              current.current.context === context &&
              current.current.taskId === taskId
            ) {
              setPrepared({ plan: next, context, taskId });
              setReviewed(false);
            }
          })
        }
      >
        {t("측정 명령 확인", "Review measurement command")}
      </button>
      {plan ? (
        <>
          <pre>{JSON.stringify(plan.argv, null, 2)}</pre>
          <p className="muted">
            {plan.cwd} · Python: {plan.python}
          </p>
          <p>
            {t(
              "준비 1회 + 측정 7회, 실행마다 최대 30초입니다. 이 명령은 실제 코드이며 파일·외부 서비스를 변경할 수 있습니다. 반복해도 되는 입력과 명령을 사용하세요.",
              "One warm-up and seven measured runs, up to 30 seconds each. This executes real code that may change files or external services. Use repeatable inputs and commands.",
            )}
          </p>
          <label className="local-ack">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy || running}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t(
              "명령을 확인했고 8회 반복 실행해도 됩니다.",
              "I reviewed this command and it can run eight times.",
            )}
          </label>
          <div className="actions">
            {(["baseline", "candidate"] as const).map((phase) => (
              <button
                key={phase}
                disabled={
                  disabled ||
                  !reviewed ||
                  (phase === "candidate" &&
                    (!result?.baseline || !!result.invalidReason))
                }
                onClick={() =>
                  void act(async () => {
                    await request(
                      "benchmarkRun",
                      { id: plan.id, phase, reviewed },
                      state.contextId,
                    );
                    if (current.current.mounted) {
                      setPrepared(undefined);
                      setReviewed(false);
                    }
                  })
                }
              >
                {phase === "baseline"
                  ? t(
                      "변경 전 측정 · 이전 기록 교체",
                      "Record baseline · replaces previous record",
                    )
                  : t("변경 후 측정", "Measure changed code")}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {running ? (
        <p role="status">
          {t("측정 중", "Measuring")} · {result?.completed || 0}/7{" "}
          <button
            disabled={busy || result?.status === "stopping"}
            onClick={() =>
              void act(async () => {
                await request("benchmarkCancel");
              })
            }
          >
            {t("측정 중단", "Stop measurement")}
          </button>
        </p>
      ) : null}
      {error || result?.error ? (
        <p role="alert" className="banner error">
          {error || result?.error}
        </p>
      ) : null}
      {result?.invalidReason || result?.candidateStale ? (
        <p className="banner">
          {t(
            "파일·조건이 바뀌어 현재 코드의 비교로 사용할 수 없습니다.",
            "Files or conditions changed; this comparison is not valid for the current code.",
          )}{" "}
          {result.invalidReason}
        </p>
      ) : null}
      {result?.baseline
        ? measurement(result.baseline, t("변경 전", "Before"))
        : null}
      {result?.candidate
        ? measurement(result.candidate, t("변경 후", "After"))
        : null}
      {comparison && !result?.invalidReason && !result?.candidateStale ? (
        <div className="banner">
          {!comparison.compatible || !comparison.outputsMatch ? (
            <p>
              {t(
                "환경 또는 출력이 달라 개선률을 계산하지 않았습니다.",
                "Environment or output differs; no improvement percentage is calculated.",
              )}
            </p>
          ) : (
            <>
              <p>
                {t("실행 시간 중앙값 변화", "Change in median elapsed time")}:{" "}
                {comparison.timeChangePercent!.toFixed(1)}% ·{" "}
                {t(
                  "음수는 감소, 양수는 증가",
                  "Negative means less; positive means more",
                )}
              </p>
              {comparison.memoryChangePercent !== null ? (
                <p>
                  {t("메모리 중앙값 변화", "Change in median peak memory")}:{" "}
                  {comparison.memoryChangePercent.toFixed(1)}%
                </p>
              ) : null}
              <p>
                {comparison.rangesOverlap
                  ? t(
                      "두 관측 범위가 겹칩니다. 반복 측정의 흔들림을 함께 보세요.",
                      "Observed ranges overlap. Consider the variation between runs.",
                    )
                  : t(
                      "관측 범위가 겹치지 않습니다. 다른 입력·실행 순서에서도 확인하세요.",
                      "Observed ranges do not overlap. Check other inputs and run orders too.",
                    )}
              </p>
              {comparison.executableChanged ? (
                <p>
                  {t(
                    "실행 파일의 해시도 달라졌습니다. 보고서에서 확인하세요.",
                    "The executable hash also changed. Inspect the report.",
                  )}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {result?.baseline ? (
        <button
          disabled={busy || running}
          onClick={() =>
            void act(async () => {
              await request("benchmarkReport");
            })
          }
        >
          {t("측정 기록을 JSON 문서로 열기", "Open measurement report as JSON")}
        </button>
      ) : null}
      <p className="muted">
        {t(
          "명령 시작·입출력을 포함한 시간과 OS의 프로세스 최대 메모리입니다. 전체 앱의 메모리나 함수별 성능을 뜻하지 않습니다. 출력 일치와 검사 정상 종료만으로 모든 동작·최적화가 입증되지 않습니다. 원본 코드는 업로드하지 않습니다. 보고서에는 로컬 경로·명령 인수가 있으니 공유 전에 확인하세요.",
          "Measures command startup/I/O and OS peak process memory, not whole-app memory or function-only performance. Matching output and a successful check do not prove all behavior or optimization. Source is not uploaded. Reports include local paths and command arguments; review before sharing.",
        )}
      </p>
    </section>
  );
}
