import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DesignWorkspaceState } from "./state";
import {
  initialNavigation,
  reconcileNavigation,
  type NavigationSnapshot,
  type NavigationWrite,
} from "./navigation";
import { NavigationWriter } from "./navigationWriter";

export type NavigationActions = {
  saveNavigation?: (request: NavigationWrite) => Promise<NavigationSnapshot>;
};

export function useWorkspaceNavigation(
  state: DesignWorkspaceState,
  actions: NavigationActions,
) {
  const identity =
    (state.projectKey ?? "preview") +
    ":" +
    (state.navigation?.generation ?? state.selectedId);
  // Only explicit host navigation creates a writer. An acknowledgement must not
  // discard newer unsent input or remount the canvas.
  const writer = useMemo(
    () =>
      new NavigationWriter(
        state.projectKey,
        state.navigation ?? {
          generation: 0,
          revision: 0,
          view: initialNavigation(state.selectedId),
        },
      ),
    [identity],
  );
  const value = useSyncExternalStore(
    writer.subscribe,
    writer.snapshot,
    writer.snapshot,
  );
  useEffect(() => {
    writer.connect(actions.saveNavigation);
  }, [writer, actions.saveNavigation]);
  useEffect(() => () => writer.disconnect(), [writer]);
  useEffect(() => {
    if (state.navigation) writer.observe(state.navigation);
    if (state.graph)
      writer.update((view) =>
        reconcileNavigation(view, state.graph!, [
          ...state.specs.specs.map((spec) => spec.id),
          ...(state.drafts ?? []).map((draft) => draft.base.id),
        ]),
      );
  }, [writer, state.navigation, state.graph, state.specs, state.drafts]);
  return {
    ...value,
    update: (change: Parameters<NavigationWriter["update"]>[0]) =>
      writer.update(change),
    retry: () => writer.retry(),
  };
}
