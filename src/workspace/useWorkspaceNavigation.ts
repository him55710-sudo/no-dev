import { useEffect, useRef, useState, type SetStateAction } from "react";
import type { DesignWorkspaceState } from "./state";
import {
  initialNavigation,
  reconcileNavigation,
  type NavigationSnapshot,
  type NavigationWrite,
  type WorkspaceNavigation,
} from "./navigation";

export type NavigationActions = {
  saveNavigation?: (request: NavigationWrite) => Promise<NavigationSnapshot>;
};

export function useWorkspaceNavigation(
  state: DesignWorkspaceState,
  actions: NavigationActions,
) {
  const identity = `${state.projectKey ?? "preview"}:${state.navigation?.generation ?? state.selectedId}`;
  const seed = state.navigation?.view ?? initialNavigation(state.selectedId);
  const [local, setLocal] = useState(() => ({
    identity,
    graph: state.graph?.revision,
    view: seed,
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  if (local.identity !== identity) {
    setLocal({ identity, graph: state.graph?.revision, view: seed });
  } else if (state.graph && local.graph !== state.graph.revision) {
    const specIds = [
      ...state.specs.specs.map((spec) => spec.id),
      ...(state.drafts ?? []).map((draft) => draft.base.id),
    ];
    setLocal({
      ...local,
      graph: state.graph.revision,
      view: reconcileNavigation(local.view, state.graph, specIds),
    });
  }
  const writer = useRef<{
    active: boolean;
    identity: string;
    saved: string;
    latest: string;
    pending?: {
      request: NavigationWrite;
      value: string;
      identity: string;
      save: NonNullable<NavigationActions["saveNavigation"]>;
    };
  }>({ active: false, identity, saved: JSON.stringify(seed), latest: "" });
  useEffect(() => {
    writer.current.identity = identity;
    writer.current.saved = JSON.stringify(seed);
    writer.current.pending = undefined;
    setError("");
    setSaving(false);
  }, [identity]);
  const serialized = JSON.stringify(local.view);
  useEffect(() => {
    const queue = writer.current;
    if (
      !actions.saveNavigation ||
      !state.projectKey ||
      !state.graph ||
      !state.navigation ||
      local.identity !== identity
    )
      return;
    if (queue.saved === serialized && !queue.active && !queue.pending) {
      setError("");
      return;
    }
    queue.latest = serialized;
    queue.pending = {
      request: {
        projectKey: state.projectKey,
        generation: state.navigation.generation,
        view: local.view,
      },
      value: serialized,
      identity,
      save: actions.saveNavigation,
    };
    setSaving(true);
    async function drain() {
      if (queue.active) return;
      queue.active = true;
      try {
        while (queue.pending) {
          const next = queue.pending;
          queue.pending = undefined;
          try {
            await next.save(next.request);
            if (queue.identity === next.identity) {
              queue.saved = next.value;
              if (queue.latest === next.value) setError("");
            }
          } catch (error) {
            if (queue.identity === next.identity && queue.latest === next.value)
              setError(error instanceof Error ? error.message : String(error));
          }
        }
      } finally {
        queue.active = false;
        setSaving(false);
      }
    }
    void drain();
  }, [serialized, identity, retry, state.graph?.revision]);
  const update = (change: SetStateAction<WorkspaceNavigation>) =>
    setLocal((current) => ({
      ...current,
      view: typeof change === "function" ? change(current.view) : change,
    }));
  return {
    view: local.view,
    update,
    error,
    saving,
    retry: () => {
      writer.current.saved = "";
      setRetry((value) => value + 1);
    },
  };
}
