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
  kind: "system" | "group" | "file" | "symbol" | "rule";
  label: string;
  parentId?: string;
  origin: "directory" | "syntax" | "user";
  role?: string;
  summary: string;
  sources: SourceRef[];
  syntaxValid: boolean;
};
export type StructureEdge = {
  id: string;
  source: string;
  target: string;
  kind: "imports" | "calls" | "renders";
  label: string;
  sources: SourceRef[];
  evidence: "compiler";
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
