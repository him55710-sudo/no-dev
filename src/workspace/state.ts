import type { StructureGraph } from "./model";
import type { SpecDocument } from "./spec";
import type { DesignDraft } from "./drafts";
import type {
  ImplementationJob,
  VerificationName,
  JobHistoryEntry,
} from "./job";
export type DesignWorkspaceState = {
  projectName: string;
  projectKey?: string;
  drafts?: DesignDraft[];
  draftError?: string;
  graph?: StructureGraph;
  specs: SpecDocument;
  selectedId: string;
  busy: boolean;
  stale: boolean;
  trusted: boolean;
  error?: string;
  notices: string[];
  checks?: VerificationName[];
  job?: ImplementationJob;
  jobHistory?: JobHistoryEntry[];
  jobHistoryErrors?: string[];
};
