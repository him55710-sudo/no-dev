import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeFile } from "../src/core/analyze";
import { makePatch } from "../src/core/edit";
import { compareScenarios } from "../src/core/scenarios";

describe("published examples", () => {
  it.each([
    ["shipping", "freeShippingThreshold", "70000", "calculateShipping", [60000], 0, 3000],
    ["trial", "trialDays", "30", "isTrialActive", [14], false, true],
    ["discount", "memberDiscount", "0.15", "calculateDiscount", [10000, true], 1000, 1500],
  ] as const)("%s matches the documented walkthrough", (name, ruleName, value, fn, args, before, after) => {
    const file = { path: `${name}.ts`, content: readFileSync(`examples/${name}.ts`, "utf8") };
    const rule = analyzeFile(file).rules.find(r => r.name === ruleName)!;
    const patch = makePatch(file, rule.id, value);
    const row = compareScenarios([file], file.path, fn, [{ label: name, args: [...args] }], patch).rows[0];
    expect(row.status).toBe("changed");
    expect(row.before.result).toBe(before);
    expect(row.after?.result).toBe(after);
  });
});
