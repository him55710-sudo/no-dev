import { z } from "zod";
import {
  descendantIds,
  sourceRefSchema,
  type SourceRef,
  type StructureGraph,
} from "./model";

const identity = z.string().min(1).max(4096);
const endpoint = z
  .object({ id: identity, label: z.string().max(2000) })
  .strict();
const factSchema = z
  .object({
    id: identity,
    kind: z.enum(["file", "symbol", "rule"]),
    label: z.string().max(2000),
    summary: z.string().max(1000),
    summaryTruncated: z.boolean(),
    syntaxValid: z.boolean(),
    supported: z.boolean(),
    source: sourceRefSchema,
  })
  .strict();
const relationSchema = z
  .object({
    from: endpoint,
    to: endpoint,
    kind: z.enum(["imports", "calls", "renders", "passes"]),
    count: z.number().int().positive(),
    source: sourceRefSchema,
  })
  .strict();
export const observationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    facts: z.array(factSchema).max(120),
    relations: z.array(relationSchema).max(120),
    notices: z.array(z.string().max(500)).max(20),
    totals: z
      .object({
        facts: z.number().int().nonnegative(),
        relations: z.number().int().nonnegative(),
        notices: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ObservationSnapshot = z.infer<typeof observationSnapshotSchema>;
export type ObservedFact = ObservationSnapshot["facts"][number];
export type ObservedRelation = ObservationSnapshot["relations"][number];
export type FactChange = {
  status:
    | "unchanged"
    | "changed"
    | "moved"
    | "description"
    | "added"
    | "unresolved";
  before?: ObservedFact;
  current?: ObservedFact;
};
export type RelationChange = {
  status: "unchanged" | "changed" | "added" | "unresolved";
  before?: ObservedRelation;
  current?: ObservedRelation;
};

/** These are compiler/reader observations, never inferred intent or proof of behavior. */
export function captureObservations(
  graph: StructureGraph,
  targetIds: string[],
): ObservationSnapshot {
  const included = descendantIds(graph, targetIds);
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const files = new Map(graph.files.map((file) => [file.path, file]));
  const children = new Set(
    graph.nodes
      .filter((node) => included.has(node.id) && node.kind === "symbol")
      .flatMap((node) => node.sources.map((ref) => ref.path)),
  );
  const selected = new Set(targetIds);
  const nodes = graph.nodes
    .filter(
      (node) =>
        included.has(node.id) &&
        node.sources.length &&
        (node.kind === "symbol" ||
          node.kind === "rule" ||
          (node.kind === "file" && !children.has(node.sources[0].path))),
    )
    .sort(
      (a, b) =>
        Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
        a.sources[0].path.localeCompare(b.sources[0].path) ||
        a.sources[0].start - b.sources[0].start,
    );
  const paths = new Set(
    graph.nodes
      .filter((node) => included.has(node.id))
      .flatMap((node) => node.sources.map((ref) => ref.path)),
  );
  const relations = new Map<string, ObservedRelation>();
  for (const edge of graph.edges) {
    if (!included.has(edge.source) && !included.has(edge.target)) continue;
    const from = lookup.get(edge.source),
      to = lookup.get(edge.target),
      source = edge.sources[0];
    if (!from || !to || !source) continue;
    const key = JSON.stringify([edge.kind, edge.source, edge.target]);
    const previous = relations.get(key);
    if (previous) previous.count += edge.sources.length;
    else
      relations.set(key, {
        from: { id: from.id, label: from.label.slice(0, 2000) },
        to: { id: to.id, label: to.label.slice(0, 2000) },
        kind: edge.kind,
        count: edge.sources.length,
        source,
      });
  }
  const notices = graph.notices
    .filter((notice) => !notice.path || paths.has(notice.path))
    .map(
      (notice) =>
        `${notice.path ? `${notice.path}${notice.line ? `:${notice.line}` : ""} · ` : ""}${notice.message}`,
    );
  const snapshot: ObservationSnapshot = {
    schemaVersion: 1,
    facts: [],
    relations: [],
    notices: [],
    totals: {
      facts: nodes.length,
      relations: relations.size,
      notices: notices.length,
    },
  };
  // Keep a bounded, self-contained history in the existing 1 MiB design document.
  // Reserve space for relation evidence even when a feature has many declarations.
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value, null, 2)).length;
  let used = bytes(snapshot);
  for (const node of nodes) {
    const fact: ObservedFact = {
      id: node.id,
      kind: node.kind as ObservedFact["kind"],
      label: node.label.slice(0, 2000),
      summary: node.summary.slice(0, 1000),
      summaryTruncated: node.summary.length > 1000,
      syntaxValid: node.syntaxValid,
      supported: files.get(node.sources[0].path)?.supported ?? false,
      source: node.sources[0],
    };
    const size = bytes(fact) + 100;
    if (snapshot.facts.length >= 120 || used + size > 40 * 1024) break;
    snapshot.facts.push(fact);
    used += size;
  }
  for (const relation of relations.values()) {
    const size = bytes(relation) + 100;
    if (snapshot.relations.length >= 120 || used + size > 58 * 1024) break;
    snapshot.relations.push(relation);
    used += size;
  }
  snapshot.notices = notices.slice(0, 20).map((notice) => notice.slice(0, 500));
  while (bytes(snapshot) > 64 * 1024) {
    if (snapshot.notices.length) snapshot.notices.pop();
    else if (snapshot.relations.length) snapshot.relations.pop();
    else if (snapshot.facts.length) snapshot.facts.pop();
    else break;
  }
  return observationSnapshotSchema.parse(snapshot);
}

const locationKey = (fact: ObservedFact) =>
  JSON.stringify([fact.kind, fact.source.path, fact.source.symbol]);
const contentKey = (fact: ObservedFact) =>
  JSON.stringify([fact.kind, fact.label, fact.source.contentHash]);

/** Align exact evidence first, then uniquely unchanged moved/reordered evidence.
 * A missing/ambiguous/truncated observation stays unresolved, never "code deleted". */
export function compareObservations(
  before: ObservationSnapshot | undefined,
  current: ObservationSnapshot,
) {
  const facts: FactChange[] = [];
  const used = new Set<ObservedFact>();
  const matches = new Map<ObservedFact, ObservedFact>();
  const oldFacts = before?.facts ?? [];
  const oldContent = new Map<string, number>();
  for (const old of oldFacts)
    oldContent.set(contentKey(old), (oldContent.get(contentKey(old)) ?? 0) + 1);
  for (const old of oldFacts) {
    const exact = current.facts.filter(
      (fact) =>
        locationKey(old) === locationKey(fact) &&
        old.source.contentHash === fact.source.contentHash,
    );
    if (exact.length === 1 && !used.has(exact[0])) {
      matches.set(old, exact[0]);
      used.add(exact[0]);
    }
  }
  for (const old of oldFacts) {
    if (matches.has(old)) continue;
    // An omitted declaration may be a duplicate candidate. A bounded excerpt
    // cannot prove that a moved declaration is unique across the selected scope.
    if (
      before!.totals.facts > oldFacts.length ||
      current.totals.facts > current.facts.length
    )
      continue;
    const moved = current.facts.filter(
      (fact) => contentKey(old) === contentKey(fact),
    );
    if (
      oldContent.get(contentKey(old)) === 1 &&
      moved.length === 1 &&
      !used.has(moved[0])
    ) {
      matches.set(old, moved[0]);
      used.add(moved[0]);
    }
  }
  for (const old of oldFacts) {
    if (matches.has(old)) continue;
    const same = current.facts.filter(
      (fact) => !used.has(fact) && locationKey(old) === locationKey(fact),
    );
    if (same.length === 1) {
      matches.set(old, same[0]);
      used.add(same[0]);
    }
  }
  const identities = new Map<string, string>();
  for (const old of oldFacts) {
    const fact = matches.get(old);
    if (fact) identities.set(old.id, fact.id);
    facts.push({
      before: old,
      current: fact,
      status: !fact
        ? "unresolved"
        : fact.source.contentHash !== old.source.contentHash
          ? "changed"
          : locationKey(old) !== locationKey(fact)
            ? "moved"
            : fact.summary !== old.summary ||
                fact.syntaxValid !== old.syntaxValid ||
                fact.supported !== old.supported
              ? "description"
              : "unchanged",
    });
  }
  for (const fact of current.facts)
    if (!used.has(fact)) facts.push({ status: "added", current: fact });
  const key = (relation: ObservedRelation, remap = false) =>
    JSON.stringify([
      relation.kind,
      remap
        ? (identities.get(relation.from.id) ?? relation.from.id)
        : relation.from.id,
      remap
        ? (identities.get(relation.to.id) ?? relation.to.id)
        : relation.to.id,
    ]);
  const currentRelations = new Map(
    current.relations.map((relation) => [key(relation), relation]),
  );
  const seen = new Set<ObservedRelation>();
  const relations: RelationChange[] = (before?.relations ?? []).map((old) => {
    const relation = currentRelations.get(key(old, true));
    if (relation) seen.add(relation);
    return {
      before: old,
      current: relation,
      status: !relation
        ? "unresolved"
        : relation.count !== old.count
          ? "changed"
          : "unchanged",
    };
  });
  for (const relation of current.relations)
    if (!seen.has(relation))
      relations.push({ status: "added", current: relation });
  return { legacy: !before, facts, relations };
}

/** Return a current compiler-backed anchor only, including after a unique move. */
export function observationSource(graph: StructureGraph, ref: SourceRef) {
  for (const node of graph.nodes) {
    const index = node.sources.findIndex(
      (source) =>
        source.path === ref.path &&
        source.start === ref.start &&
        source.end === ref.end &&
        source.contentHash === ref.contentHash,
    );
    if (index >= 0) return { id: node.id, index };
  }
  for (const edge of graph.edges) {
    const index = edge.sources.findIndex(
      (source) =>
        source.path === ref.path &&
        source.start === ref.start &&
        source.end === ref.end &&
        source.contentHash === ref.contentHash,
    );
    if (index >= 0) return { id: edge.id, index };
  }
  return undefined;
}
