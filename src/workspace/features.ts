import { z } from "zod";
import {
  sha256,
  sourceRefSchema,
  type StructureGraph,
  type StructureNode,
} from "./model";

export const featureSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(12000),
    members: z
      .array(
        z
          .object({
            nodeId: z.string().min(1).max(4096),
            label: z.string().max(4096),
            kind: z.enum(["group", "file", "symbol", "rule"]),
            sources: z.array(sourceRefSchema).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Feature = z.infer<typeof featureSchema>;
export const featureListSchema = z
  .array(featureSchema)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "기능 ID가 중복되었습니다.",
  );
export const featureRequestSchema = z
  .object({
    id: z.string().uuid().optional(),
    expectedRevision: z.number().int().nonnegative(),
    expectedGraphRevision: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(12000),
    memberIds: z.array(z.string().min(1).max(4096)).min(1).max(100),
  })
  .strict();
export type FeatureRequest = z.infer<typeof featureRequestSchema>;
export const featureNodeId = (id: string) => `feature:${id}`;
export const codeTreeId = "code-tree";
export const canBeFeatureMember = (node: StructureNode) =>
  node.origin !== "user" && node.kind !== "system" && node.id !== codeTreeId;

export function resolveFeatureMembers(feature: Feature, graph: StructureGraph) {
  const candidates = graph.nodes.filter(canBeFeatureMember);
  const nodes: StructureNode[] = [],
    unresolved: Feature["members"] = [];
  for (const member of feature.members) {
    let found = candidates.find(
      (node) => node.id === member.nodeId && node.kind === member.kind,
    );
    if (!found && member.sources.length) {
      const matches = candidates.filter(
        (node) =>
          node.kind === member.kind &&
          node.sources.length === member.sources.length &&
          member.sources.every((old) =>
            node.sources.some(
              (ref) =>
                ref.symbol === old.symbol &&
                ref.contentHash === old.contentHash,
            ),
          ),
      );
      if (matches.length === 1) found = matches[0];
    }
    if (found) {
      if (!nodes.some((node) => node.id === found!.id)) nodes.push(found);
    } else unresolved.push(member);
  }
  return { nodes, unresolved };
}

/** Save only grouping metadata. References come from the host graph, never client-supplied hashes. */
export function saveFeature(
  features: Feature[],
  graph: StructureGraph,
  raw: FeatureRequest,
  newId: string,
  now = new Date().toISOString(),
): Feature[] {
  const request = featureRequestSchema.parse(raw);
  if (request.expectedGraphRevision !== graph.revision)
    throw Error("구조가 바뀌었습니다. 기능 묶음 편집을 다시 열어 주세요.");
  const previous = features.find((item) => item.id === request.id);
  if (
    (request.id && !previous) ||
    (previous?.revision ?? 0) !== request.expectedRevision
  )
    throw Error(
      "다른 편집으로 기능 묶음이 바뀌었습니다. 다시 열어 비교해 주세요.",
    );
  const members = [...new Set(request.memberIds)].map((id) => {
    const node = graph.nodes.find((item) => item.id === id);
    const retained = previous?.members.find((item) => item.nodeId === id);
    if (!node && retained) return retained;
    if (!node || !canBeFeatureMember(node))
      throw Error("연결할 코드 대상을 현재 분석에서 찾을 수 없습니다.");
    return {
      nodeId: id,
      label: node.label,
      kind: node.kind,
      sources: node.sources,
    };
  });
  const feature = featureSchema.parse({
    id: previous?.id ?? newId,
    revision: (previous?.revision ?? 0) + 1,
    title: request.title,
    description: request.description,
    members,
    updatedAt: now,
  });
  return featureListSchema.parse([
    ...features.filter((item) => item.id !== feature.id),
    feature,
  ]);
}

export const removeFeatureSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    expectedGraphRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RemoveFeatureRequest = z.infer<typeof removeFeatureSchema>;
export function removeFeature(
  features: Feature[],
  graph: StructureGraph,
  raw: RemoveFeatureRequest,
): Feature[] {
  const request = removeFeatureSchema.parse(raw);
  const previous = features.find((item) => item.id === request.id);
  if (
    !previous ||
    previous.revision !== request.expectedRevision ||
    graph.revision !== request.expectedGraphRevision
  )
    throw Error("기능 묶음이나 코드가 바뀌었습니다. 다시 열어 확인해 주세요.");
  return features.filter((item) => item.id !== previous.id);
}

/** User-defined features retain shared canonical code nodes and untouched compiler edges. */
export async function projectFeatures(
  base: StructureGraph,
  features: Feature[],
): Promise<StructureGraph> {
  if (!features.length) return base;
  const nodes: StructureNode[] = base.nodes.map((node) =>
    node.parentId === "system" ? { ...node, parentId: codeTreeId } : node,
  );
  nodes.push({
    id: codeTreeId,
    parentId: "system",
    kind: "group",
    origin: "directory",
    label: "코드 구조",
    summary: "모든 구현과 미분류·미지원 코드를 원래 경로로 탐색합니다.",
    sources: [],
    syntaxValid: true,
  });
  const notices = [...base.notices];
  for (const feature of features) {
    const { nodes: members, unresolved } = resolveFeatureMembers(feature, base);
    nodes.push({
      id: featureNodeId(feature.id),
      parentId: "system",
      kind: "feature",
      origin: "user",
      label: feature.title,
      description: feature.description,
      summary:
        `사용자가 묶은 업무 기능입니다. ${members.length}개 코드 대상에 연결되어 있으며 ${unresolved.length}개 대상은 다시 연결해야 합니다. 기능의 이름과 설명은 사용자가 작성했습니다.\n\n${members.map((node) => `${node.label}: ${node.summary}`).join("\n\n")}`.slice(
          0,
          12000,
        ),
      sources: [],
      syntaxValid: !unresolved.length,
      members: members.map((node) => node.id),
      unresolvedMembers: unresolved.map((member) => ({
        nodeId: member.nodeId,
        label: member.label,
      })),
    });
    for (const member of unresolved)
      notices.push({
        message: `${feature.title} · ${member.label}: 기능의 코드 연결이 없거나 모호합니다. 기능 묶음에서 대상을 다시 선택해 주세요.`,
      });
  }
  return {
    ...base,
    nodes,
    notices,
    revision: await sha256(base.revision + JSON.stringify(features)),
  };
}
