// Read-only analysis of the prepared external Next fixture. No model or app code runs.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

assert.ok(process.argv[2], "Pass the prepared Next baseline Git directory");
const source = resolve(process.argv[2]);
const git = (...args) =>
  execFileSync("git", ["-C", source, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
const baseline = {
  head: git("rev-parse", "HEAD").trim(),
  index: git("diff", "--cached"),
  status: git("status", "--porcelain"),
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const hashes = Object.fromEntries(
  await Promise.all(
    tracked.map(async (path) => [
      path,
      digest(await readFile(resolve(source, path))),
    ]),
  ),
);
const paths = tracked.filter((path) =>
  /\.(?:[cm]?[jt]sx?|jsonc?|md|py|go|rs|java|cs|html|css|sql)$/.test(path),
);
const files = await Promise.all(
  paths.map(async (path) => ({
    path,
    content: await readFile(resolve(source, path), "utf8"),
  })),
);
const run = await mkdtemp(resolve(tmpdir(), "pureobom-callbacks-"));
const runtime = resolve(run, "analysis.cjs");
await build({
  stdin: {
    contents:
      "export {analyzeStructure} from './src/workspace/analyze'; export {implementationScope} from './src/workspace/spec';",
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: runtime,
  platform: "node",
  format: "cjs",
  mainFields: ["module", "main"],
  bundle: true,
});
const { analyzeStructure, implementationScope } = createRequire(
  import.meta.url,
)(runtime);
const graph = await analyzeStructure(files);
const page = "app/(dashboard)/dashboard/page.tsx";
const pageNode = graph.nodes.find(
  (n) => n.kind === "file" && n.sources[0]?.path === page,
);
assert.ok(pageNode);
const references = [
  "removeTeamMember",
  "inviteTeamMember",
  "customerPortalAction",
].map((name) => {
  const target = graph.nodes.find(
    (n) => n.kind === "symbol" && n.label === name,
  );
  assert.ok(target, name);
  const edges = graph.edges.filter(
    (e) => e.target === target.id && e.sources.some((s) => s.path === page),
  );
  assert.equal(edges.length, 1, name);
  assert.equal(edges[0].kind, "passes", name);
  const edge = edges[0];
  const owner = graph.nodes.find((n) => n.id === edge.source);
  assert.ok(
    implementationScope(graph, [owner.id]).paths.includes(
      target.sources[0].path,
    ),
    name,
  );
  const excerpts = edge.sources.map((ref) => {
    const text = files
      .find((f) => f.path === ref.path)
      .content.slice(ref.start, ref.end);
    assert.equal(text, name);
    return { ...ref, text };
  });
  return {
    name,
    owner: owner.label,
    path: target.sources[0].path,
    kind: edge.kind,
    sources: excerpts,
  };
});
const before = process.argv[3]
  ? JSON.parse(await readFile(resolve(process.argv[3]), "utf8"))
  : undefined;
if (before) {
  assert.equal(before.sourceHead, baseline.head);
  assert.deepEqual(
    before.files,
    graph.files,
    "Compare identical source files and hashes",
  );
  for (const expected of references)
    assert.deepEqual(
      before.references.find((r) => r.name === expected.name)?.fromPage,
      [],
    );
}
for (const path of tracked)
  assert.equal(
    digest(await readFile(resolve(source, path))),
    hashes[path],
    path,
  );
assert.equal(git("rev-parse", "HEAD").trim(), baseline.head);
assert.equal(git("diff", "--cached"), baseline.index);
assert.equal(git("status", "--porcelain"), baseline.status);
const report = {
  checkedAt: new Date().toISOString(),
  sourceHead: baseline.head,
  files: graph.files,
  graphRevision: graph.revision,
  selected: page,
  references,
  scopePaths: implementationScope(graph, [pageNode.id]).paths,
  beforeHead: before?.head,
  matchedBeforeSnapshot: !!before,
  sourceFilesPreserved: tracked.length,
  gitPreserved: true,
  provider: "none",
  scope:
    "Read-only compiler analysis and change-scope traversal; not application execution or runtime callback proof. Scope follows static connections and may include shared consumers.",
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/callback-structure.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    references: references.map((r) => ({
      name: r.name,
      owner: r.owner,
      kind: r.kind,
      lines: r.sources.map((s) => s.line),
    })),
    files: graph.files.length,
    preserved: tracked.length,
    matchedBeforeSnapshot: !!before,
  }),
);
