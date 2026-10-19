import { describe, expect, it } from "vitest";
import {
  assessReview,
  assertReviewReady,
  validateReviewDecision,
  type ReviewDecision,
} from "../src/workspace/review";
import type { ChangeRequest } from "../src/workspace/spec";
import type { VerificationResult } from "../src/workspace/job";
const request: ChangeRequest = {
  id: "policy@1",
  specId: "policy",
  specRevision: 1,
  graphRevision: "a".repeat(64),
  content: {
    title: "Permission",
    purpose: "",
    desired: "Deny viewer edits",
    policies: "",
    inputsOutputs: "",
    failures: "",
    invariants: ["Owner still edits"],
    acceptance: ["Viewer API returns 403"],
  },
  desired: "Deny viewer edits",
  invariants: ["Owner still edits"],
  acceptance: ["Viewer API returns 403"],
  sources: [],
  scopePaths: ["src/policy.ts"],
};
const review = {
  id: "b".repeat(64),
  workspaceId: "11111111-1111-4111-8111-111111111111",
  files: [
    { path: "src/policy.ts" },
    { path: "test.js" },
    { path: "tests/permission.test.ts" },
    { path: "package.json" },
    { path: "docs/change.md" },
    { path: "src/contest.ts" },
  ],
};
const checks: VerificationResult[] = [
  {
    name: "test",
    status: "passed",
    exitCode: 0,
    output: "viewer denied",
    elapsedMs: 10,
  },
  {
    name: "build",
    status: "failed",
    exitCode: 1,
    output: "error",
    elapsedMs: 10,
  },
];
const assessment = assessReview(request, review);
const decision = (): ReviewDecision => ({
  jobId: review.workspaceId,
  reviewId: review.id,
  approvedScopePaths: [],
  reviewedVerificationPaths: [],
  acceptUnverified: false,
  criteria: assessment.criteria.map((item) => ({
    id: item.id,
    outcome: "unverified",
    note: "",
    checkNames: [],
  })),
});
describe("implementation review evidence", () => {
  it("compares real paths and marks test/configuration candidates without semantic claims", () => {
    expect(
      assessment.files.find((file) => file.path === "src/policy.ts")
        ?.outsideScope,
    ).toBe(false);
    expect(
      assessment.files.find((file) => file.path === "docs/change.md")
        ?.outsideScope,
    ).toBe(true);
    expect(
      assessment.files
        .filter((file) => file.verification)
        .map((file) => [file.path, file.verification]),
    ).toEqual([
      ["test.js", "test"],
      ["tests/permission.test.ts", "test"],
      ["package.json", "configuration"],
    ]);
    expect(
      assessment.files.find((file) => file.path === "src/contest.ts")
        ?.verification,
    ).toBeUndefined();
    expect(assessment.criteria.map((item) => item.kind)).toEqual([
      "acceptance",
      "invariant",
    ]);
  });
  it("never turns passing commands into confirmed criteria or implicit scope permission", () => {
    const saved = validateReviewDecision(assessment, checks, decision());
    expect(saved.criteria.every((item) => item.outcome === "unverified")).toBe(
      true,
    );
    expect(() => assertReviewReady(assessment, checks, saved)).toThrow(
      /범위 밖/,
    );
    saved.approvedScopePaths = assessment.files
      .filter((file) => file.outsideScope)
      .map((file) => file.path);
    expect(() => assertReviewReady(assessment, checks, saved)).toThrow(
      /검사 설정/,
    );
    saved.reviewedVerificationPaths = assessment.files
      .filter((file) => file.verification)
      .map((file) => file.path);
    expect(() => assertReviewReady(assessment, checks, saved)).toThrow(
      /아직 확인/,
    );
    saved.acceptUnverified = true;
    expect(
      assertReviewReady(assessment, checks, saved).criteria[0].outcome,
    ).toBe("unverified");
  });
  it("requires actual observations and only links available successful check records", () => {
    const value = decision();
    value.criteria[0] = {
      ...value.criteria[0],
      outcome: "confirmed",
      checkNames: ["test"],
    };
    expect(() => validateReviewDecision(assessment, checks, value)).toThrow(
      /관찰/,
    );
    value.criteria[0].note =
      "viewer direct API returns 403 in the recorded test output";
    expect(
      validateReviewDecision(assessment, checks, value).criteria[0].checkNames,
    ).toEqual(["test"]);
    value.criteria[0].checkNames = ["build"];
    expect(() => validateReviewDecision(assessment, checks, value)).toThrow(
      /통과한 검사/,
    );
    value.criteria[0].checkNames = ["invented"];
    expect(() => validateReviewDecision(assessment, checks, value)).toThrow(
      /현재 변경/,
    );
  });
  it("binds records to the exact job, proposal, criteria and files and never applies known failures", () => {
    expect(() =>
      validateReviewDecision(assessment, checks, {
        ...decision(),
        jobId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow(/바뀌었/);
    expect(() =>
      validateReviewDecision(assessment, checks, {
        ...decision(),
        reviewId: "c".repeat(64),
      }),
    ).toThrow(/바뀌었/);
    expect(() =>
      validateReviewDecision(assessment, checks, {
        ...decision(),
        criteria: [],
      }),
    ).toThrow(/빠짐없이/);
    expect(() =>
      validateReviewDecision(assessment, checks, {
        ...decision(),
        approvedScopePaths: ["unknown.ts"],
      }),
    ).toThrow(/없는 파일/);
    const value = decision();
    value.approvedScopePaths = assessment.files
      .filter((file) => file.outsideScope)
      .map((file) => file.path);
    value.reviewedVerificationPaths = assessment.files
      .filter((file) => file.verification)
      .map((file) => file.path);
    value.criteria[0] = {
      ...value.criteria[0],
      outcome: "failed",
      note: "viewer can still edit",
    };
    value.acceptUnverified = true;
    expect(
      validateReviewDecision(assessment, checks, value).criteria[0].outcome,
    ).toBe("failed");
    expect(() => assertReviewReady(assessment, checks, value)).toThrow(
      /실패한 완료 기준/,
    );
  });
  it("links failed, timed-out and missing checks to unresolved criteria without treating them as confirmation", () => {
    const actual: VerificationResult[] = [
      checks[1],
      {
        name: "test",
        status: "timeout",
        output: "request did not finish",
        elapsedMs: 100,
      },
      {
        name: "typecheck",
        status: "missing",
        output: "script missing",
        elapsedMs: 1,
      },
    ];
    const value = decision();
    value.criteria[0].checkNames = actual.map((check) => check.name);
    expect(
      validateReviewDecision(assessment, actual, value).criteria[0].outcome,
    ).toBe("unverified");
    value.criteria[0].outcome = "failed";
    value.criteria[0].note =
      "The build failed; the other checks could not establish the expected behavior.";
    expect(
      validateReviewDecision(assessment, actual, value).criteria[0].checkNames,
    ).toEqual(["build", "test", "typecheck"]);
    value.criteria[0].outcome = "confirmed";
    expect(() => validateReviewDecision(assessment, actual, value)).toThrow(
      /통과한 검사/,
    );
    value.criteria[0].outcome = "unverified";
    value.criteria[0].checkNames = ["invented"];
    expect(() => validateReviewDecision(assessment, actual, value)).toThrow(
      /현재 변경/,
    );
    value.criteria[0].checkNames = ["test", "test"];
    expect(() => validateReviewDecision(assessment, actual, value)).toThrow(
      /현재 변경/,
    );
  });
});
