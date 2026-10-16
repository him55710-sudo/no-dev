import { describe, expect, it } from "vitest";
import { validatePython } from "../extension/src/pythonValidation";
describe("isolated Python syntax validation", () => {
  it("reports an unavailable interpreter without treating it as a pass", async () => {
    expect(
      (await validatePython("x = 1", "pureobom-no-such-python")).status,
    ).toBe("unavailable");
  });
  it("parses supported Python without executing a top-level exception", async () => {
    const result = await validatePython(
      'raise RuntimeError("must not execute")\nvalue = "한글"\n',
    );
    expect(result.status).toBe("syntax-passed");
    expect((await validatePython("def broken(\n")).status).toBe(
      "syntax-failed",
    );
  });
});
