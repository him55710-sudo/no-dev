import { describe, expect, it } from "vitest";
import { feedbackMarkdown, type FeedbackInput } from "../src/core/feedback";
import { productResource, productVersion } from "../src/product";

const example: FeedbackInput = {
  lang: "ko",
  environment: "browser",
  project: "example",
  outcome: "completed",
  task: "가입 버튼 문구를 바꾸기",
  detail: "변경안을 확인하고 적용했어요.",
};
describe("voluntary feedback summary", () => {
  it("contains the user's account and minimal context, without attached project data", () => {
    const input = {
      ...example,
      source: "SECRET_SOURCE",
      path: "PRIVATE_PATH",
      workspace: "PRIVATE_WORKSPACE",
      email: "PRIVATE_IDENTITY",
    };
    const report = feedbackMarkdown(input);
    expect(report).toContain(example.task);
    expect(report).toContain(example.detail);
    expect(report).toContain(`Version: ${productVersion}`);
    expect(report).toContain("Environment: browser");
    expect(report).toContain("원하는 변경을 완료했어요");
    expect(report).not.toMatch(
      /SECRET_SOURCE|PRIVATE_PATH|PRIVATE_WORKSPACE|PRIVATE_IDENTITY/,
    );
  });
  it("preserves multiline text inside a fence that cannot be closed by the answer", () => {
    const report = feedbackMarkdown({
      ...example,
      task: "첫 줄\r\n```\r\n<script>run()</script>\r\n두 번째 줄",
    });
    expect(report).toContain(
      "````text\n첫 줄\n```\n<script>run()</script>\n두 번째 줄\n````",
    );
  });
  it("makes unsupported and failed experiences distinct from completed tasks", () => {
    const report = feedbackMarkdown({
      ...example,
      lang: "en",
      environment: "vscode",
      project: "own",
      outcome: "unsupported",
      detail: "",
    });
    expect(report).toContain("My task is not supported");
    expect(report).toContain("My own project");
    expect(report).toContain("Not provided");
    expect(report).not.toContain("I completed");
  });
  it("requires an actual task and rejects invalid selections and hidden control characters", () => {
    expect(() => feedbackMarkdown({ ...example, task: "  " })).toThrow();
    expect(() =>
      feedbackMarkdown({ ...example, task: "a".repeat(1201) }),
    ).toThrow();
    expect(() =>
      feedbackMarkdown({ ...example, detail: "hello\u202Ehidden" }),
    ).toThrow();
    expect(() =>
      feedbackMarkdown({
        ...example,
        outcome: "__proto__" as FeedbackInput["outcome"],
      }),
    ).toThrow();
    expect(() =>
      feedbackMarkdown({ ...example, project: "" as FeedbackInput["project"] }),
    ).toThrow();
  });
});

describe("fixed product links", () => {
  it("opens only known project destinations and never embeds feedback or source", () => {
    for (const resource of ["install", "repository", "feedback"]) {
      const url = new URL(productResource(resource));
      expect(url.origin).toBe("https://github.com");
      expect(url.pathname.startsWith("/him55710-sudo/no-dev/")).toBe(true);
      expect(url.searchParams.has("body")).toBe(false);
    }
    expect(
      new URL(productResource("feedback")).searchParams.get("template"),
    ).toBe("experience.yml");
    for (const invalid of [
      "__proto__",
      "constructor",
      "toString",
      "https://other.example",
      undefined,
      {},
      "install?body=secret",
    ])
      expect(() => productResource(invalid)).toThrow();
  });
});
