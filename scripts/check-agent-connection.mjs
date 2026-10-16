import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir("test-results", { recursive: true });
const path = resolve("test-results/app-server-check.mjs");
await build({
  entryPoints: ["extension/src/agent/appServer.ts"],
  outfile: path,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});
const { CodexAppServer } = await import(pathToFileURL(path).href);
const server = new CodexAppServer({
  executable: process.env.PUREOBOM_CODEX_PATH || "codex",
  cwd: process.cwd(),
});
try {
  const connection = await server.start();
  const account = await server.account();
  const report = {
    checkedAt: new Date().toISOString(),
    ...connection,
    ...account,
    inferenceRun: false,
  };
  await writeFile(
    "test-results/agent-connection.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await server.close();
}
