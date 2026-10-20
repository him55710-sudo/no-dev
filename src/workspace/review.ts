import { z } from "zod";
import { relativePath } from "./model";
import type { ChangeRequest } from "./spec";
import type { VerificationResult } from "./job";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewDecisionSchema = z
  .object({
    jobId: z.string().uuid(),
    reviewId: digest,
    approvedScopePaths: z.array(relativePath).max(200),
    reviewedVerificationPaths: z.array(relativePath).max(200),
    acceptUnverified: z.boolean(),
    criteria: z
      .array(
        z
          .object({
            id: z.string().max(100),
            outcome: z.enum(["confirmed", "unverified", "failed"]),
            note: z.string().max(2000),
            checkNames: z.array(z.string().max(100)).max(4),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export const reviewAssessmentSchema = z
  .object({
    jobId: z.string().uuid(),
    reviewId: digest,
    files: z
      .array(
        z
          .object({
            path: relativePath,
            outsideScope: z.boolean(),
            verification: z.enum(["test", "configuration"]).optional(),
          })
          .strict(),
      )
      .max(200),
    criteria: z
      .array(
        z
          .object({
            id: z.string().max(100),
            kind: z.enum(["acceptance", "invariant"]),
            text: z.string().max(2000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type ReviewAssessment = z.infer<typeof reviewAssessmentSchema>;
type ReviewInput = {
  id: string;
  workspaceId: string;
  files: { path: string }[];
};

/** Path-based review hints, not a claim that a test was weakened or a behavior verified. */
export function assessReview(
  request: ChangeRequest,
  review: ReviewInput,
): ReviewAssessment {
  const scope = new Set(request.scopePaths);
  return reviewAssessmentSchema.parse({
    jobId: review.workspaceId,
    reviewId: review.id,
    files: review.files.map(({ path }) => ({
      path,
      outsideScope: !scope.has(path),
      verification:
        /(?:^|\/)(?:__tests__|tests?|e2e|cypress|playwright)(?:\/|\.[cm]?[jt]sx?$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.snap$/i.test(
          path,
        )
          ? "test"
          : /(?:^|\/)(?:package\.json|(?:pnpm-lock|yarn|package-lock|bun)\.(?:yaml|lock|json|lockb)|(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json|(?:vitest|vite|jest|playwright|cypress)\.config\.[^/]+)$|(?:^|\/)(?:scripts|\.github\/workflows)\//i.test(
                path,
              )
            ? "configuration"
            : undefined,
    })),
    criteria: [
      ...request.acceptance.map((text, i) => ({
        id: `acceptance:${i}`,
        kind: "acceptance",
        text,
      })),
      ...request.invariants.map((text, i) => ({
        id: `invariant:${i}`,
        kind: "invariant",
        text,
      })),
    ],
  });
}
const sameSet = (actual: string[], expected: string[]) =>
  actual.length === new Set(actual).size &&
  actual.length === expected.length &&
  actual.every((value) => expected.includes(value));

/** A saved review may record failure or uncertainty; applying has stricter requirements. */
export function validateReviewDecision(
  assessment: ReviewAssessment,
  checks: VerificationResult[],
  raw: unknown,
): ReviewDecision {
  const decision = reviewDecisionSchema.parse(raw);
  if (
    decision.jobId !== assessment.jobId ||
    decision.reviewId !== assessment.reviewId
  )
    throw Error("검토할 변경이 바뀌었습니다. 최신 변경을 다시 확인해 주세요.");
  if (
    !sameSet(
      decision.criteria.map((item) => item.id),
      assessment.criteria.map((item) => item.id),
    )
  )
    throw Error("완료 기준과 유지 조건을 빠짐없이 검토 기록에 포함해 주세요.");
  for (const item of decision.criteria) {
    if (item.outcome !== "unverified" && !item.note.trim())
      throw Error(
        "확인하거나 실패한 기준에는 관찰한 결과와 근거를 적어 주세요.",
      );
    if (
      new Set(item.checkNames).size !== item.checkNames.length ||
      item.checkNames.some(
        (name) => checks.filter((check) => check.name === name).length !== 1,
      )
    )
      throw Error("현재 변경의 검사 기록을 중복 없이 연결해 주세요.");
    if (
      item.outcome === "confirmed" &&
      item.checkNames.some(
        (name) =>
          checks.find((check) => check.name === name)?.status !== "passed",
      )
    )
      throw Error(
        "확인 완료 기준에는 실제 통과한 검사만 근거로 연결할 수 있습니다. 실패·미완료 기록은 실패 또는 미확인 기준에 연결해 주세요.",
      );
  }
  for (const [paths, expected] of [
    [
      decision.approvedScopePaths,
      assessment.files
        .filter((file) => file.outsideScope)
        .map((file) => file.path),
    ],
    [
      decision.reviewedVerificationPaths,
      assessment.files
        .filter((file) => file.verification)
        .map((file) => file.path),
    ],
  ]) {
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path) => !expected.includes(path))
    )
      throw Error("현재 변경에 없는 파일을 검토 기록에 포함할 수 없습니다.");
  }
  return decision;
}
export function assertReviewReady(
  assessment: ReviewAssessment,
  checks: VerificationResult[],
  raw: unknown,
) {
  if (!raw)
    throw Error("변경 범위와 완료 기준의 검토 기록을 먼저 저장해 주세요.");
  const decision = validateReviewDecision(assessment, checks, raw);
  if (
    !sameSet(
      decision.approvedScopePaths,
      assessment.files
        .filter((file) => file.outsideScope)
        .map((file) => file.path),
    )
  )
    throw Error(
      "처음 수집한 범위 밖의 변경 파일을 확인하고 반영을 허용해 주세요.",
    );
  if (
    !sameSet(
      decision.reviewedVerificationPaths,
      assessment.files
        .filter((file) => file.verification)
        .map((file) => file.path),
    )
  )
    throw Error("테스트와 검사 설정의 변경을 확인해 주세요.");
  if (decision.criteria.some((item) => item.outcome === "failed"))
    throw Error("실패한 완료 기준이나 유지 조건이 있어 반영할 수 없습니다.");
  if (
    decision.criteria.some((item) => item.outcome === "unverified") &&
    !decision.acceptUnverified
  )
    throw Error(
      "아직 확인하지 않은 기준이 있습니다. 확인하거나 미확인 상태의 반영을 명시적으로 선택해 주세요.",
    );
  return decision;
}
