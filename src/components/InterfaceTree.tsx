import { useState } from "react";
import type { FileAnalysis, InterfaceNode, Lang, Rule } from "../core/types";
import "./InterfaceTree.css";

type Props = {
  analysis: FileAnalysis;
  lang: Lang;
  onSource: (line: number) => void;
  onEdit: (rule: Rule) => void;
};
function Branch({
  node,
  depth,
  rules,
  lang,
  onSource,
  onEdit,
  valid,
}: {
  node: InterfaceNode;
  depth: number;
  rules: Rule[];
  lang: Lang;
  onSource: Props["onSource"];
  onEdit: Props["onEdit"];
  valid: boolean;
}) {
  const [open, setOpen] = useState(depth < 2);
  const rule = node.ruleId
    ? rules.find((r) => r.id === node.ruleId)
    : undefined;
  const ko = lang === "ko";
  return (
    <li className={`interface-node interface-${node.kind}`}>
      <div className="interface-row">
        {node.children.length > 0 ? (
          <button
            className="interface-expand"
            aria-expanded={open}
            aria-label={`${open ? (ko ? "접기" : "Collapse") : ko ? "펼치기" : "Expand"}: ${node.title[lang]}`}
            onClick={() => setOpen(!open)}
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="interface-dot" aria-hidden="true">
            ·
          </span>
        )}
        <div className="interface-content">
          <strong>{node.title[lang]}</strong>
          {node.code && <code>{node.code}</code>}
          {node.detail && <p>{node.detail[lang]}</p>}
        </div>
        <div className="interface-actions">
          {rule && (
            <button
              className="text-button"
              disabled={!valid}
              onClick={() => onEdit(rule)}
              aria-label={`${ko ? "바꾸기" : "Edit"}: ${node.title[lang]}`}
            >
              {ko ? "바꾸기" : "Edit"}
            </button>
          )}
          <button
            className="line-link"
            onClick={() => onSource(node.line)}
            aria-label={`${ko ? "원문" : "Source"} L${node.line}`}
          >
            L{node.line}
          </button>
        </div>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              depth={depth + 1}
              rules={rules}
              lang={lang}
              onSource={onSource}
              onEdit={onEdit}
              valid={valid}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function InterfaceTree({ analysis, lang, onSource, onEdit }: Props) {
  if (!analysis.interface?.roots.length) return null;
  const ko = lang === "ko";
  return (
    <section
      className="card interface-card"
      aria-label={ko ? "화면 코드 읽기" : "Read interface code"}
    >
      <header>
        <span className="eyebrow">READ THE INTERFACE</span>
        <h3>
          {ko
            ? "이 화면에는 무엇이 들어갈까요?"
            : "What goes into this interface?"}
        </h3>
        <p>
          {ko
            ? "코드에 적힌 요소·문구·조건을 펼쳐 보세요. 문구 옆 ‘바꾸기’에서 실제 코드의 변경안을 만듭니다."
            : "Explore elements, text and conditions in the source. Use Edit beside a phrase to prepare a real code change."}
        </p>
      </header>
      <div className="interface-key">
        <span>
          {ko
            ? "문구 → 변경안 → 적용 → 되돌리기"
            : "Text → preview → apply → undo"}
        </span>
        <small>
          {ko
            ? "실행 화면이 아닌 소스 구조입니다"
            : "Source structure, not a rendered preview"}
        </small>
      </div>
      <ul className="interface-roots">
        {analysis.interface.roots.map((node) => (
          <Branch
            key={node.id}
            node={node}
            depth={0}
            rules={analysis.rules}
            lang={lang}
            onSource={onSource}
            onEdit={onEdit}
            valid={analysis.syntaxValid}
          />
        ))}
      </ul>
      {analysis.interface.truncated && (
        <p role="status" className="interface-limit">
          {ko
            ? "표시 한도에 도달했습니다. 생략된 요소와 더 깊은 구조는 원문에서 확인하세요."
            : "Display limit reached. See source for omitted elements and deeper nesting."}
        </p>
      )}
      <p className="interface-note">
        {ko
          ? "소스에 등장하는 화면 조각입니다. 모두 동시에 표시된다는 뜻은 아닙니다. CSS·컴포넌트 내부·데이터·실행 순서는 실제 앱에서 확인해야 합니다. 프로젝트 코드를 실행하지 않습니다."
          : "These are fragments found in source; they may not appear together. CSS, component internals, data and execution order require checking the running app. Project code is never executed."}
      </p>
    </section>
  );
}
