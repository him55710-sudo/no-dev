let worker: Worker | undefined;
let counter = 0;
const pending = new Map<
  number,
  {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function failAll(message: string) {
  worker?.terminate();
  worker = undefined;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error(message));
  }
  pending.clear();
}
export function request<T>(type: string, payload: unknown): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./core/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const p = pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(id);
        if (error) p.reject(Error(error));
        else p.resolve(result);
      }
    };
    worker.onerror = () =>
      failAll("분석기를 다시 시작해야 합니다. / Worker failed.");
  }
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(
      () =>
        failAll(
          "분석 시간이 초과되어 중단했습니다. 파일 크기를 줄여 주세요. / Analysis timed out.",
        ),
      20000,
    );
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, type, payload });
  });
}
