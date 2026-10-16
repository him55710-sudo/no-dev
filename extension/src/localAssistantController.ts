import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { OllamaClient } from "./ollama";
import { inputString } from "./protocol";
import type { AnalysisClient } from "./analysisClient";
import type {
  AssistantInput,
  AssistantProposal,
} from "../../src/core/localAssistant";
import { validatePython } from "./pythonValidation";

export type AssistantValidation = {
  status: "syntax-passed" | "syntax-failed" | "unavailable";
  detail: string;
};
export type AssistantResult = Omit<AssistantProposal, "updated"> & {
  id: string;
  model: string;
  digest: string;
  elapsedMs: number;
  validation: AssistantValidation;
};
type Pending = {
  result: AssistantResult;
  updated: string;
  original: string;
  doc: vscode.TextDocument;
  version: number;
  context: string;
  reviewed: boolean;
};

export class LocalAssistantController implements vscode.Disposable {
  private pending?: Pending;
  private running?: AbortController;
  private previews = new Map<string, string>();
  private provider = vscode.workspace.registerTextDocumentContentProvider(
    "pureobom-local-preview",
    {
      provideTextDocumentContent: (uri) =>
        this.previews.get(uri.toString()) || "",
    },
  );
  constructor(
    private current: (context: string | undefined) => vscode.TextDocument,
    private analyzer: AnalysisClient,
    private validateGo?: (
      source: string,
      signal: AbortSignal,
    ) => Promise<AssistantValidation>,
  ) {}
  private client() {
    if (vscode.env.remoteName)
      throw Error(
        "로컬 AI는 데스크톱의 로컬 작업 공간에서 사용하세요. / Local AI requires a local desktop workspace.",
      );
    return new OllamaClient(
      vscode.workspace
        .getConfiguration("pureobom")
        .get<number>("ollamaPort", 11434),
    );
  }
  async models() {
    return {
      origin: this.client().origin,
      models: await this.client().models(),
    };
  }
  cancel() {
    this.running?.abort();
  }
  invalidate() {
    this.cancel();
    this.pending = undefined;
  }
  async generate(
    context: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<AssistantResult> {
    const doc = this.current(context);
    if (!vscode.workspace.isTrusted)
      throw Error(
        "로컬 AI를 사용하려면 작업 공간을 신뢰해야 합니다. / Local AI requires a trusted workspace.",
      );
    if (this.running)
      throw Error(
        "진행 중인 요청을 취소하거나 기다려 주세요. / Wait for or cancel the current request.",
      );
    const input: AssistantInput = {
      source: doc.getText(),
      language: doc.languageId,
      instruction: inputString(payload.instruction, 2000),
      task: payload.task as AssistantInput["task"],
      lang: payload.lang as AssistantInput["lang"],
    };
    const version = doc.version;
    const controller = new AbortController();
    this.running = controller;
    this.pending = undefined;
    try {
      const response = await this.client().generate(
        inputString(payload.model, 200),
        input,
        controller.signal,
      );
      const validation = response.proposal.edits.length
        ? doc.languageId === "python"
          ? await validatePython(response.proposal.updated)
          : doc.languageId === "go" && this.validateGo
            ? await this.validateGo(
                response.proposal.updated,
                controller.signal,
              )
            : await this.analyzer.call<AssistantValidation>(
                "validateAssistant",
                {
                  language: doc.languageId,
                  source: response.proposal.updated,
                },
              )
        : {
            status: "unavailable" as const,
            detail: "변경안 없음 / No proposed change",
          };
      if (
        controller.signal.aborted ||
        this.current(context) !== doc ||
        doc.version !== version ||
        doc.getText() !== input.source
      )
        throw Error(
          "파일이 바뀌었습니다. 다시 요청하세요. / The file changed. Request again.",
        );
      const { updated, ...proposal } = response.proposal;
      const result = {
        ...proposal,
        id: randomUUID(),
        model: response.model.name,
        digest: response.model.digest,
        elapsedMs: response.elapsedMs,
        validation,
      };
      this.pending = {
        result,
        updated,
        original: input.source,
        doc,
        version,
        context: context!,
        reviewed: false,
      };
      return result;
    } finally {
      if (this.running === controller) this.running = undefined;
    }
  }
  private checked(id: string, context: string | undefined) {
    const doc = this.current(context),
      p = this.pending;
    if (
      !p ||
      p.result.id !== id ||
      p.context !== context ||
      p.doc !== doc ||
      p.version !== doc.version ||
      p.original !== doc.getText()
    )
      throw Error(
        "이 제안의 원본이 바뀌었습니다. 다시 요청하세요. / The proposal is stale. Request again.",
      );
    return p;
  }
  async source(id: string, context: string | undefined, index: unknown) {
    const p = this.checked(id, context);
    if (
      !Number.isInteger(index) ||
      (index as number) < 0 ||
      !p.result.citations[index as number]
    )
      throw Error("Invalid source reference");
    const citation = p.result.citations[index as number];
    const editor = await vscode.window.showTextDocument(p.doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: true,
    });
    this.checked(id, context);
    editor.selection = new vscode.Selection(
      p.doc.positionAt(citation.start),
      p.doc.positionAt(citation.end),
    );
    editor.revealRange(
      editor.selection,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }
  async preview(id: string, context: string | undefined) {
    const p = this.checked(id, context);
    if (!p.result.edits.length)
      throw Error("변경안이 없습니다. / No proposed change.");
    const suffix =
      p.doc.uri.path.match(/\.[a-zA-Z0-9]+$/)?.[0] ||
      (
        {
          javascript: ".js",
          javascriptreact: ".jsx",
          typescript: ".ts",
          typescriptreact: ".tsx",
          python: ".py",
          go: ".go",
          rust: ".rs",
          java: ".java",
          csharp: ".cs",
          html: ".html",
          css: ".css",
          sql: ".sql",
          json: ".json",
          jsonc: ".jsonc",
        } as Record<string, string>
      )[p.doc.languageId] ||
      ".txt";
    const before = vscode.Uri.from({
      scheme: "pureobom-local-preview",
      path: `/${id}/before${suffix}`,
    });
    const after = vscode.Uri.from({
      scheme: "pureobom-local-preview",
      path: `/${id}/after${suffix}`,
    });
    if (this.previews.size > 20) this.previews.clear();
    this.previews.set(before.toString(), p.original);
    this.previews.set(after.toString(), p.updated);
    await vscode.commands.executeCommand(
      "vscode.diff",
      before,
      after,
      "풀어봄 · 로컬 AI 변경 제안",
      { preview: true },
    );
    this.checked(id, context).reviewed = true;
    return { before: before.toString(), after: after.toString() };
  }
  async apply(
    id: string,
    context: string | undefined,
    acknowledgeUnchecked: unknown,
  ) {
    if (!vscode.workspace.isTrusted)
      throw Error(
        "작업 공간을 신뢰해야 적용할 수 있습니다. / Trust the workspace before applying.",
      );
    const p = this.checked(id, context);
    if (!p.reviewed || !p.result.edits.length)
      throw Error("먼저 코드 차이를 확인하세요. / Review the code diff first.");
    if (p.result.validation.status === "syntax-failed")
      throw Error(
        "문법 오류가 있는 제안은 적용할 수 없습니다. / A syntax-invalid proposal cannot be applied.",
      );
    if (acknowledgeUnchecked !== true)
      throw Error(
        "타입·실행 결과 미검증 여부를 확인하세요. / Acknowledge that type and runtime behavior remain unchecked.",
      );
    const editor = await vscode.window.showTextDocument(p.doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: true,
    });
    const checked = this.checked(id, context);
    const applied = await editor.edit(
      (builder) => {
        for (const edit of checked.result.edits)
          builder.replace(
            new vscode.Range(
              checked.doc.positionAt(edit.start),
              checked.doc.positionAt(edit.end),
            ),
            edit.after,
          );
      },
      { undoStopBefore: true, undoStopAfter: true },
    );
    if (!applied)
      throw Error(
        "편집기에 적용하지 못했습니다. / The editor could not apply the proposal.",
      );
    this.pending = undefined;
    return { applied: true };
  }
  dispose() {
    this.invalidate();
    this.provider.dispose();
    this.previews.clear();
  }
}
