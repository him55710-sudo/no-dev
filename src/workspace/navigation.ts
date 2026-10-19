import { z } from "zod";
import { ancestors, structureChildren, type StructureGraph } from "./model";

const id = z.string().min(1).max(4096);
const coordinate = z.number().finite().min(-10000000).max(10000000);
export const canvasLocationSchema = z
  .object({
    scopeId: id,
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        zoom: z.number().min(0.2).max(1.5),
      })
      .strict()
      .optional(),
    positions: z
      .array(z.object({ id, x: coordinate, y: coordinate }).strict())
      .max(2000),
  })
  .strict();
export type CanvasLocation = z.infer<typeof canvasLocationSchema>;
export const navigationSchema = z
  .object({
    selection: id,
    scopeTrail: z.array(id).min(1).max(100),
    savedSpecId: id.optional(),
    included: z.array(id).max(100),
    connections: z.array(id).max(20000),
    expanded: z.array(id).max(12000),
    search: z.string().max(500),
    focus: z.boolean(),
    canvases: z.array(canvasLocationSchema).max(200),
  })
  .strict();
export type WorkspaceNavigation = z.infer<typeof navigationSchema>;
export type NavigationSnapshot = {
  generation: number;
  view: WorkspaceNavigation;
};
export const navigationWriteSchema = z
  .object({
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().nonnegative(),
    view: navigationSchema,
  })
  .strict();
export type NavigationWrite = z.infer<typeof navigationWriteSchema>;

export function initialNavigation(selection = "system"): WorkspaceNavigation {
  return {
    selection,
    scopeTrail: ["system"],
    included: [],
    connections: [],
    expanded: ["system"],
    search: "",
    focus: false,
    canvases: [],
  };
}

/** Keep exact surviving identities. Never guess a renamed node from its label. */
export function reconcileNavigation(
  view: WorkspaceNavigation,
  graph: StructureGraph,
  specIds: readonly string[],
): WorkspaceNavigation {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const edges = new Set(graph.edges.map((edge) => edge.id));
  const keep = (ids: string[], available: Set<string>) =>
    [...new Set(ids)].filter((value) => available.has(value));
  const scopeTrail = ["system"];
  for (const next of view.scopeTrail.slice(1)) {
    if (
      scopeTrail.includes(next) ||
      !structureChildren(graph, scopeTrail.at(-1)!).some(
        (node) => node.id === next,
      )
    )
      break;
    scopeTrail.push(next);
  }
  const selection =
    nodes.has(view.selection) || edges.has(view.selection)
      ? view.selection
      : scopeTrail.at(-1)!;
  const canvases = view.canvases
    .filter((canvas) => nodes.has(canvas.scopeId))
    .map((canvas) => {
      const children = structureChildren(graph, canvas.scopeId);
      const visible = new Set(
        children.length ? children.map((node) => node.id) : [canvas.scopeId],
      );
      return {
        ...canvas,
        positions: canvas.positions.filter((position) =>
          visible.has(position.id),
        ),
      };
    });
  return {
    ...view,
    selection,
    scopeTrail,
    canvases,
    savedSpecId:
      view.savedSpecId && specIds.includes(view.savedSpecId)
        ? view.savedSpecId
        : undefined,
    included: keep(view.included, nodes),
    connections: keep(view.connections, edges),
    expanded: keep(view.expanded, nodes),
  };
}

export function enterScope(
  view: WorkspaceNavigation,
  graph: StructureGraph,
  id: string,
): WorkspaceNavigation {
  const index = view.scopeTrail.indexOf(id);
  const scopeTrail =
    index >= 0
      ? view.scopeTrail.slice(0, index + 1)
      : structureChildren(graph, view.scopeTrail.at(-1)!).some(
            (node) => node.id === id,
          )
        ? [...view.scopeTrail, id]
        : ancestors(graph, id).map((node) => node.id);
  return { ...view, scopeTrail: scopeTrail.length ? scopeTrail : ["system"] };
}
