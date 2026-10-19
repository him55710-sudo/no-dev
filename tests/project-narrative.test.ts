import { describe, it, expect } from "vitest";
import {
  validateStories,
  validateOverview,
  validateChangeStory,
} from "../src/workspace/narrative";
const files = [{ path: "policy.ts", content: 'return role === "owner";' }];
const story = {
  path: "policy.ts",
  title: "수정 권한",
  summary: "소유자만 수정할 수 있습니다.",
  steps: [],
  rules: [],
  unknowns: [],
  evidence: [{ quote: 'role === "owner"', meaning: "소유자인지 확인합니다." }],
};
describe("source-grounded Korean project reading", () => {
  it("rejects missing files and invented evidence", () => {
    expect(validateStories({ files: [story] }, files).files).toHaveLength(1);
    expect(() =>
      validateStories({ files: [story] }, [
        ...files,
        { path: "service.ts", content: "hello" },
      ]),
    ).toThrow(/빠뜨/);
    expect(() =>
      validateStories(
        {
          files: [
            {
              ...story,
              evidence: [{ quote: "role === 'viewer'", meaning: "가짜" }],
            },
          ],
        },
        files,
      ),
    ).toThrow(/근거/);
  });
  it("requires every read file to be reachable from the overview", () => {
    const overview = {
      title: "공유",
      summary: "공유 기능",
      flow: ["권한 확인"],
      parts: [
        { title: "수정", summary: "수정 권한 확인", paths: ["policy.ts"] },
      ],
      unknowns: [],
    };
    expect(validateOverview(overview, [story]).parts).toHaveLength(1);
    expect(() =>
      validateOverview(
        {
          ...overview,
          parts: [{ ...overview.parts[0], paths: ["missing.ts"] }],
        },
        [story],
      ),
    ).toThrow(/연결/);
  });
  it("binds before and after explanations to the right versions and all changed paths", () => {
    const change = {
      path: "policy.ts",
      before: files[0].content,
      after: "return false;",
    };
    const raw = {
      changes: [
        {
          path: change.path,
          title: "수정 차단",
          before: "소유자가 수정 가능",
          after: "모두 수정 불가",
          beforeQuote: 'role === "owner"',
          afterQuote: "return false;",
          caution: "",
        },
      ],
    };
    expect(validateChangeStory(raw, [change]).changes).toHaveLength(1);
    expect(() =>
      validateChangeStory(raw, [{ ...change, after: "return true;" }]),
    ).toThrow(/근거/);
    expect(() =>
      validateChangeStory(raw, [
        change,
        { path: "new.ts", before: null, after: "x" },
      ]),
    ).toThrow(/빠진/);
  });
});
