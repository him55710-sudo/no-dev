import { useEffect, useRef, useState } from "react";
import type { LivingSpec, SpecContent } from "./spec";
import type {
  DesignDraft,
  DraftIdentity,
  DraftRebase,
  DraftWrite,
} from "./drafts";

export type DraftActions = {
  saveDraft?: (request: DraftWrite) => Promise<DesignDraft>;
  removeDraft?: (request: DraftIdentity) => Promise<unknown>;
  rebaseDraft?: (request: DraftRebase) => Promise<DesignDraft>;
};
type EditingDraft = DesignDraft & {
  status: "saving" | "saved" | "error" | "memory";
  error?: string;
};
export function useDesignDrafts(
  initial: DesignDraft[],
  projectKey: string | undefined,
  actions: DraftActions,
) {
  const [entries, setEntries] = useState(
    () =>
      new Map(
        initial.map((draft) => [
          draft.base.id,
          { ...draft, status: "saved" as const },
        ]),
      ) as Map<string, EditingDraft>,
  );
  const current = useRef(entries);
  const revisions = useRef(
    new Map(initial.map((draft) => [draft.base.id, draft.revision])),
  );
  const queues = useRef(new Map<string, Promise<unknown>>());
  const sequence = useRef(new Map<string, number>());
  useEffect(() => {
    // A write accepted just before the panel closed may finish after reopening.
    // Import newly arrived records without replacing any text already being edited.
    const next = new Map(current.current);
    for (const draft of initial) {
      if (next.has(draft.base.id)) continue;
      next.set(draft.base.id, { ...draft, status: "saved" });
      revisions.current.set(draft.base.id, draft.revision);
    }
    if (next.size !== current.current.size) {
      current.current = next;
      setEntries(next);
    }
  }, [initial]);
  const update = (id: string, draft?: EditingDraft) => {
    const next = new Map(current.current);
    if (draft) next.set(id, draft);
    else next.delete(id);
    current.current = next;
    setEntries(next);
  };
  const change = (spec: LivingSpec, content: SpecContent) => {
    const id = spec.id,
      base = current.current.get(id)?.base ?? spec;
    const revision = revisions.current.get(id) ?? 0;
    const ticket = (sequence.current.get(id) ?? 0) + 1;
    sequence.current.set(id, ticket);
    update(id, {
      base,
      content,
      revision,
      updatedAt: new Date().toISOString(),
      status: actions.saveDraft && projectKey ? "saving" : "memory",
    });
    if (!actions.saveDraft || !projectKey) return;
    const work = (queues.current.get(id) ?? Promise.resolve()).then(
      async () => {
        const saved = await actions.saveDraft!({
          projectKey,
          base,
          content,
          expectedRevision: revisions.current.get(id) ?? 0,
        });
        revisions.current.set(id, saved.revision);
        if (sequence.current.get(id) === ticket)
          update(id, { ...saved, status: "saved" });
      },
    );
    queues.current.set(id, work);
    void work.catch((error) => {
      const draft = current.current.get(id);
      if (draft)
        update(id, {
          ...draft,
          status: "error",
          error: String(error instanceof Error ? error.message : error),
        });
    });
  };
  const flush = async (id: string) => {
    await queues.current.get(id);
    return actions.saveDraft && projectKey
      ? revisions.current.get(id)
      : undefined;
  };
  const forget = (id: string) => {
    queues.current.delete(id);
    revisions.current.delete(id);
    sequence.current.delete(id);
    update(id);
  };
  return {
    entries,
    change,
    flush,
    forget,
    retry(id: string) {
      const draft = current.current.get(id);
      if (!draft) return;
      queues.current.delete(id);
      change(draft.base, draft.content);
    },
    async discard(id: string) {
      await queues.current.get(id)?.catch(() => {});
      const revision = revisions.current.get(id);
      if (revision && projectKey && actions.removeDraft)
        await actions.removeDraft({
          projectKey,
          specId: id,
          expectedRevision: revision,
        });
      forget(id);
    },
    async rebase(
      id: string,
      expectedDesign: LivingSpec,
      expectedGraphRevision: string,
    ) {
      const revision = await flush(id);
      if (!revision || !projectKey || !actions.rebaseDraft)
        throw Error("초안을 먼저 보관한 뒤 다시 비교해 주세요.");
      const draft = await actions.rebaseDraft({
        projectKey,
        specId: id,
        expectedRevision: revision,
        expectedDesign,
        expectedGraphRevision,
      });
      revisions.current.set(id, draft.revision);
      update(id, { ...draft, status: "saved" });
    },
  };
}
