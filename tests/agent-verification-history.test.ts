import { expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ImplementationJobs } from "../extension/src/agent/jobs";
import type { ChangeRequest } from "../src/workspace/spec";
import type { ImplementationJob } from "../src/workspace/job";

it.each([true, false])(
  "retains real verification and review evidence through repair and restoration (repair succeeds: %s)",
  async (repairSucceeds) => {
    const parent = resolve("test-results/verification-history");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(resolve(parent, "run-"));
    const root = resolve(directory, "project"),
      storage = resolve(directory, "jobs");
    await cp("tests/fixtures/installed-recovery", root, { recursive: true });
    const peer = resolve(root, "app-server");
    const original = await readFile(peer, "utf8");
    // The first controlled turn deliberately leaves the server's status code wrong.
    // The repair turn fixes it. Real package scripts, Git copies and stdio are used.
    const modified = original
      .replace(
        "createInterface({ input:",
        "let repairing = false;\ncreateInterface({ input:",
      )
      .replace(
        'if (!lstatSync(".git").isFile()',
        'repairing = JSON.stringify(message.params).includes("independent verification below failed");\n    if (!lstatSync(".git").isFile()',
      )
      .replace(
        'const source = readFileSync(path, "utf8");',
        `if (path === "service.js" && (!repairing || ${!repairSucceeds})) continue;\n      const source = readFileSync(path, "utf8");\n      if (!source.includes(before) && source.includes(after)) continue;`,
      );
    expect(modified).not.toBe(original);
    await writeFile(peer, modified);
    const exec = promisify(execFile);
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", root, ...args], { windowsHide: true })).stdout;
    for (const args of [
      ["init"],
      ["config", "user.name", "Verification fixture"],
      ["config", "user.email", "fixture@example.invalid"],
      ["config", "core.autocrlf", "false"],
      ["add", "."],
      ["commit", "-m", "fixture"],
    ])
      await git(...args);
    const head = await git("rev-parse", "HEAD");
    const originalTest = await readFile(resolve(root, "test.js"), "utf8");
    const content = {
      title: "Sharing permission",
      purpose: "",
      desired: "Viewer reads but cannot edit in UI or server",
      policies: "",
      inputsOutputs: "",
      failures: "",
      invariants: ["Owner and editor keep editing"],
      acceptance: ["Viewer direct update rejects with 403 and preserves data"],
    };
    const request: ChangeRequest = {
      id: "permission@1",
      specId: "permission",
      specRevision: 1,
      graphRevision: "a".repeat(64),
      content,
      desired: content.desired,
      invariants: content.invariants,
      acceptance: content.acceptance,
      sources: [],
      scopePaths: ["policy.js", "service.js", "ui.js"],
    };
    const states: ImplementationJob[] = [];
    const jobs = new ImplementationJobs(storage, (state) =>
      states.push(structuredClone(state)),
    );
    try {
      await jobs.start(root, request, {
        executable: process.execPath,
        checks: ["test"],
        allowExternal: true,
      });
      const deadline = Date.now() + 90000;
      while (jobs.isRunning && Date.now() < deadline) {
        const approval = jobs.state?.approvals[0];
        if (approval) jobs.decide(approval.id, "accept");
        await delay(25);
      }
      expect(jobs.isRunning, JSON.stringify(jobs.state)).toBe(false);
      expect(jobs.state?.phase, jobs.state?.message).toBe("review");
      const finalStatus = repairSucceeds ? "passed" : "failed";
      expect(jobs.state?.checks[0].status).toBe(finalStatus);
      const history = jobs.state?.verificationAttempts;
      expect(
        history?.map((attempt) => [attempt.attempt, attempt.checks[0].status]),
      ).toEqual([
        [1, "failed"],
        [2, finalStatus],
      ]);
      expect(history?.[0].checks[0].output).toContain(
        "viewer reads but cannot edit",
      );
      expect(history?.[0].checks[0].exitCode).not.toBe(0);
      expect(history?.every((attempt) => attempt.completed)).toBe(true);
      if (repairSucceeds) expect(history?.[1].checks[0].exitCode).toBe(0);
      else expect(history?.[1].checks[0].exitCode).not.toBe(0);
      expect(
        states.some(
          (state) =>
            state.phase === "repairing" &&
            state.verificationAttempts?.[0].checks[0].status === "failed",
        ),
      ).toBe(true);
      if (!repairSucceeds) {
        const job = jobs.state!;
        await jobs.reviewDecision({
          jobId: job.id,
          reviewId: job.reviewId!,
          approvedScopePaths: [],
          reviewedVerificationPaths: [],
          acceptUnverified: false,
          criteria: job.assessment!.criteria.map((criterion) => ({
            id: criterion.id,
            outcome: criterion.kind === "acceptance" ? "failed" : "unverified",
            note:
              criterion.kind === "acceptance"
                ? "The real test reports the viewer request did not reject with status 403."
                : "",
            checkNames: ["test"],
          })),
        });
      }
      const restored = new ImplementationJobs(storage, () => {});
      try {
        await restored.restore(root, jobs.state!.id);
        expect(restored.state?.verificationAttempts).toEqual(history);
        expect(restored.state?.checks).toEqual(jobs.state?.checks);
        expect(restored.state?.reviewDecision).toEqual(
          jobs.state?.reviewDecision,
        );
        await expect(restored.apply(restored.state!.reviewId!)).rejects.toThrow(
          repairSucceeds ? /검토 기록/ : /검사가 통과/,
        );
      } finally {
        restored.dispose();
      }
      expect(await git("rev-parse", "HEAD")).toBe(head);
      expect(await git("status", "--porcelain")).toBe("");
      expect(
        await readFile(resolve(jobs.state!.worktree!, "test.js"), "utf8"),
      ).toBe(originalTest);
      await writeFile(
        resolve(parent, repairSucceeds ? "repaired.json" : "failed.json"),
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            provider: "Controlled stdio fixture; no external model",
            state: jobs.state,
            restoredHistoryEqual: true,
            originalGitPreserved: true,
            acceptanceTestsUnchanged: true,
            failedReviewRestored: !repairSucceeds,
            applyRejected: true,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      jobs.dispose();
    }
  },
  120000,
);
