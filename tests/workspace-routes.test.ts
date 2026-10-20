import { describe, expect, it } from "vitest";
import { analyzeStructure } from "../src/workspace/analyze";
import { structureConnections } from "../src/workspace/model";
import {
  captureObservations,
  compareObservations,
} from "../src/workspace/observations";
import {
  draftSpec,
  prepareChange,
  saveSpec,
  specDocumentSchema,
} from "../src/workspace/spec";

const manifest = {
  path: "package.json",
  content: '{"dependencies":{"next":"16.0.0","swr":"2.0.0"}}',
};
const route = {
  path: "app/(service)/api/team/route.ts",
  content: `import { allowed } from '../../../../policy';
export function GET() { return allowed('member'); }
export function POST() { return allowed('owner'); }`,
};
const files = [
  manifest,
  route,
  {
    path: "policy.ts",
    content:
      "export function allowed(role: string) { return role === 'owner'; }",
  },
  { path: "unrelated.ts", content: "export function other() { return 1; }" },
  {
    path: "app/page.tsx",
    content: `import useData from 'swr';
const fetcher = (url: string) => fetch(url).then(r => r.json());
export function Team() {
  useData('/api/team?active=1', fetcher);
  return fetch('/api/team', { method: 'POST' });
}`,
  },
];

describe("Next App Router path candidates", () => {
  it("does not treat a tsconfig alias named swr as the external SWR hook", async () => {
    const graph = await analyzeStructure([
      manifest,
      route,
      {
        path: "tsconfig.json",
        content:
          '{"compilerOptions":{"baseUrl":".","paths":{"swr":["./local.ts"]}}}',
      },
      {
        path: "local.ts",
        content:
          "export default function readLabel(key: string) { return key; }",
      },
      {
        path: "app/page.tsx",
        content:
          "import readLabel from 'swr'; export function Page() { return readLabel('/api/team'); }",
      },
    ]);
    expect(graph.edges.filter((e) => e.kind === "routes")).toEqual([]);
    expect(graph.edges.some((e) => e.kind === "calls")).toBe(true);
  });
  it("connects fixed fetch addresses and imported SWR keys to route files, retaining their distinct evidence", async () => {
    const graph = await analyzeStructure(files);
    const team = graph.nodes.find((n) => n.label === "Team")!;
    const edges = graph.edges.filter((e) => e.kind === "routes");
    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(edge.source).toBe(team.id);
    expect(edge.evidence).toBe("framework");
    expect(graph.nodes.find((n) => n.id === edge.target)?.sources[0].path).toBe(
      route.path,
    );
    expect(edge.sources).toHaveLength(2);
    expect(edge.sites?.[0].summary).toContain("SWR");
    expect(edge.sites?.[0].summary).toContain("후보");
    expect(edge.sites?.[1].summary).toContain("fetch");
    expect(edge.sites?.[1].inputs.some((i) => i.code.includes("POST"))).toBe(
      true,
    );
    for (const ref of edge.sources) {
      expect(
        files
          .find((f) => f.path === ref.path)!
          .content.slice(ref.start, ref.end),
      ).toMatch(/^(useData|fetch)\(/);
    }
    const spec = draftSpec(graph, [team.id]);
    spec.content.desired = "owner만 팀 정보를 변경할 수 있다";
    spec.content.acceptance = ["member의 변경 요청을 거절한다"];
    expect(prepareChange(spec, graph, "behavior")?.scopePaths).toEqual(
      ["app/page.tsx", route.path, "policy.ts"].sort(),
    );
    expect(
      structureConnections(graph, [
        team,
        graph.nodes.find((n) => n.id === edge.target)!,
      ])[0].label,
    ).toBe("요청 경로 후보");
    expect(
      graph.notices.some(
        (n) => n.message.includes("동적") && n.path === "app/page.tsx",
      ),
    ).toBe(true);
  });

  it("preserves goals, old snapshots, compiler edge identities and full request evidence across changes", async () => {
    const graph = await analyzeStructure(files);
    const team = graph.nodes.find((n) => n.label === "Team")!;
    const spec = draftSpec(graph, [team.id]);
    spec.content.desired = "owner만 변경";
    const stored = specDocumentSchema.parse(
      saveSpec({ schemaVersion: 1, specs: [] }, spec, 0),
    );
    const before = captureObservations(graph, [team.id]);
    const legacy = {
      ...before,
      relations: before.relations.filter((r) => r.kind !== "routes"),
    };
    expect(
      compareObservations(legacy, before).relations.some(
        (r) => r.status === "added" && r.current?.kind === "routes",
      ),
    ).toBe(true);
    const changed = await analyzeStructure(
      files.map((f) =>
        f.path === "app/page.tsx"
          ? { ...f, content: f.content.replace("'POST'", "'DELETE'") }
          : f,
      ),
    );
    expect(
      compareObservations(
        before,
        captureObservations(changed, [team.id]),
      ).relations.find((r) => r.current?.kind === "routes")?.status,
    ).toBe("changed");
    expect(stored.specs[0].content.desired).toBe("owner만 변경");
    const noFramework = await analyzeStructure(
      files.filter((f) => f !== manifest),
    );
    expect(
      graph.edges.filter((e) => e.kind !== "routes").map((e) => e.id),
    ).toEqual(noFramework.edges.map((e) => e.id));
  });

  it("does not confuse shadowed helpers, arbitrary strings, external URLs or dynamic keys with local routes", async () => {
    const graph = await analyzeStructure([
      manifest,
      route,
      {
        path: "app/page.tsx",
        content: `import swr from 'swr';
function fake(fetch: (x: string) => unknown, swr: (x: string) => unknown) { fetch('/api/team'); swr('/api/team'); }
function other() { const path = '/api/team'; return path; }
function network(id: string) { fetch('https://example.com/api/team'); fetch('//example.com/api/team'); fetch('/api/../api/team'); fetch('/api/team/' + id); swr(() => '/api/team'); }`,
      },
    ]);
    expect(graph.edges.filter((e) => e.kind === "routes")).toEqual([]);
    expect(graph.notices.some((n) => n.message.includes("동적"))).toBe(true);
    expect(
      (await analyzeStructure(files.filter((f) => f !== manifest))).edges.some(
        (e) => e.kind === "routes",
      ),
    ).toBe(false);
  });

  it("uses src/app only when root app is absent and refuses conflicting route groups", async () => {
    const page = {
      path: "components/Page.tsx",
      content:
        "export function Page() { return fetch('/api/team?x=1#section'); }",
    };
    const srcRoute = {
      path: "src/app/api/team/route.js",
      content: "export function GET() { return null; }",
    };
    const graph = await analyzeStructure([manifest, srcRoute, page]);
    expect(graph.edges.filter((e) => e.kind === "routes")).toHaveLength(1);
    const rootWins = await analyzeStructure([
      manifest,
      srcRoute,
      page,
      {
        path: "app/page.tsx",
        content: "export default function Home() { return null; }",
      },
    ]);
    expect(rootWins.edges.filter((e) => e.kind === "routes")).toEqual([]);
    const ambiguous = await analyzeStructure([
      manifest,
      route,
      page,
      { ...route, path: "app/(other)/api/team/route.ts" },
    ]);
    expect(ambiguous.edges.filter((e) => e.kind === "routes")).toEqual([]);
    expect(ambiguous.notices.some((n) => n.message.includes("여러"))).toBe(
      true,
    );
  });

  it("leaves private, dynamic, parallel and non-handler files unconnected and explains unresolved paths", async () => {
    const graph = await analyzeStructure([
      manifest,
      {
        path: "app/page.tsx",
        content:
          "export function Page(){ fetch('/hidden'); fetch('/api/42'); fetch('/slot'); fetch('/empty'); }",
      },
      {
        path: "app/_private/hidden/route.ts",
        content: "export function GET(){}",
      },
      { path: "app/api/[id]/route.ts", content: "export function GET(){}" },
      { path: "app/@modal/slot/route.ts", content: "export function GET(){}" },
      { path: "app/empty/route.ts", content: "export const value = 1;" },
    ]);
    expect(graph.edges.filter((e) => e.kind === "routes")).toEqual([]);
    expect(
      graph.notices.filter((n) => n.message.includes("경로 후보")).length,
    ).toBeGreaterThanOrEqual(4);
  });
});
