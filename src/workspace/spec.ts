import { z } from "zod";
import { sourceRefSchema, type SourceRef, type StructureGraph } from "./model";

const text = z.string().max(12000);
const lines = z.array(z.string().min(1).max(2000)).max(100);
export const specContentSchema = z
  .object({
    title: z.string().min(1).max(160),
    purpose: text,
    desired: text,
    policies: text,
    inputsOutputs: text,
    failures: text,
    invariants: lines,
    acceptance: lines,
  })
  .strict();
export const livingSpecSchema = z
  .object({
    id: z.string().min(1).max(4096),
    targetIds: z.array(z.string().min(1).max(4096)).min(1).max(100),
    revision: z.number().int().nonnegative(),
    content: specContentSchema,
    baseline: z
      .object({
        graphRevision: z.string().regex(/^[a-f0-9]{64}$/),
        observed: text,
        sources: z.array(sourceRefSchema).max(1000),
      })
      .strict(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const specDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    specs: z.array(livingSpecSchema).max(1000),
  })
  .strict();
export type SpecContent = z.infer<typeof specContentSchema>;
export type LivingSpec = z.infer<typeof livingSpecSchema>;
export type SpecDocument = z.infer<typeof specDocumentSchema>;
export type SpecObservation = {
  status: "unchanged" | "changed" | "reconnect";
  sources: SourceRef[];
  details: string[];
};

export function draftSpec(
  graph: StructureGraph,
  targetIds: string[],
  now = new Date().toISOString(),
): LivingSpec {
  const selected = graph.nodes.filter((node) => targetIds.includes(node.id));
  if (selected.length !== new Set(targetIds).size || selected.length === 0)
    throw Error("선택한 구조가 현재 분석에 없습니다.");
  const descendants = graph.nodes.filter((node) => {
    let current: typeof node | undefined = node;
    while (current) {
      if (targetIds.includes(current.id)) return true;
      current = graph.nodes.find((n) => n.id === current!.parentId);
    }
    return false;
  });
  // Keep top-level selected declarations, not duplicate nested ranges.
  const refs = descendants
    .flatMap((node) => node.sources)
    .filter(
      (ref, index, all) =>
        !all.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.path === ref.path &&
            other.start <= ref.start &&
            other.end >= ref.end &&
            (other.start < ref.start ||
              other.end > ref.end ||
              otherIndex < index),
        ),
    );
  return livingSpecSchema.parse({
    id: targetIds.slice().sort().join("|"),
    targetIds,
    revision: 0,
    content: {
      title: selected
        .map((node) => node.label)
        .join(" · ")
        .slice(0, 160),
      purpose: "",
      desired: "",
      policies: "",
      inputsOutputs: "",
      failures: "",
      invariants: [],
      acceptance: [],
    },
    baseline: {
      graphRevision: graph.revision,
      observed: selected
        .map((node) => node.summary)
        .join("\n\n")
        .slice(0, 12000),
      sources: refs,
    },
    updatedAt: now,
  });
}

/** Refresh observed evidence without ever rewriting the user's desired behavior. */
export function observeSpec(
  spec: LivingSpec,
  graph: StructureGraph,
): SpecObservation {
  const candidates = graph.nodes.flatMap((node) => node.sources);
  const sources: SourceRef[] = [],
    details: string[] = [];
  let status: SpecObservation["status"] = "unchanged";
  for (const old of spec.baseline.sources) {
    const same = candidates.filter(
      (ref) => ref.path === old.path && ref.symbol === old.symbol,
    );
    const exact = same.find((ref) => ref.contentHash === old.contentHash);
    const moved = exact
      ? []
      : candidates.filter(
          (ref) =>
            ref.contentHash === old.contentHash && ref.symbol === old.symbol,
        );
    const current =
      exact ??
      (same.length === 1 ? same[0] : moved.length === 1 ? moved[0] : undefined);
    if (!current) {
      status = "reconnect";
      details.push(
        `${old.path} ${old.symbol}: 근거를 유일하게 다시 연결할 수 없습니다.`,
      );
    } else {
      sources.push(current);
      if (current.contentHash !== old.contentHash) {
        if (status !== "reconnect") status = "changed";
        details.push(
          `${old.path} ${old.symbol}: 근거 코드가 바뀌었습니다. 목표 충족 여부를 다시 확인해야 합니다.`,
        );
      }
    }
  }
  if (
    !spec.baseline.sources.length &&
    graph.revision !== spec.baseline.graphRevision
  ) {
    status = "reconnect";
    details.push(
      "연결된 소스가 없는 구조입니다. 새 분석에서 대상을 다시 선택해 주세요.",
    );
  }
  return { status, sources, details };
}

export function saveSpec(
  document: SpecDocument,
  candidate: LivingSpec,
  expectedRevision: number,
): SpecDocument {
  const parsed = livingSpecSchema.parse(candidate);
  const previous = document.specs.find((spec) => spec.id === parsed.id);
  if ((previous?.revision ?? 0) !== expectedRevision)
    throw Error("다른 편집으로 설계가 바뀌었습니다. 다시 열어 비교해 주세요.");
  if (
    previous &&
    JSON.stringify(previous.baseline) !== JSON.stringify(parsed.baseline)
  )
    throw Error("설계 편집은 기존 구현 기준선을 덮어쓸 수 없습니다.");
  const saved = {
    ...parsed,
    revision: expectedRevision + 1,
    updatedAt: new Date().toISOString(),
  };
  return specDocumentSchema.parse({
    schemaVersion: 1,
    specs: [...document.specs.filter((spec) => spec.id !== saved.id), saved],
  });
}

export type ChangeRequest = {
  id: string;
  specId: string;
  specRevision: number;
  graphRevision: string;
  desired: string;
  invariants: string[];
  acceptance: string[];
  sources: SourceRef[];
  scopePaths: string[];
};

/** Follow compiler-backed calls/renders in both directions, including enclosing declarations.
 * This is a reviewable static scope, not a claim of complete runtime impact. */
export function implementationScope(graph: StructureGraph, targetIds: string[]) {
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const included = new Set(targetIds);
  const queue = [...targetIds];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], node = lookup.get(id);
    if (!node) continue;
    const add = (next: string) => { if (!included.has(next)) { included.add(next); queue.push(next); } };
    if (node.parentId && lookup.get(node.parentId)?.kind === "symbol") add(node.parentId);
    for (const child of graph.nodes) if (child.parentId === id) add(child.id);
    for (const edge of graph.edges) {
      if (edge.kind === "imports") continue;
      if (edge.source === id) add(edge.target);
      if (edge.target === id) add(edge.source);
    }
  }
  const nodes = graph.nodes.filter((node) => included.has(node.id));
  const paths = [...new Set(nodes.flatMap((node) => node.sources.map((ref) => ref.path)))].sort();
  return { nodes, paths };
}
export function prepareChange(
  spec: LivingSpec,
  graph: StructureGraph,
  mode: "documentation" | "behavior",
): ChangeRequest | undefined {
  if (mode === "documentation") return undefined;
  if (!spec.content.desired.trim() || !spec.content.acceptance.length)
    throw Error("원하는 동작과 확인할 완료 기준을 작성해 주세요.");
  const observation = observeSpec(spec, graph);
  if (observation.status !== "unchanged")
    throw Error("연결된 코드가 바뀌었습니다. 변경 기준을 다시 검토해 주세요.");
  const scope = implementationScope(graph, spec.targetIds);
  const scopePaths = [...new Set([...scope.paths, ...observation.sources.map((ref) => ref.path)])].sort();
  if (!scopePaths.length) throw Error("구현할 소스 범위가 없습니다.");
  return {
    id: `${spec.id}@${spec.revision}`,
    specId: spec.id,
    specRevision: spec.revision,
    graphRevision: graph.revision,
    desired: spec.content.desired,
    invariants: spec.content.invariants,
    acceptance: spec.content.acceptance,
    sources: scope.nodes.flatMap((node) => node.sources),
    scopePaths,
  };
}
