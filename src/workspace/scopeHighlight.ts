import { descendantIds, type StructureGraph } from "./model";

export type ScopeMarker =
  | "target"
  | "related"
  | "target-container"
  | "related-container";
export type ScopeHighlights = {
  nodes: Map<string, ScopeMarker>;
  edges: Set<string>;
};
export const scopeMarkerLabels: Record<ScopeMarker, string> = {
  target: "설계 대상",
  related: "연결 후보",
  "target-container": "대상 포함",
  "related-container": "연결 후보 포함",
};

/** Project a static implementation scope onto every navigation level without
 * including unrelated siblings or changing the graph/implementation contract. */
export function scopeHighlights(
  graph: StructureGraph,
  targetIds: string[],
  relatedIds: string[],
): ScopeHighlights {
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const targets = descendantIds(
    graph,
    targetIds.filter((id) => lookup.has(id)),
  );
  const related = new Set(relatedIds.filter((id) => lookup.has(id)));
  const parents = new Map<string, Set<string>>();
  const link = (child: string, parent: string) => {
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child)!.add(parent);
  };
  for (const node of graph.nodes) {
    if (node.parentId) link(node.id, node.parentId);
    for (const member of node.members ?? []) link(member, node.id);
  }
  const containers = (seeds: Set<string>) => {
    const included = new Set(seeds),
      queue = [...seeds];
    for (let i = 0; i < queue.length; i++) {
      for (const parent of parents.get(queue[i]) ?? []) {
        if (!included.has(parent) && lookup.has(parent)) {
          included.add(parent);
          queue.push(parent);
        }
      }
    }
    return included;
  };
  const targetContainers = containers(targets),
    relatedContainers = containers(related);
  const nodes = new Map<string, ScopeMarker>();
  for (const node of graph.nodes) {
    const marker = targets.has(node.id)
      ? "target"
      : targetContainers.has(node.id)
        ? "target-container"
        : related.has(node.id)
          ? "related"
          : relatedContainers.has(node.id)
            ? "related-container"
            : undefined;
    if (marker) nodes.set(node.id, marker);
  }
  const edges = new Set(
    graph.edges
      .filter(
        (edge) =>
          edge.kind !== "imports" &&
          related.has(edge.source) &&
          related.has(edge.target),
      )
      .map((edge) => edge.id),
  );
  return { nodes, edges };
}
