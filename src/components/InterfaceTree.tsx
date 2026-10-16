import { useState } from "react";
import type { FileAnalysis, InterfaceNode, Lang, Rule } from "../core/types";
import "./InterfaceTree.css";

type Props = {
  analysis: FileAnalysis;
  lang: Lang;
  onSource: (line: number) => void;
  onEdit: (rule: Rule) => void;
  editDisabled?: boolean;
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

export function InterfaceTree({
  analysis,
  lang,
  onSource,
  onEdit,
  editDisabled = false,
}: Props) {
  if (!analysis.interface?.roots.length) return null;
  const ko = lang === "ko";
  const web = analysis.web?.language;
  return (
    <section
      className="card interface-card"
      aria-label={ko ? "화면 코드 읽기" : "Read interface code"}
    >
      <header>
        <span className="eyebrow">READ THE INTERFACE</span>
        <h3>
          {web
            ? ko
              ? `${web.toUpperCase()} 원문 구조`
              : `${web.toUpperCase()} source structure`
            : ko
              ? "이 화면에는 무엇이 들어갈까요?"
              : "What goes into this interface?"}
        </h3>
        <p>
          {web
            ? ko
              ? "파서가 읽은 원문 항목입니다. 값 옆 ‘바꾸기’에서 변경안을 만들고 원문 위치로 이동할 수 있습니다."
              : "Source entries read by a parser. Use Edit to prepare a value change or jump to its source location."
            : ko
              ? "코드에 적힌 요소·문구·조건을 펼쳐 보세요. 문구 옆 ‘바꾸기’에서 실제 코드의 변경안을 만듭니다."
              : "Explore elements, text and conditions in the source. Use Edit beside a phrase to prepare a real code change."}
        </p>
      </header>
      <div className="interface-key">
        <span>
          {ko
            ? "값 → 변경안 → 적용 → 되돌리기"
            : "Value → preview → apply → undo"}
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
            valid={analysis.syntaxValid && !editDisabled}
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
        {web === "css"
          ? ko
            ? "선택자·조건·속성값을 원문 그대로 읽습니다. 최종 적용값, 열 개수, 브라우저 지원, 스타일 우선순위와 성능은 실제 페이지에서 확인해야 합니다. 외부 리소스는 불러오지 않습니다."
            : "Selectors, conditions and values retain their source spelling. Computed values, column counts, browser support, cascade and performance require checking the actual page. External resources are not loaded."
          : web === "html"
            ? ko
              ? "HTML 파서가 보정한 구조입니다. 원문에 없는 html/head/body 래퍼는 생략하며, 문구가 보인다는 보장은 없습니다. 스크립트·CSS·템플릿은 실행하거나 상세 해석하지 않습니다."
              : "This is the HTML parser's recovered structure; implicit html/head/body wrappers are omitted. Text is not guaranteed visible. Scripts, CSS and templates are not executed or interpreted in detail."
            : ko
              ? "소스에 등장하는 화면 조각입니다. 모두 동시에 표시된다는 뜻은 아닙니다. CSS·컴포넌트 내부·데이터·실행 순서는 실제 앱에서 확인해야 합니다. 프로젝트 코드를 실행하지 않습니다."
              : "These are fragments found in source; they may not appear together. CSS, component internals, data and execution order require checking the running app. Project code is never executed."}
      </p>
    </section>
  );
}
