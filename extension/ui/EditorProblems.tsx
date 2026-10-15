import type { EditorDiagnostics } from "../../src/core/editorDiagnostics";
import type { Lang } from "../../src/core/types";

export function EditorProblems({
  snapshot,
  lang,
  disabled,
  onSource,
}: {
  snapshot: EditorDiagnostics;
  lang: Lang;
  disabled: boolean;
  onSource: (revision: string, id: string) => void;
}) {
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const stale = snapshot.status === "edited";
  const labels = {
    error: t("오류", "Error"),
    warning: t("경고", "Warning"),
    information: t("정보", "Information"),
    hint: t("참고", "Hint"),
  };
  return (
    <section
      className="editor-problems card"
      aria-label={t("편집기가 알려준 문제", "Editor reports")}
    >
      <span className="eyebrow">
        {t("VS CODE의 현재 파일 알림", "CURRENT FILE · VS CODE REPORTS")}
      </span>
      <h2>{t("편집기가 알려준 문제", "Editor reports")}</h2>
      <p>
        {t("오류", "Errors")} {snapshot.errors} · {t("경고", "Warnings")}{" "}
        {snapshot.warnings} · {t("정보·참고", "Other")} {snapshot.other}
      </p>
      {stale && (
        <p className="banner" role="status">
          {t(
            "코드가 바뀐 뒤 새 알림을 아직 받지 못했습니다. 아래 내용은 이전 코드에 대한 것일 수 있습니다.",
            "The code changed and no new report has arrived yet. These messages may refer to earlier code.",
          )}
        </p>
      )}
      <p className="muted">
        {t(
          "VS Code의 검사 도구가 보고한 내용입니다. 알림이 없어도 검사 완료나 정상 동작을 뜻하지 않습니다. 설정·도구 상태에 따라 늦게 도착하거나 표시되지 않을 수 있습니다.",
          "These messages come from VS Code's checking tools. No reports does not mean checking finished or the app works. Settings and tool availability can delay or suppress reports.",
        )}
      </p>
      {snapshot.total === 0 ? (
        <p className="diagnostic-empty">
          {t(
            "현재 전달된 알림이 없습니다.",
            "No reports are currently available.",
          )}
        </p>
      ) : (
        <ol className="diagnostic-list">
          {snapshot.items.map((item) => (
            <li
              className={`diagnostic diagnostic-${item.severity}`}
              key={item.id}
            >
              <div className="diagnostic-heading">
                <strong>{labels[item.severity]}</strong>
                <span className="mono">
                  {item.source || t("출처 미표시", "Source not supplied")}
                  {item.code && ` · ${item.code}`}
                </span>
                <button
                  disabled={disabled || stale}
                  onClick={() => onSource(snapshot.revision, item.id)}
                  aria-label={t(
                    `${item.line}행 ${item.column}열에서 확인`,
                    `Show line ${item.line}, column ${item.column}`,
                  )}
                >
                  L{item.line}:{item.column}
                </button>
              </div>
              {item.explanation && (
                <p className="diagnostic-meaning">
                  <strong>{t("뜻풀이", "In plain language")}</strong> ·{" "}
                  {item.explanation[lang]}
                </p>
              )}
              <details open={!item.explanation}>
                <summary>
                  {t("검사 도구의 원래 메시지", "Original tool message")}
                </summary>
                <pre>{item.message}</pre>
              </details>
              {item.shortened && (
                <p className="muted">
                  {t(
                    "긴 메시지는 일부만 표시합니다. 전체 내용은 VS Code 문제 목록에서 확인하세요.",
                    "Long message shortened. Read the full message in VS Code's Problems panel.",
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {snapshot.omitted > 0 && (
        <p className="muted">
          {t(
            `${snapshot.omitted}개 알림을 더 받았습니다. 전체 목록은 VS Code의 보기 → 문제에서 확인하세요.`,
            `${snapshot.omitted} more reports. See View → Problems in VS Code for the full list.`,
          )}
        </p>
      )}
    </section>
  );
}
