import { memo, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { StructureGraph, StructureNode } from "./model";

type CardData = {
  label: string;
  kind: string;
  detail: string;
  selected: boolean;
  children: number;
};
type Card = Node<CardData, "structure">;
const labels: Record<string, string> = {
  group: "모듈 묶음",
  file: "구현 파일",
  symbol: "기능·선언",
  rule: "조건·규칙",
  system: "시스템",
};
const StructureCard = memo(function StructureCard({ data }: NodeProps<Card>) {
  return (
    <div className={`structure-card ${data.selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="structure-card-kind">{labels[data.kind]}</span>
      <strong title={data.label}>{data.label}</strong>
      <span className="structure-card-detail">{data.detail}</span>
      {data.children > 0 ? (
        <span className="structure-card-count">
          {data.children}개 하위 구조 ↗
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { structure: StructureCard };

export function StructureCanvas({
  graph,
  scopeId,
  selectedId,
  onSelect,
  onEnter,
  onConnection,
}: {
  graph: StructureGraph;
  scopeId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
  onConnection: (ids: string[]) => void;
}) {
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const layout = useMemo(() => {
    const children = graph.nodes.filter((node) => node.parentId === scopeId);
    const visible = children.length
      ? children
      : graph.nodes.filter((node) => node.id === scopeId);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const visibleIds = new Set(visible.map((node) => node.id));
    const ancestor = (id: string): string | undefined => {
      let node = byId.get(id);
      while (node) {
        if (visibleIds.has(node.id)) return node.id;
        node = node.parentId ? byId.get(node.parentId) : undefined;
      }
      return undefined;
    };
    const connections = new Map<
      string,
      {
        id: string;
        source: string;
        target: string;
        label: string;
        data: { originals: string[] };
        count: number;
      }
    >();
    for (const edge of graph.edges) {
      const source = ancestor(edge.source),
        target = ancestor(edge.target);
      if (!source || !target || source === target) continue;
      const key = `${source}|${target}`;
      const previous = connections.get(key);
      if (previous) {
        previous.data.originals.push(edge.id);
        previous.count++;
        previous.label = `${previous.count}개 연결`;
      } else
        connections.set(key, {
          id: edge.id,
          source,
          target,
          label:
            edge.kind === "imports"
              ? "모듈 연결"
              : edge.kind === "calls"
                ? "호출"
                : "화면 구성",
          data: { originals: [edge.id] },
          count: 1,
        });
    }
    const layoutGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(
      () => ({}),
    );
    layoutGraph.setGraph({
      rankdir: "LR",
      nodesep: 30,
      ranksep: 75,
      marginx: 30,
      marginy: 30,
    });
    for (const node of visible)
      layoutGraph.setNode(node.id, { width: 220, height: 116 });
    for (const edge of connections.values())
      layoutGraph.setEdge(edge.source, edge.target);
    dagre.layout(layoutGraph);
    return { visible, edges: [...connections.values()], layoutGraph };
  }, [graph, scopeId]);
  const nodes: Card[] = layout.visible.map((node: StructureNode) => ({
    id: node.id,
    type: "structure",
    width: 220,
    height: 116,
    position: positions[`${scopeId}:${node.id}`] ?? {
      x: layout.layoutGraph.node(node.id).x - 110,
      y: layout.layoutGraph.node(node.id).y - 58,
    },
    data: {
      label: node.label,
      kind: node.kind,
      detail: node.sources[0]
        ? `${node.sources[0].path} · L${node.sources[0].line}`
        : "코드 경로에서 추출",
      selected: selectedId === node.id,
      children: graph.nodes.filter((child) => child.parentId === node.id)
        .length,
    },
    ariaLabel: `${labels[node.kind]} ${node.label}`,
    selected: selectedId === node.id,
  }));
  const updatePositions = (changes: NodeChange<Card>[]) =>
    setPositions((current) => {
      if (
        !changes.some((change) => change.type === "position" && change.position)
      )
        return current;
      const next = { ...current };
      for (const change of changes)
        if (change.type === "position" && change.position)
          next[`${scopeId}:${change.id}`] = change.position;
      return next;
    });
  return (
    <ReactFlow<Card>
      key={scopeId}
      nodes={nodes}
      edges={layout.edges}
      nodeTypes={nodeTypes}
      onNodesChange={updatePositions}
      onNodeClick={(_, node) => onSelect(node.id)}
      onNodeDoubleClick={(_, node) => onEnter(node.id)}
      onEdgeClick={(_, edge) => onConnection(edge.data!.originals as string[])}
      nodesConnectable={false}
      edgesReconnectable={false}
      deleteKeyCode={null}
      fitView
      minZoom={0.2}
      maxZoom={1.5}
      defaultEdgeOptions={{ type: "smoothstep", selectable: true }}
    >
      <Background gap={22} size={1} color="var(--design-grid)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
