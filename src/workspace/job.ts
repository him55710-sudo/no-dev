export type VerificationName = "test" | "build" | "typecheck" | "check";
export type VerificationResult = {
  name: string;
  status: "passed" | "failed" | "timeout" | "missing";
  exitCode?: number;
  output: string;
  elapsedMs: number;
};
export type ImplementationJob = {
  id: string;
  specId: string;
  specRevision: number;
  phase:
    | "preparing"
    | "running"
    | "approval"
    | "checking"
    | "repairing"
    | "review"
    | "applying"
    | "applied"
    | "undone"
    | "cancelling"
    | "cancelled"
    | "failed";
  startedAt: string;
  worktree?: string;
  provider?: string;
  message: string;
  checks: VerificationResult[];
  files: { path: string; kind: "added" | "modified" | "deleted" }[];
  reviewId?: string;
  approvals: {
    id: string;
    kind: "command" | "file";
    command?: string;
    reason?: string;
    cwd?: string;
  }[];
};
export const jobIsActive = (job?: ImplementationJob) =>
  !!job &&
  [
    "preparing",
    "running",
    "approval",
    "checking",
    "repairing",
    "applying",
    "cancelling",
  ].includes(job.phase);
