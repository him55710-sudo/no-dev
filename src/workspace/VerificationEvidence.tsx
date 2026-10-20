import type { VerificationResult } from "./job";

export const verificationStatusLabels: Record<
  VerificationResult["status"],
  string
> = {
  passed: "통과",
  failed: "실패",
  timeout: "시간 초과",
  missing: "명령 없음",
};

export function VerificationEvidence({ check }: { check: VerificationResult }) {
  return (
    <details>
      <summary>
        {check.name} · {verificationStatusLabels[check.status]} ·{" "}
        {(check.elapsedMs / 1000).toFixed(1)}초
      </summary>
      {check.exitCode !== undefined ? (
        <p>프로세스 종료 코드: {check.exitCode}</p>
      ) : null}
      {check.outputTruncated ? (
        <p>출력 앞부분을 생략했습니다. 마지막 24,000자만 보관된 기록입니다.</p>
      ) : null}
      <pre>{check.output || "보관된 출력이 없습니다."}</pre>
    </details>
  );
}
