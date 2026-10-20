// Compare compiler descriptions on an unchanged external baseline, without
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
const run = await mkdtemp(resolve(tmpdir(), "pureobom-function-summaries-"));
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
const samples = [
  "removeTeamMember",
  "inviteTeamMember",
  "customerPortalAction",
  "validatedActionWithUser",
  "withTeam",
].map((name) => {
  const old = before.nodes.find(
    (node) => node.kind === "symbol" && node.label === name,
  );
  const current = after.nodes.find(
    (node) => node.kind === "symbol" && node.label === name,
  );
  assert.ok(old && current, name);
  assert.equal(old.id, current.id);
  assert.deepEqual(old.sources, current.sources, name);
  assert.equal(current.role, "function", name);
  assert.notEqual(old.summary, current.summary);
  return {
    name,
    id: current.id,
    sources: current.sources,
    before: { role: old.role, summary: old.summary },
    after: { role: current.role, summary: current.summary },
  };
});
const removal = samples.find((sample) => sample.name === "removeTeamMember");
assert.equal(removal.before.role, "data");
assert.ok(removal.after.summary.includes("함수 실행은 별개"));
assert.ok(removal.after.summary.includes("User is not part of a team"));
assert.ok(removal.after.summary.includes("REMOVE_TEAM_MEMBER"));
assert.ok(!removal.after.summary.includes("User is not authenticated"));
const wrapper = samples.find(
  (sample) => sample.name === "validatedActionWithUser",
);
assert.ok(wrapper.after.summary.includes("반환하는 함수의 본문"));
assert.ok(wrapper.after.summary.includes("User is not authenticated"));
const edges = (graph) =>
  graph.edges.map(({ id, source, target, kind, sources, evidenceHash }) => ({
    id,
    source,
    target,
    kind,
    sources,
    evidenceHash,
  }));
assert.deepEqual(
  edges(after),
  edges(before),
  "Descriptions do not invent or remove compiler connections",
);
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
  samples,
  compilerConnectionsPreserved: after.edges.length,
  sourceFilesPreserved: tracked.length,
  gitPreserved: true,
  provider: "none",
  scope:
    "Read-only syntax and type descriptions; callback bodies are not proof of wrapper execution or runtime behavior.",
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/function-summaries.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    samples: samples.map((sample) => ({
      name: sample.name,
      before: sample.before.role,
      after: sample.after.role,
      characters: sample.after.summary.length,
    })),
    files: after.files.length,
    connections: after.edges.length,
    sourceFilesPreserved: tracked.length,
  }),
);
