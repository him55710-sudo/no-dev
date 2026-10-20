declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(value: unknown): void;
};
export const host = acquireVsCodeApi();
let sequence = 0;
const pending = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
window.addEventListener("message", (e) => {
  if (e.data?.type !== "response") return;
  const request = pending.get(e.data.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(e.data.id);
  if (e.data.error) request.reject(Error(e.data.error));
  else request.resolve(e.data.result);
});
export function request<T = void>(
  action: string,
  payload?: Record<string, unknown>,
  contextId?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(
          Error(
            "응답이 없습니다. 설명을 다시 열어 주세요. / No response; reopen the explanation.",
          ),
        );
      },
      ["explainProject","explainChanges"].includes(action) ? 3600000 : action === "localGenerate" ? 240000 : 60000,
    );
    pending.set(id, { resolve, reject, timer });
    host.postMessage({ id, action, payload, contextId });
  });
}
