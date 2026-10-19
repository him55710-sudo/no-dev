import { z } from "zod";

export const relativePath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.includes(":") &&
      !value.includes("\0") &&
      !value.startsWith("/") &&
      value.split("/").every((p) => p !== "." && p !== ".." && p !== ""),
    "A workspace-relative path is required",
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceRefSchema = z
  .object({
    path: relativePath,
    symbol: z.string().max(2048),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    line: z.number().int().positive(),
    endLine: z.number().int().positive(),
    fileHash: digest,
    contentHash: digest,
  })
  .strict()
  .refine((ref) => ref.end >= ref.start && ref.endLine >= ref.line);
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type StructureNode = {
  id: string;
  kind: "system" | "feature" | "group" | "file" | "symbol" | "rule";
  label: string;
  parentId?: string;
  origin: "directory" | "syntax" | "user";
  role?: string;
  summary: string;
  sources: SourceRef[];
  syntaxValid: boolean;
  /** User membership is an overlay; compiler parents and edges stay canonical. */
  members?: string[];
  unresolvedMembers?: { nodeId: string; label: string }[];
  description?: string;
};
export type StructureEdge = {
  id: string;
  source: string;
  target: string;
  kind: "imports" | "calls" | "renders" | "passes";
  label: string;
  sources: SourceRef[];
  evidence: "compiler";
  /** One syntax observation per source occurrence; not a runtime contract. */
  sites?: ConnectionSite[];
  evidenceHash?: string;
};
export type ConnectionSite = {
  summary: string;
  code: string;
  inputs: { label: string; code: string; description: string }[];
  contexts: { description: string; code: string; line: number }[];
  result?: string;
  omittedInputs: number;
  omittedContexts: number;
};
export type StructureGraph = {
  schemaVersion: 1;
  revision: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
  files: { path: string; hash: string; supported: boolean }[];
  notices: { path?: string; line?: number; message: string }[];
};
export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export const structureLimits = {
  files: 500,
  fileBytes: 512 * 1024,
  bytes: 8 * 1024 * 1024,
  nodes: 12000,
  edges: 20000,
};

export function ancestors(graph: StructureGraph, id: string): StructureNode[] {
  const lookup = new Map(graph.nodes.map((n) => [n.id, n]));
  const chain: StructureNode[] = [];
  let node = lookup.get(id);
  while (node && chain.length <= graph.nodes.length) {
    chain.unshift(node);
    node = node.parentId ? lookup.get(node.parentId) : undefined;
  }
  return chain;
}

export function sourceNode(
  graph: StructureGraph,
  path: string,
  offset: number,
) {
  return graph.nodes
    .filter((node) =>
      node.sources.some(
        (ref) => ref.path === path && ref.start <= offset && offset <= ref.end,
      ),
    )
    .sort((a, b) => {
      const size = (n: StructureNode) =>
        Math.min(...n.sources.map((r) => r.end - r.start));
      return size(a) - size(b);
    })[0];
}

export function structureChildren(
  graph: StructureGraph,
  id: string,
): StructureNode[] {
  const node = graph.nodes.find((item) => item.id === id);
  if (node?.members) {
    const ids = new Set(node.members);
    return graph.nodes.filter((item) => ids.has(item.id));
  }
  return graph.nodes
    .filter((item) => item.parentId === id)
    .sort(
      (a, b) => Number(b.kind === "feature") - Number(a.kind === "feature"),
    );
}

export function descendantIds(
  graph: StructureGraph,
  roots: string[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.parentId)
      children.set(node.parentId, [
        ...(children.get(node.parentId) ?? []),
        node.id,
      ]);
  }
  for (const node of graph.nodes)
    if (node.members) children.set(node.id, node.members);
  const included = new Set(roots),
    queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    for (const id of children.get(queue[index]) ?? []) {
      if (!included.has(id)) {
        included.add(id);
        queue.push(id);
      }
    }
  }
  return included;
}

/** Every displayed connection retains actual compiler edge IDs, including overlaps. */
export function structureConnections(
  graph: StructureGraph,
  visible: StructureNode[],
) {
  const owners = new Map<string, string[]>();
  // The code tree is an alternate navigation entry, not a business dependency.
  for (const node of visible)
    if (node.id !== "code-tree")
      for (const id of descendantIds(graph, [node.id])) {
        owners.set(id, [...(owners.get(id) ?? []), node.id]);
      }
  const connections = new Map<
    string,
    {
      id: string;
      source: string;
      target: string;
      label: string;
      data: { originals: string[] };
      count: number;
    }
  >();
  for (const edge of graph.edges) {
    for (const source of owners.get(edge.source) ?? [])
      for (const target of owners.get(edge.target) ?? []) {
        if (source === target) continue;
        const key = JSON.stringify([source, target]);
        const previous = connections.get(key);
        if (previous) {
          previous.data.originals.push(edge.id);
          previous.count++;
          previous.label = `${previous.count}개 연결`;
        } else
          connections.set(key, {
            id: key,
            source,
            target,
            label:
              edge.kind === "imports"
                ? "모듈 연결"
                : edge.kind === "calls"
                  ? "호출"
                  : edge.kind === "passes"
                    ? "함수 전달"
                    : "화면 구성",
            data: { originals: [edge.id] },
            count: 1,
          });
      }
  }
  return [...connections.values()];
}
