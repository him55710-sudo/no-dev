import { describe, expect, it } from "vitest";
import { analyzeFile } from "../src/core/analyze";
import { validateAssistantChange } from "../src/core/assistantValidation";
import { readJsonStructure } from "../src/core/jsonData";
import { eligible } from "../src/core/import";

describe("JSON and JSONC boundaries", () => {
  it("allows comments and trailing commas only for JSONC", () => {
    expect(eligible("config/settings.jsonc")).toBe(true);
    const source =
      '{ // 정책\n "url": "https://example.com/*literal*/", "fee": 3000,\n}';
    expect(readJsonStructure(source, true)).toEqual({
      type: "object",
      entries: 2,
    });
    expect(validateAssistantChange("jsonc", source).status).toBe(
      "syntax-passed",
    );
    expect(validateAssistantChange("json", source).status).toBe(
      "syntax-failed",
    );
    expect(
      analyzeFile({ path: "settings.jsonc", content: source }).steps[0].text.ko,
    ).toContain("2개 항목");
  });
  it("accepts scalar and array roots without requiring a tsconfig object", () => {
    expect(readJsonStructure("[1, /* second */ 2,]", true)).toEqual({
      type: "array",
      entries: 2,
    });
    expect(readJsonStructure("true // setting", true).type).toBe("boolean");
    expect(readJsonStructure("null", true).type).toBe("null");
  });
  it("rejects fault-tolerant partial parse results and executable expressions", () => {
    for (const source of [
      '{"fee": }',
      "{fee: 3}",
      '{"fee": process.exit()}',
      "/* only comment */",
      '{"a": 1} garbage',
    ]) {
      expect(validateAssistantChange("jsonc", source).status).toBe(
        "syntax-failed",
      );
      expect(
        analyzeFile({ path: "broken.jsonc", content: source }).syntaxValid,
      ).toBe(false);
    }
  });
  it("reads property names without assigning user data to object prototypes", () => {
    expect(
      readJsonStructure(
        '{"__proto__":{"polluted":true},"constructor":3}',
        true,
      ),
    ).toEqual({ type: "object", entries: 2 });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
