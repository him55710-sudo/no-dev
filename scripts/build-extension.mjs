import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("extension/out", { recursive: true });
const common = {
  bundle: true,
  sourcemap: false,
  logLevel: "info",
  metafile: true,
};
const results = await Promise.all([
  build({
    ...common,
    entryPoints: ["extension/ui/design.tsx"],
    outfile: "extension/media/design.js",
    platform: "browser",
    format: "iife",
    target: "chrome120",
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  build({
    ...common,
    entryPoints: ["extension/src/extension.ts"],
    outfile: "extension/out/extension.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  }),
  build({
    ...common,
    entryPoints: ["extension/src/worker.ts"],
    outfile: "extension/out/worker.cjs",
    platform: "node",
    // jsonc-parser's UMD entry hides relative requires from the bundler.
    mainFields: ["module", "main"],
    format: "cjs",
    target: "node20",
    minify: true,
  }),
  build({
    ...common,
    entryPoints: ["extension/ui/main.tsx"],
    outfile: "extension/media/view.js",
    platform: "browser",
    format: "iife",
    target: "chrome120",
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  build({
    ...common,
    entryPoints: ["extension/test/integration.ts"],
    outfile: "extension/out/integration.cjs",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  }),
]);
const inputs = [
  ...new Set(
    results
      .filter(
        (result) =>
          !Object.keys(result.metafile.outputs).some((path) =>
            path.endsWith("integration.cjs"),
          ),
      )
      .flatMap((result) =>
        Object.values(result.metafile.outputs).flatMap((output) =>
          Object.entries(output.inputs)
            .filter(([, input]) => input.bytesInOutput > 0)
            .map(([path]) => path),
        ),
      ),
  ),
].sort();
await writeFile(
  "extension/out/bundle-inputs.json",
  JSON.stringify(inputs, null, 2) + "\n",
);
