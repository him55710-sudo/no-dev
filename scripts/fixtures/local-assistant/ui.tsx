import { createRoot } from "react-dom/client";
import { useState } from "react";
import { LocalAssistant } from "../../../extension/ui/LocalAssistant";
import "../../../extension/ui/style.css";
import "../../../extension/ui/journey.css";
import "./theme.css";
function App() {
  const [lang, setLang] = useState<"ko" | "en">("ko");
  return (
    <main style={{ maxWidth: 820, margin: "auto", padding: 20 }}>
      <p>
        UI verification fixture — real component and source comparison;
        simulated model and editor operations.
      </p>
      <button onClick={() => setLang(lang === "ko" ? "en" : "ko")}>
        한국어 / English
      </button>
      <LocalAssistant
        lang={lang}
        state={{
          contextId: "fixture",
          path: "sample.ts",
          language: "typescript",
          sourceBytes: 31,
          version: 1,
          dirty: false,
          trusted: true,
          busy: false,
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
