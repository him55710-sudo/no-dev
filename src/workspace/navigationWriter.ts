import {
  applyNavigationPatch,
  mergeNavigationPatch,
  navigationDifference,
  type NavigationPatch,
  type NavigationSnapshot,
  type NavigationWrite,
  type WorkspaceNavigation,
} from "./navigation";

type Save = (request: NavigationWrite) => Promise<NavigationSnapshot>;
type View = { view: WorkspaceNavigation; error: string; saving: boolean };

/** One mounted view's edits. Host snapshots and acknowledgements share a revision. */
export class NavigationWriter {
  private base: NavigationSnapshot;
  private pending: NavigationPatch = {};
  private flight?: { patch: NavigationPatch };
  private sender?: Save;
  private active = false;
  private listeners = new Set<() => void>();
  private value: View;
  constructor(
    private projectKey: string | undefined,
    snapshot: NavigationSnapshot,
  ) {
    this.base = snapshot;
    this.value = { view: snapshot.view, error: "", saving: false };
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  connect(save?: Save) {
    this.active = true;
    this.sender = save;
    this.schedule();
  }
  disconnect() {
    this.active = false;
  }
  observe(snapshot: NavigationSnapshot) {
    if (
      snapshot.generation !== this.base.generation ||
      snapshot.revision <= this.base.revision
    )
      return;
    this.base = snapshot;
    this.publish();
  }
  update(
    change:
      | WorkspaceNavigation
      | ((current: WorkspaceNavigation) => WorkspaceNavigation),
  ) {
    const next =
      typeof change === "function" ? change(this.value.view) : change;
    const patch = navigationDifference(this.value.view, next);
    if (!Object.keys(patch).length) return;
    this.pending = mergeNavigationPatch(this.pending, patch);
    this.publish("");
    this.schedule();
  }
  retry() {
    this.publish("");
    this.schedule();
  }
  private publish(error = this.value.error) {
    const view = applyNavigationPatch(
      applyNavigationPatch(this.base.view, this.flight?.patch ?? {}),
      this.pending,
    );
    const next = {
      view,
      error,
      saving:
        !!this.flight ||
        (!error && !!this.sender && Object.keys(this.pending).length > 0),
    };
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }
  private schedule() {
    queueMicrotask(() => void this.drain());
  }
  private async drain() {
    if (
      !this.active ||
      !this.sender ||
      !this.projectKey ||
      this.flight ||
      !Object.keys(this.pending).length ||
      this.value.error
    )
      return;
    const flight = (this.flight = { patch: this.pending });
    this.pending = {};
    this.publish("");
    try {
      const result = await this.sender({
        projectKey: this.projectKey,
        generation: this.base.generation,
        patch: flight.patch,
      });
      this.flight = undefined;
      if (!this.active) return;
      if (result.generation !== this.base.generation) {
        // Explicit source navigation supersedes this view. Never retry old edits
        // in the newer context; the host emits its replacement state as well.
        this.pending = {};
        this.sender = undefined;
        this.base = result;
      } else if (result.revision >= this.base.revision) this.base = result;
      this.publish("");
      this.schedule();
    } catch (error) {
      this.flight = undefined;
      if (!this.active) return;
      this.pending = mergeNavigationPatch(flight.patch, this.pending);
      this.publish(error instanceof Error ? error.message : String(error));
      // Retain failed edits visibly. Retry is explicit or follows a new edit.
    }
  }
}
