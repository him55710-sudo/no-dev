import { describe, it, expect } from "vitest";
import { ProjectAnalyzer } from "../src/core/project";
import { writeFileSync, mkdirSync } from "node:fs";
describe("incremental project analysis", () => {
  it("only reparses changed files and drops deleted files", () => {
    const engine = new ProjectAnalyzer();
    const files = Array.from({ length: 300 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: `export const threshold=${i};\nexport function calculate(input:number){if(input>=threshold){return input*0.9;}return input;}\n`,
    }));
    const cold = engine.analyze(files);
    const warm = engine.analyze(files);
    const changed = engine.analyze(
      files.map((f, i) =>
        i === 101
          ? {
              ...f,
              content: f.content.replace("threshold=101", "threshold=200"),
            }
          : f,
      ),
    );
    expect(cold.cacheHits).toBe(0);
    expect(warm.cacheHits).toBe(300);
    expect(changed.cacheHits).toBe(299);
    expect(changed.files[101].rules[0].value).toBe(200);
    const removed = engine.analyze(files.slice(0, 100));
    expect(removed.files).toHaveLength(100);
    expect(removed.cacheHits).toBe(100);
    const report = {
      measuredAt: new Date().toISOString(),
      environment: "Node.js " + process.version,
      files: files.length,
      totalCharacters: files.reduce((s, f) => s + f.content.length, 0),
      coldMs: Number(cold.elapsed.toFixed(2)),
      cachedMs: Number(warm.elapsed.toFixed(2)),
      singleFileEditMs: Number(changed.elapsed.toFixed(2)),
      cacheHitsAfterEdit: changed.cacheHits,
      caveat:
        "Synthetic small functions, not representative of all projects; excludes worker transfer, startup and rendering.",
    };
    mkdirSync("docs", { recursive: true });
    writeFileSync(
      "docs/benchmark.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  });
});
