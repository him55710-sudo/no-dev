import { analyzeFile, linkFiles } from "./analyze";
import type { FileAnalysis, ProjectAnalysis, SourceFile } from "./types";
export class ProjectAnalyzer {
  private cache = new Map<
    string,
    { content: string; analysis: FileAnalysis }
  >();
  analyze(files: SourceFile[]): ProjectAnalysis {
    const start = performance.now();
    let cacheHits = 0;
    const paths = new Set(files.map((f) => f.path));
    for (const path of this.cache.keys())
      if (!paths.has(path)) this.cache.delete(path);
    const analyses = files.map((f) => {
      const previous = this.cache.get(f.path);
      if (previous?.content === f.content) {
        cacheHits++;
        return previous.analysis;
      }
      const analysis = analyzeFile(f);
      this.cache.set(f.path, { content: f.content, analysis });
      return analysis;
    });
    return {
      files: linkFiles(analyses),
      elapsed: performance.now() - start,
      cacheHits,
    };
  }
}
