import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { DesignWorkspaceState } from "../../src/workspace/state";
import type { FileReading } from "../../src/workspace/codeReading";

const initial = (await (
  await fetch("/test-results/code-reading/ui-state.json")
).json()) as {
  state: DesignWorkspaceState;
  reading: FileReading;
};
let update: (next: DesignWorkspaceState) => void = () => {};
let observed: (request: unknown) => void = () => {};
let current = initial.state;
let saved: unknown;
const deliver = (id: string, result?: unknown, error?: string) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "response", id, result, error },
    }),
  );
Object.assign(window, {
  acquireVsCodeApi: () => ({
    getState: () => saved,
    setState: (value: unknown) => {
      saved = value;
    },
    postMessage: (message: {
      id: string;
      action: string;
      payload?: Record<string, unknown>;
    }) => {
      observed(message);
      if (message.action === "readFile") {
        current = { ...current, fileReading: initial.reading };
        update(current);
        queueMicrotask(() => deliver(message.id, initial.reading));
      } else if (message.action === "implement") {
        // Only observe the real component's request; this fixture never mutates a project.
        queueMicrotask(() =>
          deliver(
            message.id,
            undefined,
            "화면 검사에서는 실제 수정을 실행하지 않습니다.",
          ),
        );
      } else queueMicrotask(() => deliver(message.id));
    },
  }),
});
const { ProjectReader } = await import("../../extension/ui/ProjectReader");
function Preview() {
  const [state, setState] = useState(current);
  const [last, setLast] = useState<unknown>(null);
  update = setState;
  observed = setLast;
  return (
    <>
      <aside className="fixture-tools">
        실제 컴포넌트 · 저장한 실제 AI 해석 · 수정 실행은 시험 전송으로 대체
        <button
          onClick={() => {
            current = { ...current, stale: true };
            setState(current);
          }}
        >
          시험: 원문 변경
        </button>
        <button
          onClick={() => {
            current = { ...initial.state };
            setState(current);
          }}
        >
          시험: 상태 복원
        </button>
        <details>
          <summary>전달된 요청 확인</summary>
          <pre id="fixture-request">{JSON.stringify(last, null, 2)}</pre>
        </details>
      </aside>
      <ProjectReader state={state} onAdvanced={() => {}} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
