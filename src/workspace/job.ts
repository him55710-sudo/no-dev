import { z } from "zod";
import { relativePath } from "./model";
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
    | "interrupted"
    | "recovery"
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
  recovery?: { path: string; state: "before" | "after" | "conflict" }[];
};
export const jobSchema = z
  .object({
    id: z.string().uuid(),
    specId: z.string().min(1).max(4096),
    specRevision: z.number().int().nonnegative(),
    phase: z.enum([
      "preparing",
      "running",
      "approval",
      "checking",
      "repairing",
      "review",
      "applying",
      "applied",
      "undone",
      "cancelling",
      "cancelled",
      "failed",
      "interrupted",
      "recovery",
    ]),
    startedAt: z.string().datetime(),
    worktree: z.string().max(4096).optional(),
    provider: z.string().max(4096).optional(),
    message: z.string().max(32000),
    checks: z
      .array(
        z
          .object({
            name: z.string().max(100),
            status: z.enum(["passed", "failed", "timeout", "missing"]),
            exitCode: z.number().int().optional(),
            output: z.string().max(24000),
            elapsedMs: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(4),
    files: z
      .array(
        z
          .object({
            path: relativePath,
            kind: z.enum(["added", "modified", "deleted"]),
          })
          .strict(),
      )
      .max(200),
    reviewId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    approvals: z
      .array(
        z
          .object({
            id: z.string().max(1000),
            kind: z.enum(["command", "file"]),
            command: z.string().max(32000).optional(),
            reason: z.string().max(32000).optional(),
            cwd: z.string().max(4096).optional(),
          })
          .strict(),
      )
      .max(100),
    recovery: z
      .array(
        z
          .object({
            path: relativePath,
            state: z.enum(["before", "after", "conflict"]),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();
export type JobHistoryEntry = Pick<
  ImplementationJob,
  "id" | "startedAt" | "phase" | "specId"
> & { workspaceId: string };
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
