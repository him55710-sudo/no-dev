import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Language, Parser } from "web-tree-sitter";
import {
  makeRustPatch,
  parseRust,
  readRustTree,
  RUST_GRAMMAR_VERSION,
} from "../../src/core/rustSource";
import type { SourceFile } from "../../src/core/types";

export type RustAction =
  | { action: "analyze" | "validate" }
  | { action: "patch"; ruleId: string; value: string };
let initialized: Promise<Language> | undefined;
export async function rustSource(
  file: SourceFile,
  action: RustAction,
  assets = join(__dirname, "../runtime/rust"),
) {
  if (!initialized)
    initialized = (async () => {
      await Parser.init({
        wasmBinary: await readFile(join(assets, "web-tree-sitter.wasm")),
      });
      return Language.load(
        await readFile(join(assets, "tree-sitter-rust.wasm")),
      );
    })().catch((error) => {
      initialized = undefined;
      throw error;
    });
  const language = await initialized;
  const parser = new Parser();
  try {
    parser.setLanguage(language);
    if (action.action === "patch")
      return makeRustPatch(file, parser, action.ruleId, action.value);
    const tree = parseRust(parser, file.content);
    try {
      const analysis = readRustTree(file, tree);
      if (action.action === "validate")
        return {
          status: analysis.syntaxValid ? "syntax-passed" : "syntax-failed",
          detail: analysis.syntaxValid
            ? `${RUST_GRAMMAR_VERSION}: Rust 문법 파싱 통과. 컴파일·타입·소유권·매크로·cfg·동작·성능은 미검증입니다. / Rust syntax parsed; compilation, types, ownership, macros, cfg, behavior and performance unchecked.`
            : analysis.issues
                .map((issue) => `${issue.detail.ko} / ${issue.detail.en}`)
                .join("\n"),
        };
      return analysis;
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}
