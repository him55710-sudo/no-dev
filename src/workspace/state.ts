import type { StructureGraph } from "./model";
import type { SpecDocument } from "./spec";
export type DesignWorkspaceState = {
  projectName: string;
  graph?: StructureGraph;
  specs: SpecDocument;
  selectedId: string;
  busy: boolean;
  stale: boolean;
  trusted: boolean;
  error?: string;
  notices: string[];
};
