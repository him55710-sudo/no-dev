import { useEffect, useId, useRef, useState } from "react";
import type { Lang } from "../core/types";
import {
  feedbackMarkdown,
  feedbackOutcomes,
  feedbackProjects,
  type FeedbackInput,
} from "../core/feedback";
import { productVersion, type ProductResource } from "../product";
import "./ProductHelp.css";

export function ProductHelp({
  lang,
  environment,
  example,
  onClose,
  onOpen,
  onCopy,
}: {
  lang: Lang;
  environment: FeedbackInput["environment"];
  example: boolean;
  onClose: () => void;
  onOpen: (resource: ProductResource) => Promise<void> | void;
  onCopy: (text: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLElement>(null);
  const id = useId();
  const [tab, setTab] = useState<"start" | "feedback">("start");
  const [project, setProject] = useState<FeedbackInput["project"] | "">(
    example ? "example" : "",
  );
  const [outcome, setOutcome] = useState<FeedbackInput["outcome"] | "">("");
  const [task, setTask] = useState("");
  const [detail, setDetail] = useState("");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const ko = lang === "ko";
  const t = (k: string, e: string) => (ko ? k : e);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (draft) preview.current?.focus();
  }, [draft]);
  const invalidate = () => {
    setDraft("");
    setCopied(false);
    setError("");
  };
  async function open(resource: ProductResource) {
    setError("");
    try {
      await onOpen(resource);
    } catch {
      setError(
        t(
          "링크를 열지 못했습니다. 다시 시도해 주세요.",
          "Could not open the link. Please try again.",
        ),
      );
    }
  }
  return (
    <dialog
      ref={dialog}
      className="product-help"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <span className="product-help-version">
            PUREOBOM {productVersion}
          </span>
          <h2 id={`${id}-title`}>
            {t("다음 단계와 사용 경험", "Next steps and feedback")}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("도움말 닫기", "Close help")}
        >
          ×
        </button>
      </header>
      <nav aria-label={t("도움말 항목", "Help sections")}>
        <button aria-pressed={tab === "start"} onClick={() => setTab("start")}>
          {t("내 코드에서 사용하기", "Use it with my code")}
        </button>
        <button
          aria-pressed={tab === "feedback"}
          onClick={() => setTab("feedback")}
        >
          {t("사용 경험 남기기", "Share an experience")}
        </button>
      </nav>
      <div className="product-help-body">
        {tab === "start" ? (
          <>
            <h3>
              {t(
                "예제 다음에는 내 프로젝트로",
                "From the example to your project",
              )}
            </h3>
            <p>
              {t(
                "AI가 만든 JS·TS·React 파일을 VS Code에서 열고, 원본 옆에서 설명을 읽어 보세요.",
                "Open your AI-written JS, TS or React file in VS Code and read the explanation beside its source.",
              )}
            </p>
            <ol className="product-steps">
              <li>
                {t(
                  "개발판 설치 안내에 따라 소스에서 .vsix 파일을 빌드합니다.",
                  "Follow the development installation guide to build a .vsix from source.",
                )}
              </li>
              <li>
                {t(
                  "VS Code → 확장 → … → ‘VSIX에서 설치…’를 선택합니다.",
                  "In VS Code: Extensions → … → Install from VSIX….",
                )}
              </li>
              <li>
                {t(
                  "파일을 열고 ‘풀어봄: 현재 파일 설명 열기’를 실행합니다. 영어 VS Code에서는 ‘Pureobom: Explain current file’입니다.",
                  "Open a file and run ‘Pureobom: Explain current file’ from the Command Palette.",
                )}
              </li>
            </ol>
            <div className="product-help-actions">
              <button
                className="help-primary"
                onClick={() => void open("install")}
              >
                {t("개발판 설치 안내 ↗", "Development installation guide ↗")}
              </button>
              <button onClick={() => void open("repository")}>GitHub ↗</button>
            </div>
            <p className="product-help-note">
              {t(
                "0.7 개발판은 소스에서 빌드해 설치합니다. 공개 0.6.0에는 시스템 설계 화면이 없으며 Marketplace에는 아직 게시하지 않았습니다. 코드 분석은 기기 안에서 처리합니다.",
                "Build and install the 0.7 development version from source. The public 0.6.0 release has no system design workspace; a Marketplace listing is not available yet. Code analysis runs on your device.",
              )}
            </p>
            <div className="product-first-task">
              <h3>
                {t("처음에는 작은 변경 하나", "Start with one small change")}
              </h3>
              <p>
                {t(
                  "금액·기간·버튼 문구 중 하나를 골라 바꿔 보세요. 원문과 변경안을 확인하고 적용한 다음, 되돌릴 수 있는지도 확인하세요.",
                  "Try an amount, a duration or a button label. Inspect the source and diff, apply the change, then try undoing it.",
                )}
              </p>
              <button onClick={() => setTab("feedback")}>
                {t(
                  "완료했거나 막힌 지점 알려주기 →",
                  "Tell us what worked or where you got stuck →",
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>
              {t("어떤 일을 하려다 여기 왔나요?", "What brought you here?")}
            </h3>
            <p>
              {t(
                "성공한 변경도, 막힌 경험도 다음 개선을 정하는 데 도움이 됩니다. 먼저 내 기기에서 요약을 만들고, 공유 여부를 직접 결정하세요.",
                "Both successful changes and obstacles help guide improvements. Prepare a summary on your device, then choose whether to share it.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                if (!project || !outcome) return;
                try {
                  setDraft(
                    feedbackMarkdown({
                      lang,
                      environment,
                      project,
                      outcome,
                      task,
                      detail,
                    }),
                  );
                  setCopied(false);
                } catch {
                  setError(
                    t(
                      "하려던 일을 적고, 각 문항을 1,200자 이내로 입력해 주세요.",
                      "Describe your task and keep each answer within 1,200 characters.",
                    ),
                  );
                }
              }}
            >
              <div className="product-help-fields">
                <label htmlFor={`${id}-project`}>
                  {t("어떤 코드를 사용했나요?", "Which code did you use?")}
                </label>
                <select
                  id={`${id}-project`}
                  required
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value as FeedbackInput["project"]);
                    invalidate();
                  }}
                >
                  <option value="" disabled>
                    {t("선택해 주세요", "Select an option")}
                  </option>
                  {Object.entries(feedbackProjects).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text[lang]}
                    </option>
                  ))}
                </select>
                <label htmlFor={`${id}-outcome`}>
                  {t("결과는 어땠나요?", "How did it go?")}
                </label>
                <select
                  id={`${id}-outcome`}
                  required
                  value={outcome}
                  onChange={(e) => {
                    setOutcome(e.target.value as FeedbackInput["outcome"]);
                    invalidate();
                  }}
                >
                  <option value="" disabled>
                    {t("선택해 주세요", "Select an option")}
                  </option>
                  {Object.entries(feedbackOutcomes).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text[lang]}
                    </option>
                  ))}
                </select>
                <label htmlFor={`${id}-task`}>
                  {t("하려던 일", "What I tried")}
                </label>
                <textarea
                  id={`${id}-task`}
                  required
                  maxLength={1200}
                  rows={3}
                  value={task}
                  placeholder={t(
                    "예: 가입 버튼의 문구를 바꾸고 싶었어요.",
                    "For example: I wanted to change my sign-up button’s label.",
                  )}
                  onChange={(e) => {
                    setTask(e.target.value);
                    invalidate();
                  }}
                />
                <label htmlFor={`${id}-detail`}>
                  {t(
                    "잘된 점 또는 막힌 지점 (선택)",
                    "What worked or got in the way (optional)",
                  )}
                </label>
                <textarea
                  id={`${id}-detail`}
                  maxLength={1200}
                  rows={3}
                  value={detail}
                  onChange={(e) => {
                    setDetail(e.target.value);
                    invalidate();
                  }}
                />
              </div>
              <p className="product-help-note">
                {t(
                  "위 답변과 버전·사용 환경·설명 언어만 요약에 넣습니다. 코드·파일명은 자동 첨부하지 않습니다. 공유할 수 없는 정보는 직접 적지 마세요.",
                  "The summary includes these answers plus version, app environment and language. Source and file names are not attached automatically. Leave out information you cannot share.",
                )}
              </p>
              <button
                className="help-primary"
                type="submit"
                disabled={!task.trim() || !project || !outcome}
              >
                {t("공유 전 요약 확인", "Review summary before sharing")}
              </button>
            </form>
            {draft && (
              <section
                ref={preview}
                tabIndex={-1}
                className="product-feedback-preview"
                aria-label={t(
                  "공유할 요약 미리보기",
                  "Feedback summary preview",
                )}
              >
                <h3>
                  {t("공유할 내용은 이것뿐입니다", "This is the full summary")}
                </h3>
                <label htmlFor={`${id}-draft`}>
                  {t("복사할 요약", "Summary to copy")}
                </label>
                <textarea id={`${id}-draft`} readOnly rows={10} value={draft} />
                <div className="product-help-actions">
                  <button
                    className="help-primary"
                    onClick={async () => {
                      try {
                        await onCopy(draft);
                        setCopied(true);
                        setError("");
                      } catch {
                        setError(
                          t(
                            "자동 복사가 안 되면 위 요약을 선택해 직접 복사해 주세요.",
                            "If copying fails, select and copy the summary above.",
                          ),
                        );
                      }
                    }}
                  >
                    {copied
                      ? t("복사했어요", "Copied")
                      : t("요약 복사", "Copy summary")}
                  </button>
                  <button onClick={() => void open("feedback")}>
                    {t(
                      "GitHub에서 피드백 작성 ↗",
                      "Write feedback on GitHub ↗",
                    )}
                  </button>
                </div>
                <p className="product-help-note">
                  {t(
                    "GitHub에 로그인한 뒤 요약을 붙여 넣고 직접 제출하세요. 제출하면 공개 이슈가 됩니다. 이 앱은 글을 전송하거나 자동으로 게시하지 않습니다.",
                    "Sign in to GitHub, paste the summary and submit it yourself. Submitted issues are public. This app does not send or automatically publish your text.",
                  )}
                </p>
                {copied && (
                  <p role="status">
                    {t(
                      "요약을 복사했습니다. 아직 전송하지 않았습니다.",
                      "Summary copied. Nothing has been sent.",
                    )}
                  </p>
                )}
              </section>
            )}
          </>
        )}
        {error && (
          <p className="product-help-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
