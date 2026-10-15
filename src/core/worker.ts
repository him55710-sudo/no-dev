import { analyzeFile } from "./analyze";
import { ProjectAnalyzer } from "./project";
import { makePatch, parseRequest } from "./edit";
import { simulate } from "./simulate";
import { compareScenarios } from "./scenarios";
const analyzer = new ProjectAnalyzer();
self.onmessage = (event: MessageEvent) => {
  const { id, type, payload } = event.data;
  try {
    let result: unknown;
    if (type === "analyze") {
      result = analyzer.analyze(payload.files);
    } else if (type === "patch") {
      result = makePatch(payload.file, payload.ruleId, payload.value);
    } else if (type === "request") {
      const a = analyzeFile(payload.file);
      const r = parseRequest(payload.request, a.rules);
      result = makePatch(payload.file, r.rule.id, r.value);
    } else if (type === "compare") {
      result = compareScenarios(
        payload.files,
        payload.path,
        payload.name,
        payload.scenarios,
        payload.patch,
      );
    } else if (type === "simulate")
      result = simulate(
        payload.files,
        payload.path,
        payload.name,
        payload.args,
      );
    else throw Error("Unknown worker operation");
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
