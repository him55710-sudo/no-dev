import { Worker } from "node:worker_threads";
export class AnalysisClient {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private workerPath: string) {}
  call<T>(type: string, payload: unknown): Promise<T> {
    if (!this.worker) {
      const w = (this.worker = new Worker(this.workerPath));
      w.on("message", ({ id, result, error }) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (error) p.reject(Error(error));
        else p.resolve(result);
      });
      w.on("error", (e) => {
        if (this.worker === w) this.reset(e);
      });
      w.on("exit", () => {
        if (this.worker === w)
          this.reset(Error("분석기가 종료되었습니다. 다시 시도해 주세요."));
      });
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(
        () =>
          this.reset(
            Error("분석 시간이 초과되었습니다. 더 작은 파일로 시도해 주세요."),
          ),
        20000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, type, payload });
    });
  }
  private reset(error: Error) {
    const old = this.worker;
    this.worker = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    void old?.terminate();
  }
  dispose() {
    this.reset(Error("확장 기능이 종료되었습니다."));
  }
}
