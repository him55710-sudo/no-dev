import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import {
  readingChunks,
  sourceLines,
  sourceRange,
  validateReadingChunk,
  assertReadingAnchor,
  readingChangeContext,
  readingContext,
  type FileReading,
  type CodeBlock,
} from "../src/workspace/codeReading";

const file = {
  path: "shipping.ts",
  content:
    "// 무료배송은 구매 금액에 따라 적용합니다.\r\nexport function fee(total: number) {\r\n  return total >= 50000 ? 0 : 3000;\r\n}\r\n",
};
const block: CodeBlock = {
  startLine: 1,
  endLine: 4,
  title: "배송비 정하기",
  purpose: "구매 금액으로 배송비를 정합니다.",
  inputs: ["구매 금액"],
  outputs: ["배송비"],
  steps: [
    {
      startLine: 1,
      endLine: 2,
      explanation: "구매 금액을 받아 배송비를 정하는 일을 준비합니다.",
      example: "",
    },
    {
      startLine: 3,
      endLine: 4,
      explanation: "5만 원 이상이면 무료, 적으면 3천 원을 돌려줍니다.",
      example: "5만 원 → 0원, 4만 원 → 3천 원",
    },
  ],
  rationale: {
    basis: "explicit",
    explanation: "구매 금액에 따른 무료배송 정책입니다.",
    quote: "// 무료배송은 구매 금액에 따라 적용합니다.",
  },
  changes: [
    {
      title: "무료배송 기준",
      current: "5만 원부터 무료입니다.",
      evidence: "total >= 50000",
      request: "무료배송 기준을 3만 원으로 바꿔줘.",
      effect: "3만 원 이상 주문도 무료가 됩니다.",
      caution: "기준 미만 주문과 정확히 기준인 주문을 확인하세요.",
    },
  ],
  unknowns: [],
};
const raw = () => structuredClone({ blocks: [block] });

describe("complete, source-linked code reading", () => {
  it("preserves every source character while segmenting CRLF, CR, Unicode and large single lines", () => {
    const source =
      Array.from(
        { length: 180 },
        (_, i) => `${i}:한글🌱${i % 2 ? "\r\n" : "\r"}`,
      ).join("") +
      "x".repeat(18000) +
      "\nend";
    const chunks = readingChunks(source);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((chunk) => chunk.content).join("")).toBe(source);
    expect(sourceLines(source).join("")).toBe(source);
    expect(chunks[0].startLine).toBe(1);
    for (let i = 1; i < chunks.length; i++)
      expect(chunks[i].startLine).toBe(chunks[i - 1].endLine + 1);
    expect(chunks.at(-1)?.endLine).toBe(182);
    expect(sourceRange(file.content, 3, 4)).toBe(
      "  return total >= 50000 ? 0 : 3000;\r\n}\r\n",
    );
    expect(readingChunks("")).toEqual([]);
    expect(sourceLines("\n\n")).toEqual(["\n", "\n"]);
  });
  it("rejects omissions and overlap at both block and explanation levels", () => {
    const chunk = readingChunks(file.content)[0];
    expect(validateReadingChunk(raw(), file, chunk)).toEqual([block]);
    for (const mutation of [
      (value: ReturnType<typeof raw>) => {
        value.blocks[0].startLine = 2;
      },
      (value: ReturnType<typeof raw>) => {
        value.blocks[0].endLine = 3;
      },
      (value: ReturnType<typeof raw>) => {
        value.blocks[0].steps[1].startLine = 2;
      },
      (value: ReturnType<typeof raw>) => {
        value.blocks[0].steps[1].startLine = 4;
      },
      (value: ReturnType<typeof raw>) => {
        value.blocks[0].steps.pop();
      },
      (value: ReturnType<typeof raw>) => {
        value.blocks.push(block);
      },
    ]) {
      const value = raw();
      mutation(value);
      expect(() => validateReadingChunk(value, file, chunk)).toThrow(/빠|겹/);
    }
  });
  it("supplies earlier definitions to later chunks and labels bounded context explicitly", () => {
    const content = "const rule = 'required';\n" + "check(rule);\n".repeat(90);
    const chunks = readingChunks(content);
    expect(readingContext({ path: "rules.ts", content }, chunks[1])).toEqual({
      complete: true,
      ranges: [{ startLine: 1, endLine: 91, content }],
    });
    const big = "value();\n".repeat(10000);
    const context = readingContext(
      { path: "large.ts", content: big },
      readingChunks(big)[40],
    );
    expect(context.complete).toBe(false);
    expect(context.ranges[0].startLine).toBe(1);
    for (const range of context.ranges)
      expect(range.content).toBe(
        sourceRange(big, range.startLine, range.endLine),
      );
  });
  it("does not allow one large summary to masquerade as a detailed reading", () => {
    const big = { path: file.path, content: "const value = 1;\n".repeat(20) };
    const value = raw();
    value.blocks[0].endLine = 20;
    value.blocks[0].steps = [
      {
        startLine: 1,
        endLine: 20,
        explanation: "값을 준비합니다.",
        example: "",
      },
    ];
    expect(() =>
      validateReadingChunk(value, big, readingChunks(big.content)[0]),
    ).toThrow(/12줄/);
  });
  it("requires actual evidence in the selected block for reasons and edit proposals", () => {
    const chunk = readingChunks(file.content)[0];
    const missing = raw();
    missing.blocks[0].rationale.quote = "";
    expect(() => validateReadingChunk(missing, file, chunk)).toThrow(/근거/);
    const invented = raw();
    invented.blocks[0].changes[0].evidence = "total > 70000";
    expect(() => validateReadingChunk(invented, file, chunk)).toThrow(/근거/);
    const guessed = raw();
    guessed.blocks[0].rationale.basis = "inferred";
    guessed.blocks[0].rationale.quote = "";
    expect(validateReadingChunk(guessed, file, chunk)).toHaveLength(1);
  });
  it("rejects stale, wrong-file and wrong-range modification anchors", async () => {
    const graph = await analyzeStructure([
      file,
      { path: "other.ts", content: "export const other = 1;" },
    ]);
    const target = graph.nodes.find(
      (node) => node.kind === "file" && node.sources[0].path === file.path,
    )!;
    const other = graph.nodes.find(
      (node) => node.kind === "file" && node.sources[0].path === "other.ts",
    )!;
    const reading: FileReading = {
      path: file.path,
      revision: graph.revision,
      sourceHash: graph.files.find((item) => item.path === file.path)!.hash,
      source: file.content,
      lineCount: 4,
      blocks: [block],
      createdAt: "",
      model: "test",
      contextScope: "whole-file",
    };
    const anchor = {
      path: file.path,
      revision: reading.revision,
      sourceHash: reading.sourceHash,
      startLine: 1,
      endLine: 4,
    };
    expect(() =>
      assertReadingAnchor(anchor, reading, graph, [target.id]),
    ).not.toThrow();
    for (const bad of [
      { ...anchor, revision: "old" },
      { ...anchor, sourceHash: "f".repeat(64) },
      { ...anchor, endLine: 3 },
    ])
      expect(() =>
        assertReadingAnchor(bad, reading, graph, [target.id]),
      ).toThrow(/일치/);
    expect(() =>
      assertReadingAnchor(anchor, reading, graph, [other.id]),
    ).toThrow(/일치/);
    expect(() =>
      assertReadingAnchor(anchor, undefined, graph, [target.id]),
    ).toThrow(/일치/);
    const context = readingChangeContext(reading, block);
    expect(context).toContain("shipping.ts, 1~4줄");
    expect(context).toContain(reading.sourceHash);
  });
});
