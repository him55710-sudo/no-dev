import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
await mkdir("test-results/project-reader",{recursive:true});
const entry=resolve("test-results/project-reader/narrator.mjs");
await build({entryPoints:["extension/src/projectNarrator.ts"],outfile:entry,bundle:true,platform:"node",format:"esm",target:"node24"});
const {ProjectNarrator}=await import(pathToFileURL(entry).href);
const paths = process.argv.slice(2);
if (!paths.length) paths.push("src/core/beginnerGuide.ts");
const files=await Promise.all(paths.map(async path=>({path,content:await readFile(path,"utf8")})));
const narrator=new ProjectNarrator({executable:process.env.PUREOBOM_CODEX_PATH||"codex",cwd:process.cwd(),cache:resolve("test-results/project-reader/cache")});
const start=Date.now();
try {
 const story=await narrator.explain(files,"live-smoke",new AbortController().signal,progress=>console.log(JSON.stringify(progress)));
 await writeFile("test-results/project-reader/live-summary.json",JSON.stringify({inferenceRun:true,provider:"authenticated Codex app-server",elapsedMs:Date.now()-start,story},null,2));
 console.log(JSON.stringify({title:story.title,summary:story.summary,fileCount:story.files.length,inferenceRun:true}));
} catch(error){console.error(error);process.exitCode=1;}
