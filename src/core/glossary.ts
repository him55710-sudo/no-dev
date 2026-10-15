import type { Anchor, Lang, Words } from "./types";

export type GlossaryEntry = {
  path: string;
  symbolId: string;
  labels: Partial<Words>;
};
export type CodeTerm = Anchor & {
  id: string;
  name: string;
  scope: string;
  kind: "variable" | "function" | "parameter";
  label: Words;
  defaults: Words;
  custom?: Partial<Words>;
};
const MAX_ENTRIES = 500;
export function normalizeGlossary(value: unknown): GlossaryEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ENTRIES)
    throw Error(
      "용어는 최대 500개까지 저장할 수 있습니다. / At most 500 custom terms.",
    );
  const result = new Map<string, GlossaryEntry>();
  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.path !== "string" ||
      !raw.path ||
      raw.path.length > 2048 ||
      typeof raw.symbolId !== "string" ||
      !raw.symbolId ||
      raw.symbolId.length > 2048 ||
      !raw.labels ||
      typeof raw.labels !== "object" ||
      Array.isArray(raw.labels)
    )
      throw Error("용어 사전 형식이 올바르지 않습니다. / Invalid glossary.");
    const labels: Partial<Words> = {};
    for (const lang of ["ko", "en"] as const) {
      const label: unknown = raw.labels[lang];
      if (label === undefined) continue;
      if (
        typeof label !== "string" ||
        label.length > 80 ||
        /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(label)
      )
        throw Error(
          "용어는 줄바꿈 없이 80자까지 입력하세요. / Use up to 80 characters without control characters.",
        );
      if (label.trim()) labels[lang] = label.trim();
    }
    if (Object.keys(labels).length)
      result.set(JSON.stringify([raw.path, raw.symbolId]), {
        path: raw.path,
        symbolId: raw.symbolId,
        labels,
      });
  }
  return [...result.values()].sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.symbolId.localeCompare(b.symbolId),
  );
}
export function updateGlossary(
  entries: GlossaryEntry[],
  path: string,
  symbolId: string,
  lang: Lang,
  label: string,
) {
  const current = entries.find(
    (e) => e.path === path && e.symbolId === symbolId,
  );
  const rest = entries.filter(
    (e) => e.path !== path || e.symbolId !== symbolId,
  );
  return normalizeGlossary([
    ...rest,
    { path, symbolId, labels: { ...current?.labels, [lang]: label } },
  ]);
}
