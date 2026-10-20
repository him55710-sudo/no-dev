import { z } from "zod";
import { relativePath, type StructureGraph } from "./model";
import type { SourceFile } from "./narrative";

const text = z.string().trim().min(1).max(2400);
const line = z.number().int().positive();
export const codeBlockSchema = z
  .object({
    startLine: line,
    endLine: line,
    title: z.string().trim().min(1).max(120),
    purpose: text,
    inputs: z.array(text).max(12),
    outputs: z.array(text).max(12),
    steps: z
      .array(
        z
          .object({
            startLine: line,
            endLine: line,
            explanation: text,
            example: z.string().max(2400),
          })
          .strict(),
      )
      .min(1)
      .max(80),
    rationale: z
      .object({
        basis: z.enum(["explicit", "inferred", "unknown"]),
        explanation: text,
        quote: z.string().max(2000),
      })
      .strict(),
    changes: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(120),
            current: text,
            evidence: z.string().min(1).max(2000),
            request: text,
            effect: text,
            caution: text,
          })
          .strict(),
      )
      .max(6),
    unknowns: z.array(text).max(12),
  })
  .strict();
export const readingChunkSchema = z
  .object({
    blocks: z.array(codeBlockSchema).min(1).max(80),
  })
  .strict();
export type CodeBlock = z.infer<typeof codeBlockSchema>;
export type ReadingChunk = {
  startLine: number;
  endLine: number;
  content: string;
};
export type FileReading = {
  path: string;
  revision: string;
  sourceHash: string;
  source: string;
  lineCount: number;
  blocks: CodeBlock[];
  createdAt: string;
  model: string;
  contextScope: "whole-file" | "surrounding-code";
};
export const fileReadingRequestSchema = z
  .object({
    projectKey: z.string(),
    revision: z.string(),
    path: relativePath,
  })
  .strict();
export const readingAnchorSchema = z
  .object({
    path: relativePath,
    revision: z.string(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    startLine: line,
    endLine: line,
  })
  .strict();
export function assertReadingAnchor(
  anchor: z.infer<typeof readingAnchorSchema>,
  reading: FileReading | undefined,
  graph: StructureGraph,
  targetIds: string[],
) {
  if (
    !reading ||
    reading.path !== anchor.path ||
    reading.revision !== anchor.revision ||
    reading.sourceHash !== anchor.sourceHash ||
    graph.revision !== anchor.revision ||
    graph.files.find((file) => file.path === anchor.path)?.hash !==
      anchor.sourceHash ||
    !reading.blocks.some(
      (block) =>
        block.startLine === anchor.startLine &&
        block.endLine === anchor.endLine,
    ) ||
    !graph.nodes.some(
      (node) =>
        targetIds.includes(node.id) &&
        node.kind === "file" &&
        node.sources.some((source) => source.path === anchor.path),
    )
  )
    throw Error(
      "수정할 코드와 읽은 설명이 일치하지 않습니다. 해당 부분을 다시 읽어 주세요.",
    );
}

/** Keep CRLF, bare CR, Unicode and the final newline byte-for-byte. */
export function sourceLines(content: string): string[] {
  return (
    content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter((part) => part !== "") ??
    []
  );
}
export function sourceRange(
  source: string,
  startLine: number,
  endLine: number,
) {
  return sourceLines(source)
    .slice(startLine - 1, endLine)
    .join("");
}
export function readingChunks(source: string): ReadingChunk[] {
  const lines = sourceLines(source);
  const chunks: ReadingChunk[] = [];
  let start = 0,
    length = 0;
  for (let index = 0; index < lines.length; index++) {
    // An exceptionally long single line is kept whole, never cut mid-expression.
    if (
      index > start &&
      (index - start >= 80 || length + lines[index].length > 16000)
    ) {
      chunks.push({
        startLine: start + 1,
        endLine: index,
        content: lines.slice(start, index).join(""),
      });
      start = index;
      length = 0;
    }
    length += lines[index].length;
  }
  if (start < lines.length)
    chunks.push({
      startLine: start + 1,
      endLine: lines.length,
      content: lines.slice(start).join(""),
    });
  return chunks;
}
export function readingContext(file: SourceFile, chunk: ReadingChunk) {
  const lines = sourceLines(file.content);
  if (file.content.length <= 64000)
    return {
      complete: true,
      ranges: [{ startLine: 1, endLine: lines.length, content: file.content }],
    };
  const around = {
    startLine: Math.max(1, chunk.startLine - 24),
    endLine: Math.min(lines.length, chunk.endLine + 24),
  };
  const ranges =
    around.startLine <= 25
      ? [{ ...around, startLine: 1 }]
      : [{ startLine: 1, endLine: 24 }, around];
  return {
    complete: false,
    ranges: ranges.map((range) => ({
      ...range,
      content: lines.slice(range.startLine - 1, range.endLine).join(""),
    })),
  };
}

/** Coverage is a verifiable source mapping, not proof of semantic correctness. */
export function validateReadingChunk(
  raw: unknown,
  file: SourceFile,
  chunk: ReadingChunk,
) {
  const result = readingChunkSchema.parse(raw);
  let nextLine = chunk.startLine;
  for (const block of result.blocks) {
    if (
      block.startLine !== nextLine ||
      block.endLine < block.startLine ||
      block.endLine > chunk.endLine
    )
      throw Error("설명에서 코드 일부가 빠졌거나 원문 범위가 겹칩니다.");
    let nextStep = block.startLine;
    for (const step of block.steps) {
      if (
        step.startLine !== nextStep ||
        step.endLine < step.startLine ||
        step.endLine > block.endLine
      )
        throw Error("읽는 순서에 빠지거나 겹치는 코드가 있습니다.");
      if (step.endLine - step.startLine >= 12)
        throw Error(
          "한 설명에 너무 많은 코드가 묶였습니다. 12줄 이하로 나눠 읽어 주세요.",
        );
      nextStep = step.endLine + 1;
    }
    if (nextStep !== block.endLine + 1)
      throw Error("읽는 순서에서 코드의 마지막 부분이 빠졌습니다.");
    const source = sourceRange(file.content, block.startLine, block.endLine);
    if (block.rationale.basis === "explicit" && !block.rationale.quote.trim())
      throw Error("작성 이유를 확인했다고 표시하려면 실제 근거가 필요합니다.");
    if (block.rationale.quote && !file.content.includes(block.rationale.quote))
      throw Error("작성 이유의 근거가 해당 파일에 없습니다.");
    for (const change of block.changes)
      if (!change.evidence.trim() || !source.includes(change.evidence))
        throw Error("수정 제안의 근거가 해당 코드에 없습니다.");
    nextLine = block.endLine + 1;
  }
  if (nextLine !== chunk.endLine + 1)
    throw Error("설명에서 코드의 마지막 부분이 빠졌습니다.");
  return result.blocks;
}

export function readingChangeContext(file: FileReading, block: CodeBlock) {
  return [
    `읽고 선택한 부분: ${block.title}`,
    `역할: ${block.purpose}`,
    `코드 위치: ${file.path}, ${block.startLine}~${block.endLine}줄`,
    `읽은 원문 식별값: ${file.sourceHash}`,
    "이 위치의 실제 원문을 읽어 변경하세요. 연결된 다른 코드와 검사에 미치는 영향도 확인하세요.",
  ].join("\n");
}
