import { z } from "zod";
import {
  relativePath,
  descendantIds,
  sourceRefSchema,
  type SourceRef,
  type StructureGraph,
} from "./model";
import { featureListSchema } from "./features";
import { captureObservations, observationSnapshotSchema } from "./observations";

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
const targetIdsSchema = z.array(z.string().min(1).max(4096)).min(1).max(100);
const baselineSchema = z
  .object({
    graphRevision: z.string().regex(/^[a-f0-9]{64}$/),
    observed: text,
    sources: z.array(sourceRefSchema).max(1000),
    observations: observationSnapshotSchema.optional(),
  })
  .strict();
export const baselineRequestSchema = z
  .object({
    specId: z.string().min(1).max(4096),
    expectedRevision: z.number().int().positive(),
    expectedGraphRevision: z.string().regex(/^[a-f0-9]{64}$/),
    targetIds: targetIdsSchema,
  })
  .strict();
export type BaselineRequest = z.infer<typeof baselineRequestSchema>;
export const livingSpecSchema = z
  .object({
    id: z.string().min(1).max(4096),
    targetIds: targetIdsSchema,
    revision: z.number().int().nonnegative(),
    content: specContentSchema,
    baseline: baselineSchema,
    baselineHistory: z
      .array(
        z
          .object({
            revision: z.number().int().positive(),
            targetIds: targetIdsSchema,
            baseline: baselineSchema,
            replacedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const specDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    specs: z.array(livingSpecSchema).max(1000),
    features: featureListSchema.optional(),
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

function sourceKey(ref: SourceRef) {
  return `${ref.path}\0${ref.symbol}\0${ref.start}\0${ref.end}`;
}
function uniqueSources(refs: SourceRef[]) {
  return [...new Map(refs.map((ref) => [sourceKey(ref), ref])).values()];
}
function outerSources(refs: SourceRef[]) {
  const ends = new Map<string, number>();
  return refs
    .slice()
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.start - b.start || b.end - a.end,
    )
    .filter((ref) => {
      if ((ends.get(ref.path) ?? -1) >= ref.end) return false;
      ends.set(ref.path, ref.end);
      return true;
    });
}

export function draftSpec(
  graph: StructureGraph,
  targetIds: string[],
  now = new Date().toISOString(),
): LivingSpec {
  const targets = new Set(targetIds);
  const selected = graph.nodes.filter((node) => targets.has(node.id));
  if (selected.length !== new Set(targetIds).size || selected.length === 0)
    throw Error("선택한 구조가 현재 분석에 없습니다.");
  const included = descendantIds(graph, targetIds);
  const descendants = graph.nodes.filter((node) => included.has(node.id));
  // Keep top-level selected declarations, not duplicate nested ranges.
  const refs = outerSources(descendants.flatMap((node) => node.sources));
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
      observations: captureObservations(graph, targetIds),
    },
    updatedAt: now,
  });
}

/** Find the design for these targets without reusing an ID retained by a reconnected design. */
export function specForTargets(
  document: SpecDocument,
  graph: StructureGraph,
  targetIds: string[],
): LivingSpec {
  const key = targetIds.slice().sort().join("|");
  const existing = document.specs.find(
    (spec) => spec.targetIds.slice().sort().join("|") === key,
  );
  if (existing) return existing;
  const draft = draftSpec(graph, targetIds);
  // A reconnected design keeps its old ID; its former target may need a new design.
  let suffix = 2;
  while (document.specs.some((spec) => spec.id === draft.id)) {
    const tail = `#${suffix++}`;
    draft.id = key.slice(0, 4096 - tail.length) + tail;
  }
  return draft;
}

/** Refresh observed evidence without ever rewriting the user's desired behavior. */
export function observeSpec(
  spec: LivingSpec,
  graph: StructureGraph,
): SpecObservation {
  const candidates = uniqueSources(graph.nodes.flatMap((node) => node.sources));
  const locations = new Map<string, SourceRef[]>(),
    contents = new Map<string, SourceRef[]>();
  for (const ref of candidates) {
    const location = `${ref.path}\0${ref.symbol}`,
      content = `${ref.symbol}\0${ref.contentHash}`;
    const same = locations.get(location) ?? [],
      moved = contents.get(content) ?? [];
    same.push(ref);
    moved.push(ref);
    locations.set(location, same);
    contents.set(content, moved);
  }
  const sources: SourceRef[] = [],
    details: string[] = [];
  let status: SpecObservation["status"] = "unchanged";
  const included = descendantIds(graph, spec.targetIds);
  for (const node of graph.nodes)
    if (included.has(node.id) && node.unresolvedMembers?.length) {
      status = "reconnect";
      details.push(
        `${node.label}: 기능에 연결되지 않은 코드가 있습니다. 기능 묶음의 대상을 다시 확인해 주세요.`,
      );
    }
  if (
    spec.targetIds.some(
      (id) =>
        id.startsWith("feature:") &&
        !graph.nodes.some((node) => node.id === id),
    )
  ) {
    status = "reconnect";
    details.push(
      "연결된 업무 기능이 없습니다. 설계 대상을 다시 선택해 주세요.",
    );
  }
  for (const old of spec.baseline.sources) {
    const same = locations.get(`${old.path}\0${old.symbol}`) ?? [];
    const matches = same.filter((ref) => ref.contentHash === old.contentHash);
    const exact = matches.length === 1 ? matches[0] : undefined;
    const moved = contents.get(`${old.symbol}\0${old.contentHash}`) ?? [];
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
  if (
    status !== "reconnect" &&
    spec.targetIds.every((id) => graph.nodes.some((n) => n.id === id))
  ) {
    const current = outerSources(
      graph.nodes
        .filter((node) => included.has(node.id))
        .flatMap((node) => node.sources),
    );
    const known = new Set(sources.map(sourceKey));
    const selected = new Set(current.map(sourceKey));
    if (
      current.some((ref) => !known.has(sourceKey(ref))) ||
      sources.some((ref) => !selected.has(sourceKey(ref)))
    ) {
      status = "changed";
      details.push(
        "설계 대상의 구현 근거 범위가 바뀌었습니다. 범위를 다시 검토해 주세요.",
      );
    }
  }
  return { status, sources, details };
}

/** Keep uniquely unchanged moved targets visible without rewriting their saved identity. */
export function currentObservations(spec: LivingSpec, graph: StructureGraph) {
  const roots: string[] = [];
  let missing = false;
  for (const id of spec.targetIds) {
    const existing = graph.nodes.find((node) => node.id === id);
    const old = spec.baseline.observations?.facts.find(
      (fact) => fact.id === id,
    );
    const matches = old
      ? graph.nodes.filter(
          (node) =>
            node.kind === old.kind &&
            node.label === old.label &&
            node.sources.some(
              (ref) => ref.contentHash === old.source.contentHash,
            ),
        )
      : [];
    // A numbered rule can retain its ID after a preceding rule was inserted.
    // Prefer the uniquely unchanged evidence before treating the ID as the same rule.
    const resolved =
      matches.find((node) => node.id === id) ??
      (matches.length === 1 ? matches[0] : existing);
    if (resolved) roots.push(resolved.id);
    else missing = true;
  }
  if (missing && !spec.targetIds.some((id) => id.startsWith("feature:"))) {
    const refs = observeSpec(spec, graph).sources;
    for (const ref of refs) {
      const node = graph.nodes.find((node) =>
        node.sources.some(
          (current) =>
            current.path === ref.path &&
            current.start === ref.start &&
            current.end === ref.end &&
            current.contentHash === ref.contentHash,
        ),
      );
      if (node) roots.push(node.id);
    }
  }
  return captureObservations(graph, [...new Set(roots)]);
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
    (JSON.stringify(previous.baseline) !== JSON.stringify(parsed.baseline) ||
      JSON.stringify(previous.targetIds) !== JSON.stringify(parsed.targetIds) ||
      JSON.stringify(previous.baselineHistory) !==
        JSON.stringify(parsed.baselineHistory))
  )
    throw Error("설계 편집은 기존 구현 기준선을 덮어쓸 수 없습니다.");
  const saved = {
    ...parsed,
    revision: expectedRevision + 1,
    updatedAt: new Date().toISOString(),
  };
  return specDocumentSchema.parse({
    ...document,
    schemaVersion: 1,
    specs: [...document.specs.filter((spec) => spec.id !== saved.id), saved],
  });
}

/** Explicitly accept reviewed code evidence. This never asserts that intent is satisfied. */
export function acceptBaseline(
  document: SpecDocument,
  graph: StructureGraph,
  raw: BaselineRequest,
  now = new Date().toISOString(),
): SpecDocument {
  const request = baselineRequestSchema.parse(raw);
  const previous = document.specs.find((spec) => spec.id === request.specId);
  if (!previous || previous.revision !== request.expectedRevision)
    throw Error("검토 중 설계가 바뀌었습니다. 비교를 다시 열어 주세요.");
  if (graph.revision !== request.expectedGraphRevision)
    throw Error(
      "검토 중 코드가 바뀌었습니다. 기준 코드 비교를 다시 열어 주세요.",
    );
  const candidate = draftSpec(graph, [...new Set(request.targetIds)], now);
  const included = descendantIds(graph, request.targetIds);
  if (
    graph.nodes.some(
      (node) => included.has(node.id) && node.unresolvedMembers?.length,
    )
  )
    throw Error("기능 묶음의 코드 연결을 먼저 확인해 주세요.");
  if (!candidate.baseline.sources.length)
    throw Error(
      "연결할 구현 근거가 없습니다. 코드가 있는 대상을 선택해 주세요.",
    );
  if ((previous.baselineHistory?.length ?? 0) >= 100)
    throw Error(
      "기준선 기록이 100개에 도달했습니다. 기존 기록을 보관한 뒤 정리해 주세요.",
    );
  const saved = livingSpecSchema.parse({
    ...previous,
    revision: previous.revision + 1,
    targetIds: candidate.targetIds,
    baseline: candidate.baseline,
    baselineHistory: [
      ...(previous.baselineHistory ?? []),
      {
        revision: previous.revision,
        targetIds: previous.targetIds,
        baseline: previous.baseline,
        replacedAt: now,
      },
    ],
    updatedAt: now,
  });
  return specDocumentSchema.parse({
    ...document,
    schemaVersion: 1,
    specs: document.specs.map((spec) => (spec.id === saved.id ? saved : spec)),
  });
}

export const changeRequestSchema = z
  .object({
    id: z.string().max(8192),
    specId: z.string().max(4096),
    specRevision: z.number().int().nonnegative(),
    graphRevision: z.string().regex(/^[a-f0-9]{64}$/),
    content: specContentSchema,
    desired: text,
    invariants: lines,
    acceptance: lines,
    sources: z.array(sourceRefSchema).max(24000),
    scopePaths: z.array(relativePath).max(5000),
  })
  .strict();
export type ChangeRequest = z.infer<typeof changeRequestSchema>;

/** Follow calls/renders/function passes and route candidates in both directions, including enclosing declarations.
 * This is a reviewable static scope, not a claim of complete runtime impact. */
export function implementationScope(
  graph: StructureGraph,
  targetIds: string[],
) {
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (!adjacent.has(from)) adjacent.set(from, new Set());
    adjacent.get(from)!.add(to);
  };
  for (const node of graph.nodes) {
    for (const member of node.members ?? []) link(node.id, member);
    if (!node.parentId) continue;
    link(node.parentId, node.id);
    if (lookup.get(node.parentId)?.kind === "symbol")
      link(node.id, node.parentId);
  }
  for (const edge of graph.edges) {
    if (edge.kind === "imports") continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  const included = new Set(targetIds);
  const queue = [...targetIds];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i],
      node = lookup.get(id);
    if (!node) continue;
    const add = (next: string) => {
      if (!included.has(next)) {
        included.add(next);
        queue.push(next);
      }
    };
    for (const next of adjacent.get(id) ?? []) add(next);
  }
  const nodes = graph.nodes.filter((node) => included.has(node.id));
  const paths = [
    ...new Set(nodes.flatMap((node) => node.sources.map((ref) => ref.path))),
  ].sort();
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
  const observedKeys = new Set(observation.sources.map(sourceKey));
  const reconnected = graph.nodes.filter((node) =>
    node.sources.some((ref) => observedKeys.has(sourceKey(ref))),
  );
  const scope = implementationScope(graph, [
    ...spec.targetIds,
    ...reconnected.map((node) => node.id),
  ]);
  const scopePaths = [
    ...new Set([...scope.paths, ...observation.sources.map((ref) => ref.path)]),
  ].sort();
  if (!scopePaths.length) throw Error("구현할 소스 범위가 없습니다.");
  return {
    id: `${spec.id}@${spec.revision}`,
    specId: spec.id,
    specRevision: spec.revision,
    graphRevision: graph.revision,
    content: structuredClone(spec.content),
    desired: spec.content.desired,
    invariants: spec.content.invariants,
    acceptance: spec.content.acceptance,
    sources: uniqueSources([
      ...scope.nodes.flatMap((node) => node.sources),
      ...observation.sources,
    ]),
    scopePaths,
  };
}
