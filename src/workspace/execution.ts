import { z } from "zod";

export const checkNames = ["test", "typecheck", "check", "build"] as const;
const checksSchema = z
  .array(z.enum(checkNames))
  .min(1)
  .max(4)
  .refine(
    (names) => new Set(names).size === names.length,
    "검사 선택이 중복됩니다.",
  );
export const executionContextSchema = z
  .object({
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    executable: z.string().min(1).max(4096),
    model: z.string().max(1024),
    manager: z.enum(["npm", "pnpm", "yarn", "bun"]),
    scripts: z.partialRecord(z.enum(checkNames), z.string().max(32000)),
  })
  .strict();
export type ExecutionContext = z.infer<typeof executionContextSchema>;
/** Stable across object insertion order and unrelated workspace updates. */
export function executionKey(context: ExecutionContext) {
  return JSON.stringify([
    context.projectKey,
    context.executable,
    context.model,
    context.manager,
    ...checkNames.map((name) => context.scripts[name] ?? null),
  ]);
}
export const executionUseSchema = z
  .object({
    context: executionContextSchema,
    checks: checksSchema,
    allowExternal: z.literal(true),
    profileRevision: z.number().int().nonnegative(),
    useSaved: z.literal(true).optional(),
  })
  .strict();
export type ExecutionUse = z.infer<typeof executionUseSchema>;
export const executionApprovalSchema = executionUseSchema
  .omit({ profileRevision: true, useSaved: true })
  .extend({ savedAt: z.string().datetime() })
  .strict();
export const executionProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().nonnegative(),
    approval: executionApprovalSchema.nullable(),
  })
  .strict();
export type ExecutionProfile = z.infer<typeof executionProfileSchema>;
export const saveExecutionSchema = executionUseSchema
  .omit({ profileRevision: true, useSaved: true })
  .extend({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export type SaveExecution = z.infer<typeof saveExecutionSchema>;
export const revokeExecutionSchema = z
  .object({
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type RevokeExecution = z.infer<typeof revokeExecutionSchema>;
export function approvalMatches(
  profile: ExecutionProfile,
  context: ExecutionContext,
) {
  return (
    !!profile.approval &&
    profile.projectKey === context.projectKey &&
    executionKey(profile.approval.context) === executionKey(context)
  );
}
export function assertExecutionContext(
  request: Pick<ExecutionUse, "context" | "checks">,
  current: ExecutionContext,
) {
  if (executionKey(request.context) !== executionKey(current))
    throw Error(
      "실행기, 모델 또는 검사 명령이 바뀌었습니다. 구현 설정을 새로 확인해 주세요.",
    );
  if (request.checks.some((name) => current.scripts[name] === undefined))
    throw Error("선택한 검사 명령이 프로젝트에 없습니다.");
}
export type AgentConnection = {
  status: "checking" | "ready" | "signin" | "failed";
  message: string;
  provider?: string;
  checkedAt?: string;
};
