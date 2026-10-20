import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";

// Visual component fixture only: no VS Code host or model execution.
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/scope-controls.html",
  `<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"><title>풀어봄 코드 선택 목록 검증</title></head>
<body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FeatureEditor} from '/src/workspace/FeatureEditor.tsx';
import {analyzeStructure} from '/src/workspace/analyze.ts';
import '/src/workspace/design.css';
const files=[
 {path:'policy.ts',content:"export function canEdit(role:string){return role==='owner';}"},
 {path:'services/project-members/update-project-permissions.ts',content:"import {canEdit} from '../../policy'; export function update(role:string){return canEdit(role);}"},
 {path:'ui/EditButton.tsx',content:"import {canEdit} from '../policy'; export function EditButton(){return <button disabled={!canEdit('viewer')}>Edit</button>;}"},
 {path:'test.ts',content:"import {canEdit} from './policy'; console.assert(!canEdit('viewer'));"}
];
const graph=await analyzeStructure(files);
const initialIds=[graph.nodes.find(n=>n.kind==='file'&&n.label==='policy.ts').id];
function Panel({width}) {
 const [saved,setSaved]=React.useState('');
 return React.createElement('section',{style:{width,flex:'none',border:'1px solid #aab',background:'var(--design-panel)'}},
   React.createElement('h2',null,width+'px 설계 패널'),
   React.createElement(FeatureEditor,{graph,initialIds,disabled:false,save:async request=>{setSaved(request.title+' · '+request.memberIds.length+'개 연결');},close:()=>{}}),
   React.createElement('p',{role:'status'},saved));
}
createRoot(document.getElementById('root')).render(React.createElement('main',null,
 React.createElement('h1',null,'실제 컴포넌트의 코드 선택 목록'),
 React.createElement('p',null,'브라우저 시각 검사. 설치된 VS Code 및 사람의 사용성 검증과 별개입니다.'),
 React.createElement('div',{style:{display:'flex',gap:24,alignItems:'start'}},
   React.createElement(Panel,{width:320}),React.createElement(Panel,{width:380}))));
</script></body></html>`,
);
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
console.log(`${server.resolvedUrls.local[0]}test-results/scope-controls.html`);
