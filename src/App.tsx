import { useEffect, useMemo, useRef, useState } from "react";
import { demo } from "./demo";
import { interfaceDemo } from "./interfaceDemo";
import { request } from "./client";
import { loadWorkspace, saveWorkspace } from "./storage";
import { readFiles } from "./core/import";
import { operators } from "./core/labels";
import type {
  Lang,
  Patch,
  ProjectAnalysis,
  Rule,
  SourceFile,
} from "./core/types";
import { Icon } from "./components/Icon";
import { Story } from "./components/Story";
import { MapView } from "./components/MapView";
import { Simulator } from "./components/Simulator";
import { Modal } from "./components/Modal";
import { Research } from "./components/Research";
import { ScenarioLab } from "./components/ScenarioLab";
import { Terminology } from "./components/Terminology";
import { ProductHelp } from "./components/ProductHelp";
import { productResource, productVersion } from "./product";
import { storyLines } from "./core/storyReport";
import { updateGlossary, type GlossaryEntry } from "./core/glossary";
import type { ScenarioReport } from "./core/scenarioModel";
const demoKind = new URLSearchParams(location.search).get("demo");
const demoMode = demoKind === "shipping" || demoKind === "interface";
const initialFiles = demoKind === "interface" ? interfaceDemo : demo;
type View = "story" | "map" | "rules" | "checks" | "research";
type History = { patch: Patch; date: string };
export default function App() {
  const [lang, setLang] = useState<Lang>(
      new URLSearchParams(location.search).get("lang") === "en" ? "en" : "ko",
    ),
    [files, setFiles] = useState<SourceFile[]>(initialFiles),
    [glossary, setGlossary] = useState<GlossaryEntry[]>([]),
    [ready, setReady] = useState(false),
    [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null),
    [busy, setBusy] = useState(true),
    [selected, setSelected] = useState(initialFiles[0].path),
    [view, setView] = useState<View>("story"),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saveState, setSaveState] = useState(""),
    [history, setHistory] = useState<History[]>([]),
    [patch, setPatch] = useState<Patch | null>(null),
    [selectedRule, setSelectedRule] = useState<{
      path: string;
      id: string;
    } | null>(null),
    [draft, setDraft] = useState(""),
    [editMode, setEditMode] = useState<"direct" | "sentence">("sentence"),
    [sentence, setSentence] = useState(""),
    [editing, setEditing] = useState(false),
    [sourceLine, setSourceLine] = useState<number | null>(null),
    [simulation, setSimulation] = useState<string | null>(null),
    [modal, setModal] = useState<
      "history" | "reset" | "import" | "help" | null
    >(null),
    [importedSkipped, setImportedSkipped] = useState<string[]>([]),
    [projectTitle, setProjectTitle] = useState(
      demoKind === "interface" ? "멤버십 화면" : "작은 상점",
    ),
    [exporting, setExporting] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    sourceFocus = useRef<HTMLDivElement>(null),
    editorRef = useRef<HTMLElement>(null);
  const generation = useRef(0),
    saveRevision = useRef(0);
  const ko = lang === "ko";
  const t = (a: string, b: string) => (ko ? a : b);
  useEffect(() => {
    if (demoMode) {
      setReady(true);
      return;
    }
    let active = true;
    loadWorkspace()
      .then((saved) => {
        if (active && saved?.files.length) {
          setFiles(saved.files);
          setGlossary(saved.glossary);
          setSelected(saved.files[0].path);
          setProjectTitle(saved.name);
        }
      })
      .catch(() => {
        if (active)
          setNotice(
            "브라우저 저장소를 사용할 수 없습니다. 파일 내보내기를 이용하세요. / Browser storage unavailable.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (!ready) return;
    const token = ++generation.current;
    setBusy(true);
    request<ProjectAnalysis>("analyze", { files, glossary })
      .then((a) => {
        if (token === generation.current) {
          setAnalysis(a);
          setBusy(false);
        }
      })
      .catch((e) => {
        if (token === generation.current) {
          setError(e.message);
          setBusy(false);
        }
      });
  }, [files, glossary, ready]);
  useEffect(() => {
    if (!ready || demoMode) return;
    const rev = ++saveRevision.current;
    setSaveState("saving");
    const timer = setTimeout(
      () =>
        saveWorkspace(files, projectTitle, glossary)
          .then(() => {
            if (rev === saveRevision.current) setSaveState("saved");
          })
          .catch(() => {
            if (rev === saveRevision.current) setSaveState("failed");
          }),
      400,
    );
    return () => clearTimeout(timer);
  }, [files, glossary, ready, projectTitle]);
  useEffect(() => {
    if (sourceLine !== null)
      sourceFocus.current?.scrollIntoView({ block: "center" });
  }, [sourceLine]);
  const active = analysis?.files.find((f) => f.path === selected);
  const file = files.find((f) => f.path === selected) || files[0];
  const allRules =
    analysis?.files.flatMap((f) =>
      f.rules.map((rule) => ({ path: f.path, rule })),
    ) || [];
  const allIssues =
    analysis?.files.flatMap((f) =>
      f.issues.map((issue) => ({ path: f.path, issue })),
    ) || [];
  const editRule = allRules.find(
    (x) => x.path === selectedRule?.path && x.rule.id === selectedRule.id,
  );
  const functions =
    analysis?.files.reduce((n, f) => n + f.functions.length, 0) || 0;
  const dependencies = useMemo(() => {
    if (!patch || !analysis) return [];
    const visited = new Set([patch.path]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of analysis.files)
        if (
          !visited.has(f.path) &&
          f.imports.some((i) => i.target && visited.has(i.target))
        ) {
          visited.add(f.path);
          changed = true;
        }
    }
    return [...visited].filter((p) => p !== patch.path);
  }, [patch, analysis]);
  function selectFile(path: string) {
    setSelected(path);
    setView("story");
    setPatch(null);
    setSelectedRule(null);
    setError("");
    setSimulation(null);
  }
  function selectRule(path: string, r: Rule) {
    setSelectedRule({ path, id: r.id });
    setDraft(String(r.value));
    setEditMode("direct");
    setPatch(null);
    setError("");
    if (window.innerWidth <= 1000)
      editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  async function stage() {
    const revision = generation.current;
    setError("");
    setPatch(null);
    setEditing(true);
    try {
      let result: Patch;
      if (editMode === "direct" && editRule) {
        const target = files.find((f) => f.path === editRule.path)!;
        result = await request<Patch>("patch", {
          file: target,
          ruleId: editRule.rule.id,
          value: draft,
          glossary,
        });
      } else if (editMode === "sentence") {
        result = await request<Patch>("request", {
          file,
          request: sentence,
          glossary,
        });
      } else
        throw Error(
          t(
            "먼저 표에서 바꿀 규칙을 선택해 주세요.",
            "Choose a rule in the table first.",
          ),
        );
      if (revision === generation.current) setPatch(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditing(false);
    }
  }
  async function saveTerm(id: string, label: string) {
    if (busy || editing || !active?.terms?.some((term) => term.id === id))
      throw Error(
        t(
          "최신 설명에서 다시 시도해 주세요.",
          "Try again from the latest explanation.",
        ),
      );
    const next = updateGlossary(glossary, active.path, id, lang, label);
    generation.current++;
    setGlossary(next);
    setPatch(null);
    setSelectedRule(null);
    setSimulation(null);
    setError("");
    setNotice(
      t(
        "내 용어를 설명에 반영했습니다. 원본 코드 이름은 유지됩니다.",
        "Your term is now used in explanations. Source names are unchanged.",
      ),
    );
  }
  function apply() {
    if (!patch) return;
    const current = files.find((f) => f.path === patch.path);
    if (!current || current.content !== patch.original) {
      setError(
        t(
          "파일이 변경되었습니다. 미리보기를 다시 만들어 주세요.",
          "File changed. Generate a new preview.",
        ),
      );
      return;
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.path === patch.path ? { ...f, content: patch.updated } : f,
      ),
    );
    setHistory((h) => [
      ...h,
      {
        patch,
        date: new Date().toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
    setNotice(
      t(
        "변경을 적용했습니다. 설명과 연결 지도를 새로 확인하고 있어요.",
        "Change applied. Refreshing explanations and connections.",
      ),
    );
    setPatch(null);
    setSelectedRule(null);
    setSentence("");
  }
  function undo() {
    const h = history.at(-1);
    if (!h) return;
    const current = files.find((f) => f.path === h.patch.path);
    if (current?.content !== h.patch.updated) {
      setError(
        t(
          "파일 상태가 달라 되돌릴 수 없습니다.",
          "Cannot undo: the file has changed.",
        ),
      );
      return;
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.path === h.patch.path ? { ...f, content: h.patch.original } : f,
      ),
    );
    setHistory((prev) => prev.slice(0, -1));
    setPatch(null);
    setSelectedRule(null);
    setNotice(t("마지막 변경을 되돌렸습니다.", "Undid the last change."));
  }
  async function importFiles(input: File[]) {
    if (!input.length) return;
    setError("");
    setNotice(t("파일을 읽고 있습니다…", "Reading files…"));
    try {
      const result = await readFiles(input);
      if (!result.files.length)
        throw Error(
          t(
            "읽을 수 있는 파일이 없습니다. JS, TS, JSON 또는 텍스트 파일을 선택하세요.",
            "No readable files found. Choose JS, TS, JSON or text files.",
          ),
        );
      setFiles(result.files);
      setGlossary([]);
      setSelected(result.files[0].path);
      setView("story");
      setProjectTitle(
        input[0].webkitRelativePath.split("/")[0] || input[0].name,
      );
      setHistory([]);
      setPatch(null);
      setSelectedRule(null);
      setImportedSkipped(result.skipped);
      setNotice(
        t(
          `${result.files.length}개 파일을 불러왔습니다. ${result.skipped.length}개 제외.`,
          `${result.files.length} files loaded; ${result.skipped.length} skipped.`,
        ),
      );
      if (result.skipped.length) setModal("import");
    } catch (e) {
      setError(String(e));
    }
  }
  async function download() {
    setExporting(true);
    setError("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.path, f.content));
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      saveBlob(blob, "pureobom-files.zip");
      setNotice(
        t(
          "가져온 텍스트 파일을 내보냈습니다. 제외된 파일은 포함되지 않습니다.",
          "Exported imported text files only; skipped files are not included.",
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }
  function report() {
    if (!analysis) return;
    const lines = [
      `# ${projectTitle} · ${t("코드 설명", "Code explanation")}`,
      "",
      t(
        "정적 구문 분석 결과입니다. 실제 동작이나 보안을 보장하지 않습니다.",
        "Static syntax analysis; not a guarantee of behavior or security.",
      ),
      "",
      t(
        "이름에는 사용자가 지정한 프로젝트 용어가 포함될 수 있습니다. 작성자의 의도를 검증한 결과는 아닙니다.",
        "Names may include user-defined project terms, not verified author intent.",
      ),
      "",
    ];
    for (const f of analysis.files) {
      lines.push(
        `## ${f.path}`,
        `${f.lines} lines · ${f.functions.length} functions`,
        "",
      );
      for (const fn of f.functions) {
        lines.push(
          `### ${fn.label[lang]} (${fn.name})`,
          `${t("입력", "Inputs")}: ${fn.params.map((p) => p.name + ": " + p.type).join(", ")}`,
        );
        lines.push(...storyLines(fn.steps, lang));
        lines.push("");
      }
      for (const r of f.rules)
        lines.push(`- L${r.line} ${r.label[lang]}: ${r.raw}`);
      for (const i of f.issues)
        lines.push(
          `- [${i.level}] L${i.line} ${i.title[lang]} — ${i.detail[lang]}`,
        );
      lines.push("");
    }
    saveBlob(
      new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
      "pureobom-report.md",
    );
  }
  function reset() {
    setFiles(demo.map((f) => ({ ...f })));
    setGlossary([]);
    setSelected(demo[0].path);
    setProjectTitle("작은 상점");
    setHistory([]);
    setPatch(null);
    setSelectedRule(null);
    setModal(null);
    setView("story");
    setNotice(
      t("예제 프로젝트를 불러왔습니다.", "Loaded the example project."),
    );
  }
  const nav: { id: View; icon: string; ko: string; en: string }[] = [
    { id: "story", icon: "book", ko: "이야기로 읽기", en: "Read the story" },
    { id: "map", icon: "map", ko: "연결 지도", en: "Connection map" },
    { id: "rules", icon: "table", ko: "데이터와 규칙", en: "Data & rules" },
    { id: "checks", icon: "check", ko: "점검할 곳", en: "Review points" },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("story");
          }}
          aria-label="풀어봄 홈"
        >
          <img src="./favicon.svg" alt="" />
          <span>
            풀어봄<small>MAKE CODE MAKE SENSE</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span className="beta">PREVIEW {productVersion}</span>
        </div>
        <button className="workspace-select" onClick={() => setModal("reset")}>
          <span className="project-avatar">
            <Icon name="folder" />
          </span>
          <span>
            {projectTitle}
            <small>{t("브라우저 작업 공간", "Browser workspace")}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <nav aria-label={t("주 메뉴", "Main navigation")}>
          {nav.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (view === n.id ? "active" : "")}
              onClick={() => setView(n.id)}
              aria-current={view === n.id ? "page" : undefined}
            >
              <Icon name={n.icon} />
              <span>{ko ? n.ko : n.en}</span>
              {n.id === "checks" && allIssues.length > 0 && (
                <b className="count">{allIssues.length}</b>
              )}
              {view === n.id && n.id !== "checks" && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="file-section">
          <div className="sidebar-section-title">
            {t("프로젝트 파일", "PROJECT FILES")} <span>{files.length}</span>
            <button
              className="sidebar-icon"
              title={t("파일 추가 대신 새 프로젝트 열기", "Open a project")}
              aria-label={t("파일 열기", "Open files")}
              onClick={() => fileInput.current?.click()}
              disabled={!ready}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          <label className="file-search">
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("파일 이름 찾기", "Find a file")}
              aria-label={t("파일 검색", "Search files")}
            />
          </label>
          <div className="file-list">
            {files
              .filter((f) =>
                f.path.toLowerCase().includes(search.toLowerCase()),
              )
              .map((f) => (
                <button
                  title={f.path}
                  className={
                    "file-item " + (f.path === selected ? "selected" : "")
                  }
                  key={f.path}
                  onClick={() => selectFile(f.path)}
                >
                  <span
                    className={
                      "file-type " + (/\.json$/.test(f.path) ? "json" : "")
                    }
                  >
                    {f.path.split(".").pop()?.slice(0, 3).toUpperCase()}
                  </span>
                  <span>
                    {f.path.split("/").pop()}
                    <small>
                      {f.path.split("/").slice(0, -1).join("/") || "/"}
                    </small>
                  </span>
                  {history.some((h) => h.patch.path === f.path) && <i />}
                </button>
              ))}
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className={"nav-item " + (view === "research" ? "active" : "")}
            onClick={() => setView("research")}
          >
            <Icon name="spark" />
            <span>{t("설계와 선행 연구", "Design & research")}</span>
            <Icon name="external" size={14} />
          </button>
          <div className="privacy">
            <Icon name="lock" size={16} />
            <div>
              {t("내 기기 안에서만", "Stays on your device")}
              <small>{t("코드 외부 전송 없음", "No code uploaded")}</small>
            </div>
            <span className="status-dot" />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t("내 프로젝트", "My projects")}</span>
            <Icon name="chevron" size={13} />
            <strong>{projectTitle}</strong>
          </div>
          <div className="topbar-actions">
            <button className="button" onClick={() => setModal("help")}>
              {t("설치·피드백", "Install & feedback")}
            </button>
            <span className="save-indicator">
              <span
                className={
                  "status-dot " + (saveState === "failed" ? "warning" : "")
                }
              />
              {busy
                ? t("분석 중", "Analyzing")
                : demoMode
                  ? t("체험 모드 · 저장 안 함", "Demo · not saved")
                  : saveState === "saved"
                    ? t("기기에 저장됨", "Saved locally")
                    : saveState === "failed"
                      ? t(
                          "저장 실패 · 내보내기 필요",
                          "Save failed; export needed",
                        )
                      : t("저장 중", "Saving")}
            </span>
            <label className="language-select">
              <Icon name="globe" size={15} />
              <select
                aria-label="설명 언어 / Language"
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </label>
            <button
              className="button dark"
              onClick={download}
              disabled={!ready || exporting}
            >
              <Icon name="download" size={16} />
              {exporting ? "…" : t("파일 내보내기", "Export files")}
            </button>
          </div>
        </header>
        <main>
          {demoMode && history.length > 0 && (
            <section
              className="product-next-step"
              aria-label={t("체험 다음 단계", "After the demo")}
            >
              <div>
                <strong>
                  {t(
                    "첫 변경을 해봤어요. 이제 내 코드로 가볼까요?",
                    "You made a change. Try your own code next.",
                  )}
                </strong>
                <p>
                  {t(
                    "VS Code 설치 안내와 사용 경험을 남기는 방법을 확인하세요.",
                    "Find installation steps and tell us how the experience went.",
                  )}
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => setModal("help")}
              >
                {t("다음 단계 보기 →", "See next steps →")}
              </button>
            </section>
          )}
          {demoMode && (
            <nav
              className="demo-switch"
              aria-label={t("체험 예제 선택", "Choose an example")}
            >
              <a
                href={`?demo=shipping&lang=${lang}`}
                aria-current={demoKind === "shipping" ? "page" : undefined}
              >
                {t("배송 규칙 바꾸기", "Change a shipping rule")}
              </a>
              <a
                href={`?demo=interface&lang=${lang}`}
                aria-current={demoKind === "interface" ? "page" : undefined}
              >
                {t("React 화면 문구 바꾸기", "Edit React interface text")}
              </a>
            </nav>
          )}
          {demoKind === "interface" &&
            active?.rules.some((r) => r.value === "무료로 시작하기") && (
              <section className="quick-demo">
                <div>
                  <span className="eyebrow">READ IT. MAKE IT YOURS.</span>
                  <h2>
                    {t(
                      "이 버튼의 문구, 어디서 바꾸죠?",
                      "Where do I change this button’s text?",
                    )}
                  </h2>
                  <p>
                    {t(
                      "화면 구조에서 문구를 찾고, ‘14일 무료 체험’으로 바꿔 보세요. 변경안을 확인한 뒤 적용할 수 있습니다.",
                      "Find the button text in the structure and try ‘Start my 14-day trial’. Review the code change before applying it.",
                    )}
                  </p>
                  <small>
                    {t(
                      "React 예제 · 코드 실행 없이 읽고 수정합니다.",
                      "React example · read and edit without running code.",
                    )}
                  </small>
                </div>
                <button
                  className="button primary"
                  disabled={busy || editing}
                  onClick={() =>
                    selectRule(
                      selected,
                      active.rules.find((r) => r.value === "무료로 시작하기")!,
                    )
                  }
                >
                  {t("버튼 문구 바꿔보기 →", "Try editing the button text →")}
                </button>
              </section>
            )}
          {selected === demo[0].path &&
            active?.rules.some((r) => r.name === "freeShippingThreshold") && (
              <section className="quick-demo">
                <div>
                  <span className="eyebrow">READ IT. CHANGE IT. CHECK IT.</span>
                  <h2>
                    {t(
                      "AI가 쓴 코드, 이제 내가 이해하고 고칩니다.",
                      "AI wrote the code. Now make it yours.",
                    )}
                  </h2>
                  <p>
                    {t(
                      "무료 배송 기준을 바꾸고, 어떤 주문에서 배송비가 달라지는지 확인해 보세요.",
                      "Change the free-shipping rule. See exactly which orders are affected.",
                    )}
                  </p>
                  {demoMode && (
                    <small>
                      {t(
                        "체험 모드 · 기존 작업은 그대로 보관됩니다.",
                        "Demo mode · your saved workspace stays intact.",
                      )}
                    </small>
                  )}
                </div>
                <button
                  className="button primary"
                  disabled={busy || editing}
                  onClick={async () => {
                    setEditing(true);
                    setError("");
                    try {
                      const r = active!.rules.find(
                        (r) => r.name === "freeShippingThreshold",
                      )!;
                      const p = await request<Patch>("patch", {
                        file,
                        ruleId: r.id,
                        value: "70000",
                      });
                      setPatch(p);
                      setSimulation("calculateShipping");
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setEditing(false);
                    }
                  }}
                >
                  {t("70,000으로 바꿔보기 →", "Try changing it to 70,000 →")}
                </button>
              </section>
            )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" /> CODE, IN YOUR WORDS
              </div>
              <h1>{t("코드가, 말이 되다.", "Code, in your words.")}</h1>
              <p>
                {t(
                  "복잡한 코드를 읽을 수 있는 이야기로. 이해하고, 고치고, 확인하세요.",
                  "Turn complex code into a story. Understand it, change it, and check it.",
                )}
              </p>
            </div>
            <div className="heading-buttons">
              <button
                className="button"
                onClick={() => folderInput.current?.click()}
                disabled={!ready}
              >
                <Icon name="folder" size={17} />
                {t("폴더 열기", "Open folder")}
              </button>
              <button
                className="button icon-button"
                onClick={() => fileInput.current?.click()}
                disabled={!ready}
                aria-label={t("개별 파일 열기", "Open individual files")}
                title={t("개별 파일 열기", "Open files")}
              >
                <Icon name="upload" size={17} />
              </button>
            </div>
          </div>
          <input
            type="file"
            ref={folderInput}
            hidden
            multiple
            {...{ webkitdirectory: "", directory: "" }}
            onChange={(e) => {
              void importFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            type="file"
            ref={fileInput}
            hidden
            multiple
            accept=".ts,.tsx,.js,.jsx,.mjs,.cjs,.mts,.cts,.json,.css,.html,.md,.py,.yaml,.yml,.txt"
            onChange={(e) => {
              void importFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {notice && (
            <div className="notice" role="status">
              <Icon name="check" size={16} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label={t("알림 닫기", "Dismiss notice")}
                onClick={() => setNotice("")}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          <div className="intro-strip">
            <span className="intro-icon">
              <Icon name="book" />
            </span>
            <div>
              <strong>
                {t(
                  "코드를 몰라도, 규칙은 이해할 수 있으니까.",
                  "You can understand the rules behind the code.",
                )}
              </strong>
              <p>
                {t(
                  "설명 속 숫자와 조건을 바꾸면 실제 코드에 반영돼요. 모든 변경은 먼저 비교하고 적용합니다.",
                  "Edit values and conditions in the explanation. Review every code change before applying it.",
                )}
              </p>
            </div>
            <span className="tag green">
              {t("코드 근거 연결", "SOURCE LINKED")}
            </span>
          </div>
          <div className="metrics">
            <div>
              <span className="metric-icon mint">
                <Icon name="file" />
              </span>
              <span>
                {t("함께 읽는 파일", "Files in workspace")}
                <strong>
                  {files.length}
                  <small>{t("개", "files")}</small>
                </strong>
              </span>
            </div>
            <div>
              <span className="metric-icon blue">
                <Icon name="map" />
              </span>
              <span>
                {t("발견한 기능", "Functions found")}
                <strong>
                  {functions}
                  <small>{t("개", "functions")}</small>
                </strong>
              </span>
            </div>
            <div>
              <span className="metric-icon purple">
                <Icon name="table" />
              </span>
              <span>
                {t("바꿀 수 있는 규칙", "Editable rules")}
                <strong>
                  {allRules.length}
                  <small>{t("개", "rules")}</small>
                </strong>
              </span>
            </div>
            <button onClick={() => setView("checks")}>
              <span className="metric-icon sand">
                <Icon name="alert" />
              </span>
              <span>
                {t("함께 점검할 곳", "Points to review")}
                <strong>
                  {allIssues.length}
                  <small>{t("곳", "points")}</small>
                </strong>
              </span>
              <Icon name="arrow" size={16} />
            </button>
          </div>
          <div className="workbench">
            <div className="content-column">
              <div className="content-toolbar">
                <div className="file-breadcrumb">
                  <Icon name="file" size={17} />
                  <span>
                    {view === "map" || view === "checks" || view === "research"
                      ? t("프로젝트 전체", "Entire project")
                      : selected}
                  </span>
                  {busy && <span className="spinner" />}
                </div>
                <button
                  className="text-button"
                  onClick={() => setSourceLine(1)}
                >
                  <Icon name="code" size={15} />
                  {t("원문 보기", "View code")}
                </button>
              </div>
              {view === "story" && active && (
                <>
                  <Terminology
                    key={active.path}
                    terms={active.terms || []}
                    lang={lang}
                    disabled={busy || editing}
                    onSave={saveTerm}
                    onSource={setSourceLine}
                  />
                  <Story
                    analysis={active}
                    lang={lang}
                    onSource={setSourceLine}
                    onSimulate={setSimulation}
                    onEdit={(r) => selectRule(selected, r)}
                  />
                </>
              )}
              {view === "map" && analysis && (
                <MapView
                  files={analysis.files}
                  lang={lang}
                  onSelect={selectFile}
                />
              )}
              {view === "rules" && (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">SMALL RULES, REAL CHANGES</span>
                      <h2>
                        {t(
                          "바꿀 수 있는 것부터, 하나씩",
                          "Start with one rule",
                        )}
                      </h2>
                    </div>
                    <span className="tag">{allRules.length}</span>
                  </div>
                  <p className="section-description">
                    {t(
                      "값은 코드에서 직접 확인했습니다. 이름의 뜻이 다르면 원문에서 문맥을 확인하세요.",
                      "Values come directly from the source. If a translated name seems wrong, check its source context.",
                    )}
                  </p>
                  {analysis?.files
                    .filter((f) => f.rules.length)
                    .map((f) => (
                      <section className="card rule-group" key={f.path}>
                        <h3>
                          <Icon name="file" size={17} />
                          {f.path}
                        </h3>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{t("규칙 이름", "Rule")}</th>
                                <th>{t("현재 값", "Current value")}</th>
                                <th>{t("코드 위치", "Source")}</th>
                                <th>
                                  <span className="sr-only">
                                    {t("수정", "Edit")}
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.rules.map((r) => (
                                <tr
                                  key={r.id}
                                  className={
                                    selectedRule?.id === r.id
                                      ? "selected-row"
                                      : ""
                                  }
                                >
                                  <td>
                                    <strong>{r.label[lang]}</strong>
                                    <small className="rule-name">
                                      {r.name} · {r.scope}
                                    </small>
                                  </td>
                                  <td>
                                    <span
                                      className={
                                        "value-pill " +
                                        (r.type === "operator"
                                          ? "operator"
                                          : "")
                                      }
                                    >
                                      {r.type === "operator"
                                        ? operators[String(r.value)]?.[
                                            ko ? 0 : 1
                                          ]
                                        : String(r.value)}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      className="line-link"
                                      onClick={() => {
                                        setSelected(f.path);
                                        setSourceLine(r.line);
                                      }}
                                    >
                                      L{r.line}
                                    </button>
                                  </td>
                                  <td>
                                    <button
                                      className="edit-button"
                                      onClick={() => selectRule(f.path, r)}
                                      disabled={busy || !f.syntaxValid}
                                    >
                                      {t("변경", "Edit")}{" "}
                                      <Icon name="arrow" size={13} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  {!allRules.length && (
                    <div className="card empty">
                      {t(
                        "직접 편집 가능한 값이나 비교 연산이 없습니다.",
                        "No editable literals or comparisons found.",
                      )}
                    </div>
                  )}
                </>
              )}
              {view === "checks" && (
                <>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">A SECOND LOOK</span>
                      <h2>
                        {t(
                          "이 부분은 함께 점검해 보세요",
                          "Take a closer look here",
                        )}
                      </h2>
                    </div>
                  </div>
                  <p className="section-description">
                    {t(
                      "제한된 정적 규칙으로 찾은 검토 후보입니다. 오류 확정이나 전체 품질 평가가 아닙니다.",
                      "These are candidates from a small set of static rules, not confirmed defects or a complete quality assessment.",
                    )}
                  </p>
                  {allIssues.map(({ path, issue }) => (
                    <section
                      className={"card issue-card " + issue.level}
                      key={path + issue.id}
                    >
                      <span className="issue-icon">
                        <Icon
                          name={issue.level === "error" ? "alert" : "info"}
                        />
                      </span>
                      <div>
                        <span className="mini-label">
                          {issue.level === "error"
                            ? t("문법 오류", "SYNTAX ERROR")
                            : t("검토 후보", "REVIEW CANDIDATE")}
                        </span>
                        <h3>{issue.title[lang]}</h3>
                        <p>{issue.detail[lang]}</p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelected(path);
                            setSourceLine(issue.line);
                          }}
                        >
                          {path} · L{issue.line} <Icon name="arrow" size={13} />
                        </button>
                      </div>
                    </section>
                  ))}
                  {!allIssues.length && (
                    <div className="card empty">
                      <Icon name="check" size={32} />
                      <h3>
                        {t(
                          "현재 규칙에서 발견한 항목이 없어요",
                          "No findings from the current rules",
                        )}
                      </h3>
                      <p>
                        {t(
                          "오류가 없다는 보장은 아닙니다. 실제 앱에서 주요 흐름과 실패 상황을 테스트하세요.",
                          "This does not guarantee correctness. Test important flows and failure cases in the application.",
                        )}
                      </p>
                    </div>
                  )}
                  <div className="hint-card">
                    <Icon name="info" />
                    <span>
                      {t(
                        "현재 점검: 문법 오류, 느슨한 비교, 비밀값 후보, fetch의 주변 오류 처리, 일부 문자열 코드 실행.",
                        "Checks: syntax, loose equality, possible secrets, surrounding fetch error handling and some dynamic-code calls.",
                      )}
                    </span>
                  </div>
                </>
              )}
              {view === "research" && <Research lang={lang} />}
              {!analysis && (
                <div className="card empty">
                  <span className="spinner" />
                  {t(
                    "코드의 구조를 읽고 있어요…",
                    "Reading your code’s structure…",
                  )}
                </div>
              )}
            </div>
            <aside className="editor-column" ref={editorRef}>
              <section className="card editor-card">
                <div className="editor-heading">
                  <span className="editor-icon">
                    <Icon name="spark" size={19} />
                  </span>
                  <div>
                    <h2>{t("내 말로 바꾸기", "Make it yours")}</h2>
                    <p>
                      {t(
                        "작은 변경부터 시작해 보세요",
                        "Start with a small change",
                      )}
                    </p>
                  </div>
                </div>
                <div className="segmented">
                  <button
                    className={editMode === "sentence" ? "active" : ""}
                    onClick={() => {
                      setEditMode("sentence");
                      setError("");
                    }}
                  >
                    {t("문장으로 요청", "Use a sentence")}
                  </button>
                  <button
                    className={editMode === "direct" ? "active" : ""}
                    onClick={() => {
                      setEditMode("direct");
                      setError("");
                    }}
                  >
                    {t("직접 수정", "Edit a rule")}
                  </button>
                </div>
                {editMode === "sentence" ? (
                  <>
                    <label className="field-label" htmlFor="change-request">
                      {t(
                        "어떤 규칙을 바꾸고 싶나요?",
                        "Which rule should change?",
                      )}
                    </label>
                    <textarea
                      id="change-request"
                      value={sentence}
                      onChange={(e) => {
                        setSentence(e.target.value);
                        setPatch(null);
                      }}
                      placeholder={t(
                        "예: 무료 배송 기준을 70000으로 변경",
                        "Example: change freeShippingThreshold to 70000",
                      )}
                      rows={4}
                    />
                    <span className="field-help">
                      {t(
                        "현재 파일의 규칙 이름 + 새 값. 일반적인 기능 생성 요청은 아직 지원하지 않습니다.",
                        "Use a rule name in the current file + one new value. General feature generation is not supported yet.",
                      )}
                    </span>
                    <div className="suggestion-chips">
                      {active?.rules
                        .filter((r) => r.type === "number")
                        .slice(0, 2)
                        .map((r) => (
                          <button
                            key={r.id}
                            onClick={() => {
                              setSentence(
                                ko
                                  ? `${r.label.ko}을 ${Number(r.value) === 50000 ? 70000 : Number(r.value) + 1}으로 변경`
                                  : `change ${r.name} to ${Number(r.value) === 50000 ? 70000 : Number(r.value) + 1}`,
                              );
                              setPatch(null);
                            }}
                          >
                            {r.label[lang]} <Icon name="plus" size={12} />
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <>
                    {editRule ? (
                      <>
                        <p className="field-help mono">
                          {editRule.path} · L{editRule.rule.line}
                        </p>
                        <label className="field-label" htmlFor="rule-value">
                          {editRule.rule.label[lang]}
                        </label>
                        {editRule.rule.type === "boolean" ? (
                          <select
                            id="rule-value"
                            value={draft}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              setPatch(null);
                            }}
                          >
                            <option value="true">
                              {t("예 (true)", "Yes (true)")}
                            </option>
                            <option value="false">
                              {t("아니요 (false)", "No (false)")}
                            </option>
                          </select>
                        ) : editRule.rule.type === "operator" ? (
                          <select
                            id="rule-value"
                            value={draft}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              setPatch(null);
                            }}
                          >
                            {Object.entries(operators).map(([op, names]) => (
                              <option key={op} value={op}>
                                {names[ko ? 0 : 1]} ({op})
                              </option>
                            ))}
                          </select>
                        ) : editRule.rule.type === "string" ? (
                          <textarea
                            id="rule-value"
                            value={draft}
                            rows={3}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              setPatch(null);
                            }}
                          />
                        ) : (
                          <input
                            id="rule-value"
                            value={draft}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              setPatch(null);
                            }}
                            inputMode={
                              editRule.rule.type === "number"
                                ? "decimal"
                                : "text"
                            }
                          />
                        )}
                        <span className="field-help">
                          {t("현재 값", "Current value")}:{" "}
                          {String(editRule.rule.value)}
                        </span>
                      </>
                    ) : (
                      <div className="choose-rule">
                        <Icon name="table" size={28} />
                        <p>
                          {t(
                            "표에서 바꾸고 싶은 규칙을 선택해 주세요.",
                            "Choose a rule from the table.",
                          )}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setView("rules")}
                        >
                          {t("데이터와 규칙 열기", "Open data & rules")}{" "}
                          <Icon name="arrow" size={14} />
                        </button>
                      </div>
                    )}
                  </>
                )}
                <button
                  className="button primary full"
                  onClick={stage}
                  disabled={
                    busy ||
                    editing ||
                    !ready ||
                    (editMode === "direct" && !editRule) ||
                    (editMode === "sentence" && !sentence.trim())
                  }
                >
                  <Icon name="spark" size={16} />
                  {editing ? "…" : t("변경 미리보기", "Preview change")}
                  <Icon name="arrow" size={15} />
                </button>
                {error && (
                  <div className="error-message" role="alert">
                    <Icon name="alert" size={16} />
                    <span>{error}</span>
                  </div>
                )}
                {patch && (
                  <div className="patch-preview">
                    <div className="mini-label">
                      {t("이렇게 바뀝니다", "CHANGE PREVIEW")}
                    </div>
                    <h4>{patch.description[lang]}</h4>
                    <p className="field-help mono">{patch.path}</p>
                    <div className="diff-line removed">
                      <span>−</span>
                      <code>{patch.oldText}</code>
                    </div>
                    <div className="diff-line added">
                      <span>+</span>
                      <code>{patch.newText}</code>
                    </div>
                    <div className="validation">
                      <Icon name="check" size={15} />
                      {t("문법 검사 통과", "Syntax check passed")}
                    </div>
                    <p className="field-help">
                      {t(
                        "동작·자료형의 정확성은 별도 확인이 필요해요.",
                        "Behavior and types still need separate verification.",
                      )}
                    </p>
                    {dependencies.length > 0 && (
                      <p className="field-help">
                        {t(
                          "영향을 받을 수 있는 파일",
                          "Potentially affected files",
                        )}
                        : {dependencies.join(", ")}
                      </p>
                    )}
                    {analysis?.files
                      .find((x) => x.path === patch.path)
                      ?.functions.some((f) => f.simulatable) && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected(patch.path);
                          const f = analysis?.files.find(
                            (x) => x.path === patch.path,
                          );
                          const candidate = f?.functions.find(
                            (fn) => fn.simulatable,
                          );
                          if (candidate) setSimulation(candidate.name);
                          else
                            setNotice(
                              t(
                                "이 파일에는 미리보기할 기능이 없습니다.",
                                "No function to preview in this file.",
                              ),
                            );
                        }}
                      >
                        <Icon name="play" size={14} />
                        {t("입력별 결과 비교", "Compare with inputs")}
                      </button>
                    )}
                    <button
                      className="button primary full apply"
                      onClick={apply}
                      disabled={busy}
                    >
                      {t("이 변경 적용하기", "Apply this change")}
                    </button>
                    <button
                      className="text-button full"
                      onClick={() => setPatch(null)}
                    >
                      {t("변경안 버리기", "Discard preview")}
                    </button>
                  </div>
                )}
                <div className="editor-foot">
                  <Icon name="lock" size={13} />
                  {t(
                    "외부 AI 연결 없이, 기기 안에서 처리",
                    "Processed locally, without external AI",
                  )}
                </div>
              </section>
              <section className="card mini-guide">
                <div className="mini-guide-heading">
                  <Icon name="book" size={17} />
                  <h3>{t("이렇게 사용해 보세요", "A little guide")}</h3>
                </div>
                <div>
                  <b>1</b>
                  <p>
                    {t(
                      "왼쪽에서 파일을 골라 이야기를 읽어요.",
                      "Pick a file and read its story.",
                    )}
                  </p>
                </div>
                <div>
                  <b>2</b>
                  <p>
                    {t(
                      "숫자나 조건을 바꾸고 차이를 확인해요.",
                      "Change a value or condition and review the difference.",
                    )}
                  </p>
                </div>
                <div>
                  <b>3</b>
                  <p>
                    {t(
                      "결과를 비교한 뒤 적용하고 내보내요.",
                      "Compare outcomes, apply, then export.",
                    )}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setModal("reset")}
                >
                  {t("예제 프로젝트로 연습하기", "Practice with the example")}{" "}
                  <Icon name="arrow" size={13} />
                </button>
              </section>
              <button
                className="history-button"
                onClick={() => setModal("history")}
              >
                <Icon name="history" size={18} />
                <span>
                  {t("이번 세션의 변경 기록", "Session change history")}
                </span>
                <b>{history.length}</b>
                <Icon name="chevron" size={14} />
              </button>
            </aside>
          </div>
          <footer className="page-footer">
            <span>
              풀어봄 <i>·</i>{" "}
              {t(
                "이해할 수 있어야, 만들 수 있으니까.",
                "Understanding comes before creating.",
              )}
            </span>
            <div>
              <button onClick={() => setView("research")}>
                {t("설계와 선행 연구", "Design & research")}
              </button>
              <span>
                {analysis
                  ? `${analysis.elapsed.toFixed(0)} ms · ${analysis.cacheHits}/${files.length} cached`
                  : "LOCAL FIRST"}
              </span>
              <button onClick={report} disabled={!analysis}>
                {t("설명서 내보내기", "Export explanation")}{" "}
                <Icon name="download" size={12} />
              </button>
            </div>
          </footer>
        </main>
      </div>
      {sourceLine !== null && file && (
        <Modal
          wide
          title={`${file.path} · ${t("설명의 근거", "Source evidence")}`}
          onClose={() => setSourceLine(null)}
        >
          <p className="muted">
            {t(
              "설명과 연결된 코드 위치입니다. 원문 전체를 여기서 읽을 수 있어요.",
              "The highlighted line is linked to the explanation. The full file is shown below.",
            )}
          </p>
          <div className="source-view">
            {file.content.split("\n").map((line, i) => (
              <div
                ref={i + 1 === sourceLine ? sourceFocus : undefined}
                className={
                  "source-line " + (i + 1 === sourceLine ? "highlight" : "")
                }
                key={i}
              >
                <span>{i + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {simulation &&
        active?.functions.find(
          (f) => f.name === simulation && f.simulatable,
        ) && (
          <Modal
            wide
            title={t("입력으로 확인하기", "Check with inputs")}
            onClose={() => setSimulation(null)}
          >
            <label className="field-label" htmlFor="function-select">
              {t("확인할 기능", "Function")}
            </label>
            <select
              id="function-select"
              value={simulation}
              onChange={(e) => setSimulation(e.target.value)}
            >
              {active.functions
                .filter((fn) => fn.simulatable)
                .map((fn) => (
                  <option key={fn.id} value={fn.name}>
                    {fn.label[lang]} · {fn.name}
                  </option>
                ))}
            </select>
            <ScenarioLab
              key={`cases:${selected}:${simulation}:${patch?.updated}:${file.content}`}
              fn={active.functions.find((f) => f.name === simulation)!}
              rules={active.rules}
              lang={lang}
              revision={`${file.content}:${patch?.updated}`}
              change={patch ?? undefined}
              disabled={busy}
              run={(scenarios) =>
                request<ScenarioReport>("compare", {
                  files,
                  path: selected,
                  name: simulation,
                  scenarios,
                  patch,
                })
              }
              exportReport={(markdown) =>
                saveBlob(
                  new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
                  "pureobom-comparison.md",
                )
              }
            />
            <details>
              <summary>
                {t(
                  "입력 하나의 판단 과정 자세히 보기",
                  "Inspect a single input and its decision trace",
                )}
              </summary>
              <Simulator
                key={`${selected}:${simulation}:${patch?.updated}:${file.content}`}
                files={files}
                path={selected}
                fn={active.functions.find((f) => f.name === simulation)!}
                patch={patch}
                lang={lang}
              />
            </details>
          </Modal>
        )}
      {modal === "history" && (
        <Modal
          title={t("이번 세션의 변경 기록", "Session change history")}
          onClose={() => setModal(null)}
        >
          <p className="muted">
            {t(
              demoMode
                ? "체험 모드에서는 새로고침하면 변경 내용과 기록이 초기화됩니다. 보관하려면 파일을 내보내세요."
                : "새로고침하면 기록은 초기화됩니다. 수정된 파일은 기기에 저장됩니다.",
              demoMode
                ? "Demo changes and history reset on reload. Export files to keep them."
                : "History resets on reload. Modified files remain saved on your device.",
            )}
          </p>
          {history.length ? (
            <>
              <button className="button" onClick={undo} disabled={busy}>
                <Icon name="undo" size={16} />
                {t("마지막 변경 되돌리기", "Undo last change")}
              </button>
              {history
                .slice()
                .reverse()
                .map((h, i) => (
                  <div className="history-entry" key={i}>
                    <span>{h.date}</span>
                    <div>
                      <strong>{h.patch.description[lang]}</strong>
                      <small>{h.patch.path}</small>
                    </div>
                  </div>
                ))}
            </>
          ) : (
            <div className="empty">
              {t("아직 적용한 변경이 없어요.", "No applied changes yet.")}
            </div>
          )}
        </Modal>
      )}
      {modal === "reset" && (
        <Modal
          title={t("예제 프로젝트 열기", "Open example project")}
          onClose={() => setModal(null)}
        >
          <p>
            {t(
              "현재 작업 공간을 작은 상점 예제로 바꿉니다. 필요한 변경 내용은 먼저 파일로 내보내 주세요.",
              "Replace this workspace with the little-store example. Export any changes you want to keep first.",
            )}
          </p>
          <div className="modal-actions">
            <button className="button" onClick={download}>
              {t("현재 파일 내보내기", "Export current files")}
            </button>
            <button className="button primary" onClick={reset}>
              {t("예제 열기", "Open example")}
            </button>
          </div>
        </Modal>
      )}
      {modal === "import" && (
        <Modal
          title={t("가져오기 결과", "Import results")}
          onClose={() => setModal(null)}
        >
          <p>
            {t(
              "숨김 파일, 비밀 설정, 의존성 폴더, 바이너리와 크기 제한 초과 파일은 제외됩니다. 한 파일 512KB, 전체 8MB, 최대 300개입니다. 내보내기에는 읽어 온 파일만 포함됩니다.",
              "Hidden files, secret configuration, dependency folders, binaries and oversized files are skipped. Limits: 512KB per file, 8MB total, 300 files. Exports include only imported files.",
            )}
          </p>
          <ul className="skipped-list">
            {importedSkipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Modal>
      )}
      {modal === "help" && (
        <ProductHelp
          lang={lang}
          environment="browser"
          example={demoMode}
          onClose={() => setModal(null)}
          onOpen={(resource) => {
            window.open(
              productResource(resource),
              "_blank",
              "noopener,noreferrer",
            );
          }}
          onCopy={(text) => navigator.clipboard.writeText(text)}
        />
      )}
    </div>
  );
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
