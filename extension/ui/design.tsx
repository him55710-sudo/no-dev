import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { DesignWorkspaceView } from "../../src/workspace/DesignWorkspaceView";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import type { LivingSpec } from "../../src/workspace/spec";
import type { Feature } from "../../src/workspace/features";
import type { DesignDraft } from "../../src/workspace/drafts";
import type { NavigationSnapshot } from "../../src/workspace/navigation";
import { request } from "./bridge";
import { ProjectReader } from "./ProjectReader";

function DesignApp() {
  const [advanced, setAdvanced] = useState(false);
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
      else if (event.data?.type === "workspacePatch")
        setState((old) => {
          const next = { ...old, ...event.data.changed };
          for (const key of event.data.removed ?? []) delete next[key];
          return next;
        });
    };
    window.addEventListener("message", receive);
    void request("ready").catch((error) =>
      setState((old) => ({ ...old, busy: false, error: String(error) })),
    );
    return () => window.removeEventListener("message", receive);
  }, []);
  if (!advanced)
    return (
      <ProjectReader
        key={state.projectKey ?? "loading"}
        state={state}
        onAdvanced={() => setAdvanced(true)}
      />
    );
  return (
    <>
      <button onClick={() => setAdvanced(false)}>
        ← 쉬운 한국어 화면으로 돌아가기
      </button>
      {
        <DesignWorkspaceView
          key={state.projectKey ?? "loading"}
          state={state}
          actions={{
            refresh: () => request("refresh"),
            saveNavigation: (payload) =>
              request<NavigationSnapshot>("saveNavigation", payload),
            source: (nodeId, sourceIndex) =>
              request("source", { nodeId, sourceIndex }),
            save: (
              targetIds,
              content,
              expectedRevision,
              specId,
              draftRevision,
            ) =>
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
              execution,
              specId,
              draftRevision,
            ) =>
              request("implement", {
                targetIds,
                content,
                expectedRevision,
                execution,
                specId,
                draftRevision,
                projectKey: state.projectKey,
              }),
            acceptBaseline: (payload) => request("acceptBaseline", payload),
            saveExecution: (payload) => request("saveExecution", payload),
            revokeExecution: (payload) => request("revokeExecution", payload),
            checkConnection: (payload) => request("checkConnection", payload),
            executionSettings: () => request("executionSettings"),
            saveDraft: (payload) => request<DesignDraft>("saveDraft", payload),
            removeDraft: (payload) => request("removeDraft", payload),
            rebaseDraft: (payload) =>
              request<DesignDraft>("rebaseDraft", payload),
            saveFeature: (payload) => request<Feature>("saveFeature", payload),
            removeFeature: (payload) => request("removeFeature", payload),
            jobAction: (action, payload) => request(action, payload),
          }}
        />
      }
    </>
  );
}
createRoot(document.getElementById("root")!).render(<DesignApp />);
