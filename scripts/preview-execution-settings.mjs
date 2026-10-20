// UI-only fixture: callbacks never start a CLI or transmit project source.
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/execution-preview.html",
  `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>구현 설정 화면 검증</title></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ImplementationOptions} from '/src/workspace/ImplementationOptions.tsx';
import {executionKey} from '/src/workspace/execution.ts';
import '/src/workspace/design.css';
const h=React.createElement, root=createRoot(document.getElementById('root'));
const storageKey='pureobom-execution-ui-fixture';
const context={projectKey:'a'.repeat(64),executable:'codex',model:'',manager:'pnpm',scripts:{test:'vitest run',typecheck:'tsc --noEmit',build:'vite build'}};
const empty={schemaVersion:1,projectKey:context.projectKey,revision:0,approval:null};
const state={projectName:'검증용 프로젝트',busy:false,stale:false,trusted:true,notices:[],specs:{schemaVersion:1,specs:[]},selectedId:'system',execution:{context,profile:JSON.parse(localStorage.getItem(storageKey)||'null')||empty}};
let submitted='구현 요청 없음';
function persist(profile){state.execution={...state.execution,profile};localStorage.setItem(storageKey,JSON.stringify(profile));render();}
function render(){root.render(h('main',{className:'design-workspace',style:{display:'block',height:'auto',minHeight:'100vh',padding:24}},
  h('div',{style:{maxWidth:580,margin:'auto'}},h('h1',null,'구현 설정 · 화면 검증'),
  h('p',null,'실제 제품 컴포넌트 + 테스트 전용 응답. 외부 모델·실행기·프로젝트 수정 없음.'),
  h('div',{className:'execution-buttons'},
    h('button',{onClick:()=>{context.scripts.test=context.scripts.test==='vitest run'?'vitest run --coverage':'vitest run';state.connection=undefined;render();}},'검사 명령 변경'),
    h('button',{onClick:()=>{state.notices=[String(Date.now())];render();}},'진행 상태만 갱신'),
    h('button',{onClick:()=>{state.trusted=!state.trusted;render();}},'신뢰 상태 전환')),
  h(ImplementationOptions,{key:executionKey(context)+':'+state.execution.profile.revision,state:{...state},disabled:false,
    onImplement:request=>{submitted=JSON.stringify(request,null,2);render();},actions:{
      saveExecution:async request=>persist({...empty,revision:request.expectedRevision+1,approval:{context:structuredClone(request.context),checks:request.checks,allowExternal:true,savedAt:new Date().toISOString()}}),
      revokeExecution:async request=>persist({...empty,revision:request.expectedRevision+1}),
      checkConnection:async()=>{state.connection={status:'ready',message:'테스트 응답: 연결 상태 표시 확인',provider:'UI fixture'};render();},
    }}),h('pre',{'aria-label':'전달된 구현 요청',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},submitted))));}
render();</script></body></html>`,
);
console.log("UI fixture: /test-results/execution-preview.html (run pnpm dev)");
