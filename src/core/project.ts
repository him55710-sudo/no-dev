import { analyzeFile, linkFiles } from "./analyze";
import type { FileAnalysis, ProjectAnalysis, SourceFile } from "./types";
import { normalizeGlossary, type GlossaryEntry } from "./glossary";
export class ProjectAnalyzer {
  private cache = new Map<
    string,
    { content: string; glossaryKey: string; analysis: FileAnalysis }
  >();
  analyze(
    files: SourceFile[],
    glossary: GlossaryEntry[] = [],
  ): ProjectAnalysis {
    const start = performance.now();
    const entries = normalizeGlossary(glossary);
    let cacheHits = 0;
    const paths = new Set(files.map((f) => f.path));
    for (const path of this.cache.keys())
      if (!paths.has(path)) this.cache.delete(path);
    const analyses = files.map((f) => {
      const previous = this.cache.get(f.path);
      const localTerms = entries.filter((e) => e.path === f.path);
      const glossaryKey = JSON.stringify([localTerms, f.sqlDialect]);
      if (
        previous?.content === f.content &&
        previous.glossaryKey === glossaryKey
      ) {
        cacheHits++;
        return previous.analysis;
      }
      const analysis = analyzeFile(f, localTerms);
      this.cache.set(f.path, { content: f.content, glossaryKey, analysis });
      return analysis;
    });
    return {
      files: linkFiles(analyses),
      elapsed: performance.now() - start,
      cacheHits,
    };
  }
}
