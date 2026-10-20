import { describe, expect, it } from "vitest";
import { analyzeFile } from "../src/core/analyze";
import { makePatch, applyPatch, parseRequest } from "../src/core/edit";
import { readFileSync } from "node:fs";

describe("source-derived JSON facts and literal editing", () => {
  it("shows retry data without claiming retries execute or are disabled in a consumer", () => {
    const file = {
      path: "retry.jsonc",
      content: readFileSync("examples/local-ai/semantic/retry.jsonc", "utf8"),
    };
    const a = analyzeFile(file);
    expect(a.data?.fields.map((f) => [f.path, f.type, f.preview])).toEqual([
      ['$["retryLimit"]', "number", "3"],
      ['$["backoffMs"]', "number", "250"],
      ['$["enabled"]', "boolean", "false"],
    ]);
    for (const lang of ["ko", "en"] as const) {
      const descriptions = a.steps
        .slice(1)
        .map((s) => s.text[lang])
        .join(" ");
      expect(descriptions).not.toMatch(/재시도|비활성|retries|disabled|delay/i);
    }
    expect(a.functions).toEqual([]);
    expect(
      a.data?.fields.every(
        (f) => file.content.slice(f.start, f.end) === f.preview,
      ),
    ).toBe(true);
  });
  it("keeps duplicate keys and proto-like keys visible without picking a consumer winner", () => {
    const a = analyzeFile({
      path: "data.json",
      content:
        '{"a":{"x":1},"\\u0061":{"x":2},"__proto__":{"polluted":true},"constructor":4}',
    });
    expect(a.syntaxValid).toBe(true);
    expect(a.data?.entries).toBe(4);
    expect(a.data?.fields.filter((f) => f.duplicate)).toHaveLength(4);
    expect(a.rules.map((r) => r.name)).toEqual([
      '$["__proto__"]["polluted"]',
      '$["constructor"]',
    ]);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(new Set(a.data?.fields.map((f) => f.id)).size).toBe(
      a.data?.fields.length,
    );
  });
  it("preserves exact large numbers, negative zero, precision and every surrounding byte", () => {
    const file = {
      path: "config.jsonc",
      content:
        '{\r\n // 유지 😀\r\n "id": 9007199254740993, "price": 0.1234567890123456789, "zero": -0,\r\n}',
    };
    const a = analyzeFile(file);
    expect(a.rules.map((r) => r.value)).toEqual([
      "9007199254740993",
      "0.1234567890123456789",
      "-0",
    ]);
    const id = a.rules[0];
    expect(id.line).toBe(3);
    const patch = makePatch(file, id.id, "9007199254740995");
    expect(patch.updated).toBe(
      file.content.replace("9007199254740993", "9007199254740995"),
    );
    expect(applyPatch(file, patch).content).toBe(patch.updated);
    expect(patch.semanticChecked).toBe(false);
    expect(() =>
      applyPatch({ ...file, content: file.content + " " }, patch),
    ).toThrow(/Stale/);
  });
  it("edits strings as strings and preserves comments, Unicode keys, URLs and other equal values", () => {
    const file = {
      path: "sample.jsonc",
      content:
        '{\r// comment\r"이름":"same", "nested":{"이름":"same"}, "url":"https://x.test/a//b",}',
    };
    const a = analyzeFile(file);
    expect(a.rules[0].line).toBe(3);
    const nested = a.rules.find((r) => r.name === '$["nested"]["이름"]')!;
    const input = '"</script>\n😀\\';
    const patch = makePatch(file, nested.id, input);
    expect(patch.newText).toBe(JSON.stringify(input));
    expect(patch.updated).toBe(
      file.content.slice(0, nested.start) +
        JSON.stringify(input) +
        file.content.slice(nested.end),
    );
    expect(analyzeFile({ ...file, content: patch.updated }).syntaxValid).toBe(
      true,
    );
    const request = parseRequest(
      'Change $["nested"]["이름"] to "new"',
      a.rules,
    );
    expect(request.rule.id).toBe(nested.id);
    expect(request.value).toBe("new");
  });
  it("handles scalar and array roots while keeping null different from a missing entry", () => {
    const a = analyzeFile({
      path: "items.json",
      content: '[null, false, "", {"x":[]}, 1e999]',
    });
    expect(a.data?.fields.map((f) => [f.path, f.type, f.preview])).toEqual([
      ["$[0]", "null", "null"],
      ["$[1]", "boolean", "false"],
      ["$[2]", "string", '""'],
      ["$[3]", "object", ""],
      ['$[3]["x"]', "array", ""],
      ["$[4]", "number", "1e999"],
    ]);
    expect(a.rules).toHaveLength(3);
    const file = { path: "scalar.json", content: "-0" };
    const rule = analyzeFile(file).rules[0];
    expect(rule.name).toBe("$");
    expect(makePatch(file, rule.id, "1.20e+4").updated).toBe("1.20e+4");
    expect(
      analyzeFile({ path: "empty.json", content: "{}" }).data?.fields,
    ).toEqual([]);
  });
  it("rejects JS-only numeric syntax, malformed data, no-op edits and overlong input", () => {
    const file = { path: "valid.json", content: '{"n":1}' };
    const rule = analyzeFile(file).rules[0];
    for (const value of ["+2", ".5", "1.", "01", "NaN", "Infinity", "2;evil()"])
      expect(() => makePatch(file, rule.id, value)).toThrow(/JSON number/);
    expect(() => makePatch(file, rule.id, "1")).toThrow(/No change/);
    expect(() => makePatch(file, rule.id, "1".repeat(4097))).toThrow(/4096/);
    const invalid = analyzeFile({ path: "invalid.json", content: '{"a":1,}' });
    expect(invalid.syntaxValid).toBe(false);
    expect(invalid.data).toBeUndefined();
    expect(invalid.rules).toEqual([]);
  });
  it("bounds displayed data and marks omissions without making the unshown fields editable", () => {
    const many = analyzeFile({
      path: "many.json",
      content: "[" + Array.from({ length: 1000 }, (_, i) => i).join(",") + "]",
    });
    expect(many.syntaxValid).toBe(true);
    expect(many.data?.truncated).toBe(true);
    expect(many.data?.fields).toHaveLength(300);
    expect(many.rules).toHaveLength(300);
    const deep = analyzeFile({
      path: "deep.json",
      content: "[".repeat(30) + "1" + "]".repeat(30),
    });
    expect(deep.data?.truncated).toBe(true);
    expect(deep.rules).toHaveLength(0);
    const long = analyzeFile({
      path: "long.json",
      content: JSON.stringify({ value: "x".repeat(5000) }),
    });
    expect(long.data?.fields[0].abbreviated).toBe(true);
    expect(long.data?.fields[0].note).toBeDefined();
    expect(long.rules).toEqual([]);
  });
});
