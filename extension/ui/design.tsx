import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { DesignWorkspaceView } from "../../src/workspace/DesignWorkspaceView";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import type { LivingSpec } from "../../src/workspace/spec";
import type { Feature } from "../../src/workspace/features";
import type { DesignDraft } from "../../src/workspace/drafts";
import { request } from "./bridge";

function DesignApp() {
  const [state, setState] = useState<DesignWorkspaceState>({
    projectName: "",
    selectedId: "system",
    busy: true,
    stale: false,
    trusted: false,
    specs: { schemaVersion: 1, specs: [] },
    notices: [],
  });
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "workspaceState") setState(event.data.state);
    };
    window.addEventListener("message", receive);
    void request("ready").catch((error) =>
      setState((old) => ({ ...old, busy: false, error: String(error) })),
    );
    return () => window.removeEventListener("message", receive);
  }, []);
  return (
    <DesignWorkspaceView
      key={state.projectKey ?? "loading"}
      state={state}
      actions={{
        refresh: () => request("refresh"),
        source: (nodeId, sourceIndex) =>
          request("source", { nodeId, sourceIndex }),
        save: (targetIds, content, expectedRevision, specId, draftRevision) =>
          request<LivingSpec>("saveSpec", {
            targetIds,
            content,
            expectedRevision,
            specId,
            draftRevision,
            projectKey: state.projectKey,
          }),
        implement: (
          targetIds,
          content,
          expectedRevision,
          checks,
          specId,
          draftRevision,
        ) =>
          request("implement", {
            targetIds,
            content,
            expectedRevision,
            checks,
            allowExternal: true,
            specId,
            draftRevision,
            projectKey: state.projectKey,
          }),
        acceptBaseline: (payload) => request("acceptBaseline", payload),
        saveDraft: (payload) => request<DesignDraft>("saveDraft", payload),
        removeDraft: (payload) => request("removeDraft", payload),
        rebaseDraft: (payload) => request<DesignDraft>("rebaseDraft", payload),
        saveFeature: (payload) => request<Feature>("saveFeature", payload),
        removeFeature: (payload) => request("removeFeature", payload),
        jobAction: (action, payload) => request(action, payload),
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(<DesignApp />);
