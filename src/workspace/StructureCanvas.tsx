import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import {
  structureChildren,
  structureConnections,
  type StructureGraph,
  type StructureNode,
} from "./model";
import type { CanvasLocation } from "./navigation";

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
  feature: "업무 기능 · 사용자 정의",
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
  location,
  onLocation,
}: {
  graph: StructureGraph;
  scopeId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
  onConnection: (ids: string[]) => void;
  location?: CanvasLocation;
  onLocation: (location: CanvasLocation) => void;
}) {
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >(() =>
    Object.fromEntries(
      (location?.positions ?? []).map((position) => [
        position.id,
        { x: position.x, y: position.y },
      ]),
    ),
  );
  const positionsRef = useRef(positions);
  const viewportRef = useRef<Viewport | undefined>(location?.viewport);
  const locationFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (locationFrame.current !== null)
        cancelAnimationFrame(locationFrame.current);
    },
    [],
  );
  const persistLocation = () => {
    if (locationFrame.current !== null) return;
    // Automatic fit can end inside React Flow's ResizeObserver. Updating the
    // parent external store synchronously there can re-enter layout delivery.
    // Publish the latest geometry in the next frame, and cancel on scope exit.
    locationFrame.current = requestAnimationFrame(() => {
      locationFrame.current = null;
      onLocation({
        scopeId,
        viewport: viewportRef.current,
        positions: Object.entries(positionsRef.current).map(
          ([id, position]) => ({
            id,
            ...position,
          }),
        ),
      });
    });
  };
  const layout = useMemo(() => {
    const children = structureChildren(graph, scopeId);
    const visible = children.length
      ? children
      : graph.nodes.filter((node) => node.id === scopeId);
    const connections = structureConnections(graph, visible);
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
    for (const edge of connections)
      layoutGraph.setEdge(edge.source, edge.target);
    dagre.layout(layoutGraph);
    return { visible, edges: connections, layoutGraph };
  }, [graph, scopeId]);
  const nodes: Card[] = layout.visible.map((node: StructureNode) => ({
    id: node.id,
    type: "structure",
    width: 220,
    height: 116,
    position: positions[node.id] ?? {
      x: layout.layoutGraph.node(node.id).x - 110,
      y: layout.layoutGraph.node(node.id).y - 58,
    },
    data: {
      label: node.label,
      kind: node.kind,
      detail:
        node.kind === "feature"
          ? `${node.members?.length ?? 0}개 코드 연결 · ${node.unresolvedMembers?.length ?? 0}개 재연결 필요`
          : node.sources[0]
            ? `${node.sources[0].path} · L${node.sources[0].line}`
            : "코드 경로에서 추출",
      selected: selectedId === node.id,
      children: structureChildren(graph, node.id).length,
    },
    ariaLabel: `${labels[node.kind]} ${node.label}`,
    selected: selectedId === node.id,
  }));
  const updatePositions = (changes: NodeChange<Card>[]) => {
    if (
      !changes.some((change) => change.type === "position" && change.position)
    )
      return;
    const next = { ...positionsRef.current };
    for (const change of changes)
      if (change.type === "position" && change.position)
        next[change.id] = change.position;
    positionsRef.current = next;
    setPositions(next);
    // React Flow also emits completed position changes for arrow-key movement.
    // Persist those as well as pointer drags, without writing each drag frame.
    if (
      changes.some(
        (change) =>
          change.type === "position" && change.position && !change.dragging,
      )
    )
      persistLocation();
  };
  return (
    <ReactFlow<Card>
      key={scopeId}
      nodes={nodes}
      edges={layout.edges}
      nodeTypes={nodeTypes}
      onNodesChange={updatePositions}
      onMoveEnd={(_, viewport) => {
        viewportRef.current = viewport;
        persistLocation();
      }}
      onNodeClick={(_, node) => onSelect(node.id)}
      onNodeDoubleClick={(_, node) => onEnter(node.id)}
      onEdgeClick={(_, edge) => onConnection(edge.data!.originals as string[])}
      nodesConnectable={false}
      edgesReconnectable={false}
      deleteKeyCode={null}
      defaultViewport={location?.viewport}
      fitView={!location?.viewport}
      minZoom={0.2}
      maxZoom={1.5}
      defaultEdgeOptions={{ type: "smoothstep", selectable: true }}
    >
      <Background gap={22} size={1} color="var(--design-grid)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
