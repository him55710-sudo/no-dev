// Local visual verification harness. All nodes are analyzed from fixture source files.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
const directory = "examples/system-workspace";
const files = [];
async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await visit(child);
    else files.push({ path: relative(directory, child).replaceAll("\\", "/"), content: await readFile(child, "utf8") });
  }
}
await visit(directory);
await mkdir("test-results", { recursive: true });
await writeFile("test-results/design-preview.html", `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>풀어봄 시스템 설계 검증</title></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import {DesignWorkspaceView} from '/src/workspace/DesignWorkspaceView.tsx';
import {analyzeStructure} from '/src/workspace/analyze.ts';
import {draftSpec,saveSpec,specDocumentSchema} from '/src/workspace/spec.ts';
const files=${JSON.stringify(files).replaceAll("<", "\\u003c")};
const graph=await analyzeStructure(files);
const saved=localStorage.getItem('pureobom-design-visual-check');
const state={projectName:'Project Studio',selectedId:'system',busy:false,stale:false,trusted:true,graph,specs:saved?specDocumentSchema.parse(JSON.parse(saved)):{schemaVersion:1,specs:[]},notices:[]};
const root=createRoot(document.getElementById('root'));
function render(){root.render(React.createElement(DesignWorkspaceView,{state:{...state},actions:{refresh:async()=>{state.graph=await analyzeStructure(files);render();},source:async(id,index)=>{const target=graph.nodes.find(n=>n.id===id)??graph.edges.find(e=>e.id===id);const ref=target.sources[index];alert(ref.path+':'+ref.line+'\\n\\n'+files.find(f=>f.path===ref.path).content.slice(ref.start,ref.end));},save:async(targetIds,content,revision)=>{const draft=draftSpec(graph,targetIds);const existing=state.specs.specs.find(s=>s.id===draft.id);state.specs=saveSpec(state.specs,{...(existing??draft),content},revision);localStorage.setItem('pureobom-design-visual-check',JSON.stringify(state.specs));render();return state.specs.specs.find(s=>s.id===draft.id);}}}));}
render();</script></body></html>`);
console.log("Preview prepared at /test-results/design-preview.html; start the Vite server to inspect it.");
