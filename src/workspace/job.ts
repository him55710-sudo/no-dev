import { z } from "zod";
import { relativePath } from "./model";
import {
  reviewAssessmentSchema,
  reviewDecisionSchema,
  type ReviewAssessment,
  type ReviewDecision,
} from "./review";
export type VerificationName = "test" | "build" | "typecheck" | "check";
export type VerificationResult = {
  name: string;
  status: "passed" | "failed" | "timeout" | "missing";
  exitCode?: number;
  output: string;
  /** True when the beginning of the captured output was omitted. Absent in older records. */
  outputTruncated?: boolean;
  elapsedMs: number;
};
const checksSchema = z
  .array(
    z
      .object({
        name: z.string().max(100),
        status: z.enum(["passed", "failed", "timeout", "missing"]),
        exitCode: z.number().int().optional(),
        output: z.string().max(24000),
        outputTruncated: z.boolean().optional(),
        elapsedMs: z.number().nonnegative(),
      })
      .strict(),
  )
  .max(4);
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
  continuedFrom?: string;
  worktree?: string;
  provider?: string;
  message: string;
  checks: VerificationResult[];
  previousChecks?: VerificationResult[];
  /** Historical attempts never authorize applying the current candidate. */
  verificationAttempts?: {
    attempt: 1 | 2;
    completed: boolean;
    checks: VerificationResult[];
  }[];
  files: { path: string; kind: "added" | "modified" | "deleted" }[];
  reviewId?: string;
  assessment?: ReviewAssessment;
  reviewDecision?: ReviewDecision;
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
    continuedFrom: z.string().uuid().optional(),
    worktree: z.string().max(4096).optional(),
    provider: z.string().max(4096).optional(),
    message: z.string().max(32000),
    checks: checksSchema,
    previousChecks: checksSchema.optional(),
    verificationAttempts: z
      .array(
        z
          .object({
            attempt: z.union([z.literal(1), z.literal(2)]),
            completed: z.boolean(),
            checks: checksSchema,
          })
          .strict(),
      )
      .max(2)
      .optional(),
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
    assessment: reviewAssessmentSchema.optional(),
    reviewDecision: reviewDecisionSchema.optional(),
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
