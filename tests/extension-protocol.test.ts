import { describe, it, expect } from "vitest";
import { inputString, requestMessage } from "../extension/src/protocol";
describe("webview message boundary", () => {
  it("rejects malformed envelopes and oversized user inputs", () => {
    for (const input of [
      null,
      4,
      { id: 5, action: "apply" },
      { id: "1", action: "apply", contextId: {} },
      { id: "1", action: "apply", payload: [] },
    ])
      expect(() => requestMessage(input)).toThrow();
    expect(() => inputString("x".repeat(4097))).toThrow();
    expect(() => inputString({ toString: () => "valid" })).toThrow();
  });
});
