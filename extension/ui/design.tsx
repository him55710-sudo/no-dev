import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { DesignWorkspaceView } from "../../src/workspace/DesignWorkspaceView";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import type { LivingSpec } from "../../src/workspace/spec";
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
      state={state}
      actions={{
        refresh: () => request("refresh"),
        source: (nodeId, sourceIndex) =>
          request("source", { nodeId, sourceIndex }),
        save: (targetIds, content, expectedRevision) =>
          request<LivingSpec>("saveSpec", {
            targetIds,
            content,
            expectedRevision,
          }),
        implement: (targetIds, content, expectedRevision, checks) =>
          request("implement", {
            targetIds,
            content,
            expectedRevision,
            checks,
            allowExternal: true,
          }),
        jobAction: (action, payload) => request(action, payload),
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(<DesignApp />);
