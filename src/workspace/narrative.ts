import { z } from "zod";
import { relativePath } from "./model";

const sentence = z.string().min(1).max(2000);
export const fileStorySchema = z
  .object({
    path: relativePath,
    title: z.string().min(1).max(100),
    summary: sentence,
    steps: z.array(sentence).max(10),
    rules: z.array(sentence).max(10),
    unknowns: z.array(sentence).max(8),
    evidence: z
      .array(
        z.object({ quote: z.string().max(500), meaning: sentence }).strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export const storyBatchSchema = z
  .object({ files: z.array(fileStorySchema).min(1).max(100) })
  .strict();
export type FileStory = z.infer<typeof fileStorySchema>;
export const overviewSchema = z
  .object({
    title: z.string().min(1).max(100),
    summary: sentence,
    flow: z.array(sentence).min(1).max(8),
    parts: z
      .array(
        z
          .object({
            title: z.string().min(1).max(100),
            summary: sentence,
            paths: z.array(relativePath).min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    unknowns: z.array(sentence).max(10),
  })
  .strict();
export type ProjectStory = z.infer<typeof overviewSchema> & {
  revision: string;
  createdAt: string;
  model: string;
  files: FileStory[];
  sourceFileCount: number;
  sourceBytes: number;
};
export const changeStorySchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            path: relativePath,
            title: z.string().min(1).max(100),
            before: sentence,
            after: sentence,
            beforeQuote: z.string().max(500),
            afterQuote: z.string().max(500),
            caution: z.string().max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type ChangeStory = z.infer<typeof changeStorySchema> & {
  reviewId: string;
};
export type ReadingProgress = {
  completed: number;
  total: number;
  message: string;
};
export type SourceFile = { path: string; content: string };

/** This is a source-grounding check, not a claim that model interpretation is infallible. */
export function validateStories(raw: unknown, files: SourceFile[]) {
  const result = storyBatchSchema.parse(raw);
  const expected = new Map(files.map((file) => [file.path, file.content]));
  if (
    result.files.length !== expected.size ||
    new Set(result.files.map((file) => file.path)).size !== expected.size
  )
    throw Error("AI가 일부 파일 설명을 빠뜨렸습니다. 다시 읽어 주세요.");
  for (const file of result.files) {
    const source = expected.get(file.path);
    if (
      source === undefined ||
      file.evidence.some(
        (item) =>
          (!item.quote && source.length > 0) || !source.includes(item.quote),
      )
    )
      throw Error(
        "AI 설명의 근거가 현재 코드와 맞지 않습니다. 다시 읽어 주세요.",
      );
  }
  return result;
}
export function validateOverview(raw: unknown, files: FileStory[]) {
  const result = overviewSchema.parse(raw),
    paths = new Set(files.map((file) => file.path));
  const covered = new Set(result.parts.flatMap((part) => part.paths));
  if (
    [...covered].some((path) => !paths.has(path)) ||
    [...paths].some((path) => !covered.has(path))
  )
    throw Error("전체 설명에 연결되지 않은 파일이 있습니다. 다시 읽어 주세요.");
  return result;
}
export function validateChangeStory(
  raw: unknown,
  files: { path: string; before: string | null; after: string | null }[],
) {
  const result = changeStorySchema.parse(raw);
  if (
    result.changes.length !== files.length ||
    new Set(result.changes.map((row) => row.path)).size !== files.length
  )
    throw Error("변경 전후 설명에 빠진 파일이 있습니다.");
  for (const row of result.changes) {
    const file = files.find((file) => file.path === row.path);
    if (
      !file ||
      (file.before
        ? !row.beforeQuote || !file.before.includes(row.beforeQuote)
        : row.beforeQuote !== "") ||
      (file.after
        ? !row.afterQuote || !file.after.includes(row.afterQuote)
        : row.afterQuote !== "")
    )
      throw Error("변경 전후 설명의 근거가 실제 코드와 맞지 않습니다.");
  }
  return result;
}
