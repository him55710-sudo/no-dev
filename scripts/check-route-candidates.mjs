// Compare framework route candidates on an unchanged external baseline, without
// executing its application code, model providers or verification commands.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";

assert.ok(process.argv[2], "Pass the prepared external baseline Git directory");
assert.ok(
  process.argv[3],
  "Pass the analyzer's prior Git ref for the comparison",
);
const source = resolve(process.argv[2]);
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
const prior = git(
  process.cwd(),
  "rev-parse",
  "--verify",
  `${process.argv[3]}^{commit}`,
).trim();
const baseline = {
  head: git(source, "rev-parse", "HEAD").trim(),
  index: git(source, "diff", "--cached"),
  status: git(source, "status", "--porcelain"),
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tracked = git(source, "ls-files", "-z").split("\0").filter(Boolean);
const contents = await Promise.all(
  tracked.map(async (path) => ({
    path,
    bytes: await readFile(resolve(source, path)),
  })),
);
const hashes = new Map(contents.map((file) => [file.path, digest(file.bytes)]));
const files = contents
  .filter((file) =>
    /\.(?:[cm]?[jt]sx?|jsonc?|md|py|go|rs|java|cs|html|css|sql)$/.test(
      file.path,
    ),
  )
  .map((file) => ({ path: file.path, content: file.bytes.toString("utf8") }));
const run = await mkdtemp(resolve(tmpdir(), "pureobom-route-candidates-"));
async function analyze(version) {
  const output = resolve(run, `${version}.cjs`);
  await build({
    stdin: {
      contents: "export {analyzeStructure} from './src/workspace/analyze';",
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile: output,
    platform: "node",
    format: "cjs",
    bundle: true,
    mainFields: ["module", "main"],
    plugins:
      version === "before"
        ? [
            {
              name: "committed-source",
              setup(builder) {
                builder.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, (args) => {
                  const path = relative(process.cwd(), args.path).replaceAll(
                    "\\",
                    "/",
                  );
                  if (!path.startsWith("src/")) return;
                  return {
                    contents: git(process.cwd(), "show", `${prior}:${path}`),
                    loader: path.endsWith(".tsx") ? "tsx" : "ts",
                    resolveDir: resolve(args.path, ".."),
                  };
                });
              },
            },
          ]
        : [],
  });
  return createRequire(import.meta.url)(output).analyzeStructure(files);
}
const before = await analyze("before"),
  after = await analyze("after");
assert.deepEqual(after.files, before.files);
const candidates = after.edges
  .filter((edge) => edge.kind === "routes")
  .map((edge) => ({
    ...edge,
    sourceLabel: after.nodes.find((node) => node.id === edge.source)?.label,
    targetPath: after.nodes.find((node) => node.id === edge.target)?.sources[0]
      ?.path,
  }));
assert.ok(
  candidates.some(
    (edge) =>
      edge.sourceLabel === "TeamMembers" &&
      edge.targetPath === "app/api/team/route.ts",
  ),
);
assert.ok(
  candidates.every(
    (edge) =>
      edge.evidence === "framework" &&
      edge.sites.every((site) => site.summary.includes("후보")),
  ),
);
assert.deepEqual(
  after.edges.filter((edge) => edge.kind !== "routes"),
  before.edges,
  "Existing compiler edges must retain their exact identities and evidence",
);
assert.deepEqual(
  after.nodes,
  before.nodes,
  "Route candidates must not rewrite existing declarations or source refs",
);
for (const candidate of candidates)
  for (const ref of candidate.sources) {
    const file = files.find((file) => file.path === ref.path);
    assert.ok(
      file && /useSWR|fetch/.test(file.content.slice(ref.start, ref.end)),
    );
  }
for (const path of tracked)
  assert.equal(
    digest(await readFile(resolve(source, path))),
    hashes.get(path),
    path,
  );
assert.equal(git(source, "rev-parse", "HEAD").trim(), baseline.head);
assert.equal(git(source, "diff", "--cached"), baseline.index);
assert.equal(git(source, "status", "--porcelain"), baseline.status);
const report = {
  checkedAt: new Date().toISOString(),
  priorAnalyzerCommit: prior,
  sourceHead: baseline.head,
  files: after.files,
  beforeRevision: before.revision,
  afterRevision: after.revision,
  compilerConnectionsPreserved: before.edges.length,
  totalConnections: after.edges.length,
  candidates,
  additionalNotices: after.notices.filter(
    (notice) =>
      !before.notices.some(
        (old) => JSON.stringify(old) === JSON.stringify(notice),
      ),
  ),
  sourceFilesPreserved: tracked.length,
  gitPreserved: true,
  provider: "none",
  scope:
    "Static Next App Router file candidates from literal fetch addresses or imported SWR keys. No application, configuration, fetcher or model executed; no proof of runtime routing or authorization.",
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/route-candidates.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    files: after.files.length,
    compilerConnections: before.edges.length,
    candidates: candidates.map((edge) => ({
      from: edge.sourceLabel,
      to: edge.targetPath,
      occurrences: edge.sources.length,
    })),
    sourceFilesPreserved: tracked.length,
  }),
);
