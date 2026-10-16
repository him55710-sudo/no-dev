import { z } from "zod";
import { livingSpecSchema, specContentSchema, type LivingSpec } from "./spec";

// A draft must preserve unfinished input, including an empty title or list row.
export const draftContentSchema = specContentSchema.extend({
  title: z.string().max(160),
  invariants: z.array(z.string().max(2000)).max(100),
  acceptance: z.array(z.string().max(2000)).max(100),
});
export const designDraftSchema = z
  .object({
    base: livingSpecSchema,
    content: draftContentSchema,
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type DesignDraft = z.infer<typeof designDraftSchema>;
export const draftWriteSchema = z
  .object({
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    base: livingSpecSchema,
    content: draftContentSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type DraftWrite = z.infer<typeof draftWriteSchema>;
export const draftIdentitySchema = z
  .object({
    projectKey: z.string().regex(/^[a-f0-9]{64}$/),
    specId: z.string().min(1).max(4096),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type DraftIdentity = z.infer<typeof draftIdentitySchema>;
export const draftRebaseSchema = draftIdentitySchema.extend({
  expectedGraphRevision: z.string().regex(/^[a-f0-9]{64}$/),
  expectedDesign: livingSpecSchema,
});
export type DraftRebase = z.infer<typeof draftRebaseSchema>;
export function cleanDraft(content: DesignDraft["content"]) {
  return specContentSchema.parse({
    ...content,
    invariants: content.invariants.map((v) => v.trim()).filter(Boolean),
    acceptance: content.acceptance.map((v) => v.trim()).filter(Boolean),
  });
}
/** A newer observation must never silently replace the context the user edited. */
export function draftMatches(
  draft: Pick<DesignDraft, "base">,
  current: LivingSpec,
) {
  const base = draft.base;
  if (base.revision || current.revision)
    return JSON.stringify(base) === JSON.stringify(current);
  // Unsaved generated designs have a fresh timestamp on every analysis.
  return (
    base.id === current.id &&
    JSON.stringify(base.targetIds) === JSON.stringify(current.targetIds) &&
    JSON.stringify(base.baseline) === JSON.stringify(current.baseline)
  );
}
