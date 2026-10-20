import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { ProjectNarrator } from "../extension/src/projectNarrator";
import type { CodeBlock } from "../src/workspace/codeReading";
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => {
      const target = resolve(path);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !basename(target).startsWith("pureobom-reading-")
      )
        throw Error(
          "Refusing to remove a path outside this test's temporary directory.",
        );
      return rm(target, { recursive: true, force: true });
    }),
  );
});
async function setup() {
  const cache = await mkdtemp(join(tmpdir(), "pureobom-reading-"));
  temporary.push(cache);
  const narrator = new ProjectNarrator({
    executable: "unused-test-executable",
    cwd: cache,
    cache,
  });
  const generate = vi.spyOn(
    narrator as unknown as { json: (...args: unknown[]) => Promise<unknown> },
    "json",
  );
  return { narrator, generate, cache };
}
function response(startLine = 1, endLine = 1) {
  const block: CodeBlock = {
    startLine,
    endLine,
    title: "값 정하기",
    purpose: "기본값을 정합니다.",
    inputs: [],
    outputs: ["기본값"],
    steps: Array.from({ length: endLine - startLine + 1 }, (_, i) => ({
      startLine: startLine + i,
      endLine: startLine + i,
      explanation: "기본값을 1로 정합니다.",
      example: "",
    })),
    rationale: {
      basis: "unknown",
      explanation: "1을 선택한 이유는 알 수 없습니다.",
      quote: "",
    },
    changes: [],
    unknowns: [],
  };
  return { blocks: [block] };
}
describe("file reading generation and cache", () => {
  it("validates cached evidence and keys on full source instead of file name alone", async () => {
    const { narrator, generate, cache } = await setup();
    generate.mockResolvedValue(response());
    const source = {
      path: "config.ts",
      content: "export const defaultValue = 1;\n",
    };
    const signal = new AbortController().signal;
    const reading = await narrator.readFile(source, "first", signal, () => {});
    expect(reading.source).toBe(source.content);
    expect(reading.blocks).toHaveLength(1);
    expect(
      (await narrator.readFile(source, "second", signal, () => {})).revision,
    ).toBe("second");
    expect(generate).toHaveBeenCalledTimes(1);
    const [name] = await readdir(cache);
    await writeFile(join(cache, name), JSON.stringify({ blocks: [] }));
    await narrator.readFile(source, "second", signal, () => {});
    expect(generate).toHaveBeenCalledTimes(2);
    await narrator.readFile(
      { ...source, content: source.content.replace("1", "2") },
      "third",
      signal,
      () => {},
    );
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it("retries incomplete coverage once, then preserves all chunks without re-summarizing", async () => {
    const { narrator, generate } = await setup();
    generate
      .mockResolvedValueOnce(response(2, 80))
      .mockResolvedValueOnce(response(1, 80))
      .mockResolvedValueOnce(response(81, 82));
    const source = {
      path: "many.ts",
      content: "const value = 1;\n".repeat(82),
    };
    const reading = await narrator.readFile(
      source,
      "r",
      new AbortController().signal,
      () => {},
    );
    expect(
      reading.blocks.map((block) => [block.startLine, block.endLine]),
    ).toEqual([
      [1, 80],
      [81, 82],
    ]);
    expect(reading.lineCount).toBe(82);
    expect(reading.source).toBe(source.content);
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it("does not cache or publish a cancelled completion", async () => {
    const { narrator, generate, cache } = await setup();
    const abort = new AbortController();
    generate.mockImplementation(async () => {
      abort.abort();
      return response();
    });
    await expect(
      narrator.readFile(
        { path: "x.ts", content: "const x=1;" },
        "r",
        abort.signal,
        () => {},
      ),
    ).rejects.toThrow();
    expect(await readdir(cache)).toEqual([]);
  });
  it("fails after two invalid answers and handles an empty source without a model", async () => {
    const { narrator, generate } = await setup();
    generate.mockResolvedValue({ blocks: [] });
    await expect(
      narrator.readFile(
        { path: "x.ts", content: "x" },
        "r",
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(2);
    const empty = await narrator.readFile(
      { path: "empty.ts", content: "" },
      "r",
      new AbortController().signal,
      () => {},
    );
    expect(empty.lineCount).toBe(0);
    expect(empty.blocks).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
