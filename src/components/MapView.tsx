import { useMemo } from "react";
import type { FileAnalysis, Lang } from "../core/types";
import { Icon } from "./Icon";
export function MapView({
  files,
  lang,
  onSelect,
}: {
  files: FileAnalysis[];
  lang: Lang;
  onSelect: (p: string) => void;
}) {
  const ko = lang === "ko";
  const graph = useMemo(() => {
    const visible = files.filter((f) => f.kind === "script").slice(0, 40);
    const referenced = new Set(
      visible.flatMap((f) => f.imports.map((i) => i.target).filter(Boolean)),
    );
    const roots = visible.filter((f) => !referenced.has(f.path));
    const levels = new Map<string, number>();
    let frontier = roots.length ? roots : [visible[0]].filter(Boolean);
    let level = 0;
    while (frontier.length && level < 6) {
      const next: FileAnalysis[] = [];
      for (const f of frontier) {
        if (levels.has(f.path)) continue;
        levels.set(f.path, level);
        for (const im of f.imports) {
          const target = visible.find((v) => v.path === im.target);
          if (target && !levels.has(target.path)) next.push(target);
        }
      }
      frontier = next;
      level++;
    }
    for (const f of visible) if (!levels.has(f.path)) levels.set(f.path, 0);
    const rows = new Map<number, number>();
    const nodes = visible.map((f) => {
      const col = levels.get(f.path)!;
      const row = rows.get(col) || 0;
      rows.set(col, row + 1);
      return { file: f, x: 28 + col * 265, y: 30 + row * 112 };
    });
    return {
      nodes,
      width: Math.max(780, ...nodes.map((n) => n.x + 245)),
      height: Math.max(320, ...nodes.map((n) => n.y + 100)),
    };
  }, [files]);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">CONNECT THE DOTS</span>
          <h2>
            {ko ? "파일 사이의 연결을 한눈에" : "See how the files connect"}
          </h2>
        </div>
        <span className="tag">IMPORT MAP</span>
      </div>
      <p className="section-description">
        {ko
          ? "화살표는 “이 파일이 저 파일을 가져온다”는 뜻이에요. 파일을 누르면 설명으로 이동합니다."
          : "An arrow means this file imports the other file. Select a file to read its story."}
      </p>
      <div className="card graph">
        <svg
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          style={{
            minWidth: Math.min(graph.width, 1000),
            minHeight: graph.height,
          }}
          role="group"
          aria-label={ko ? "파일 의존성 지도" : "File dependency map"}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8" fill="#87a5a0" />
            </marker>
            <pattern
              id="dots"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="#dde5e1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
          {graph.nodes.flatMap((n) =>
            n.file.imports.map((im, i) => {
              const target = graph.nodes.find((x) => x.file.path === im.target);
              if (!target) return null;
              return (
                <path
                  key={n.file.path + i}
                  d={`M ${n.x + 220} ${n.y + 37} C ${n.x + 245} ${n.y + 37},${target.x - 25} ${target.y + 37},${target.x} ${target.y + 37}`}
                  stroke="#87a5a0"
                  strokeWidth="1.6"
                  fill="none"
                  markerEnd="url(#arrowhead)"
                />
              );
            }),
          )}
          {graph.nodes.map((n, i) => (
            <g
              key={n.file.path}
              role="button"
              tabIndex={0}
              aria-label={n.file.path}
              onClick={() => onSelect(n.file.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(n.file.path);
                }
              }}
              className="graph-node"
            >
              <rect
                x={n.x}
                y={n.y}
                width="220"
                height="76"
                rx="12"
                fill={i === 0 ? "#e7f4ef" : "white"}
                stroke={i === 0 ? "#78b4a0" : "#d9e2dd"}
              />
              <rect
                x={n.x + 14}
                y={n.y + 17}
                width="34"
                height="34"
                rx="8"
                fill={i === 0 ? "#167c68" : "#edf1ee"}
              />
              <text
                x={n.x + 31}
                y={n.y + 39}
                textAnchor="middle"
                fill={i === 0 ? "white" : "#6b8178"}
                fontSize="11"
                fontWeight="700"
              >
                {n.file.path.split(".").pop()?.toUpperCase()}
              </text>
              <text
                x={n.x + 59}
                y={n.y + 31}
                fill="#25372f"
                fontSize="13"
                fontWeight="600"
              >
                {n.file.path.split("/").pop()?.slice(0, 21)}
              </text>
              <text x={n.x + 59} y={n.y + 51} fill="#78857e" fontSize="11">
                {n.file.functions.length} {ko ? "개 기능" : "functions"} ·{" "}
                {n.file.rules.length} {ko ? "개 규칙" : "rules"}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="footnote">
        {ko
          ? "연결 지도는 실행 순서가 아닙니다. 상대 경로 import/export만 연결하며 동적 import, require, 경로 별칭은 해석하지 않습니다. 그래프는 최대 40개 파일, 아래 표는 전체를 보여줍니다."
          : "This is not execution order. Only relative import/export paths are linked; dynamic imports, require and aliases are unresolved. The graph shows up to 40 files; the table lists all imports."}
      </p>
      <section className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{ko ? "가져오는 파일" : "From"}</th>
                <th>{ko ? "연결 대상" : "To"}</th>
                <th>{ko ? "연결 상태" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {files.flatMap((f) =>
                f.imports.map((im, i) => (
                  <tr key={f.path + i}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => onSelect(f.path)}
                      >
                        {f.path}
                      </button>
                    </td>
                    <td className="mono">{im.target || im.source}</td>
                    <td>
                      <span className={"tag " + (!im.target ? "amber" : "")}>
                        {im.target
                          ? ko
                            ? "연결 확인"
                            : "Resolved"
                          : im.external
                            ? ko
                              ? "외부 / 별칭"
                              : "External / alias"
                            : ko
                              ? "파일 미확인"
                              : "Unresolved"}
                      </span>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          {!files.some((f) => f.imports.length) && (
            <p className="empty">
              {ko ? "직접 연결된 파일이 없습니다." : "No static imports found."}
            </p>
          )}
        </div>
      </section>
      <div className="hint-card">
        <Icon name="info" />
        <span>
          {ko
            ? "한 파일의 규칙을 바꾸면, 이 파일을 가져오는 다른 기능의 결과도 달라질 수 있어요."
            : "Changing a rule can affect functions in other files that import it."}
        </span>
      </div>
    </>
  );
}
