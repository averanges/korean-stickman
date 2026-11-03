import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {SttExperiment} from '../src/stt-experiment.js';import {createFunction} from '../server/functions.mjs';

test('session comparison history retains references locally, flags unexpected keywords, stays bounded and clearable',async()=>{
 const hash='b'.repeat(64),requests=[];const e=new SttExperiment({endpoint:()=>'/api/stt-experiment',digest:async()=>hash,fetcher:async(_,o)=>{requests.push(o);const id=o.headers['X-STT-Experiment'];return {ok:true,status:200,json:async()=>({ok:true,experimentVersion:'3.0.2',provider:['A','B'].includes(id)?'groq':'openai',model:['A','B'].includes(id)?'whisper-large-v3':'gpt-transcribe',variant:id,text:'공책이 있어요',sha256:hash})};}});const clip={audio:new Blob([Buffer.alloc(256)],{type:'audio/webm'}),durationMs:1000,language:'ko'};
 for(let n=0;n<22;n++)await e.run(clip,{reference:'책이 있어요'});assert.equal(e.history.length,20);assert.deepEqual(e.history[0].rows[0].extraKeywords,['공책']);assert.ok(requests.every(o=>!o.headers.reference&&!('reference'in o)));e.clear({keepHistory:true});assert.equal(e.history.length,20);e.clear();assert.equal(e.history.length,0);
});
test('actual Vercel experiment entry exposes native route and CORS without leaking missing keys',async()=>{
 const previous={};for(const k of ['API_PUBLIC_ORIGIN','FRONTEND_ORIGIN','GROQ_API_KEY','OPENAI_API_KEY'])previous[k]=process.env[k];
 try{Object.assign(process.env,{API_PUBLIC_ORIGIN:'https://fixture.vercel.app',FRONTEND_ORIGIN:'https://averanges.github.io',GROQ_API_KEY:'private',OPENAI_API_KEY:''});const {default:entry}=await import('../api/stt-experiment.js');const headers={Origin:process.env.FRONTEND_ORIGIN,'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1000','X-STT-Experiment':'C'};const r=await entry.fetch(new Request('https://fixture.vercel.app/api/stt-experiment',{method:'POST',headers,body:Buffer.alloc(256)}));assert.equal(r.status,503);const d=await r.json();assert.equal(d.error,'openai-not-configured');assert.equal(d.model,'gpt-transcribe');assert.equal(r.headers.get('Access-Control-Allow-Origin'),headers.Origin);}
 finally{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('experiment UI and capture controller never import game interpretation; production paths do not use experiment header',async()=>{
 const source=await readFile(new URL('../src/stt-experiment.js',import.meta.url),'utf8');assert.ok(!/language-service|room-state|controller.js|\/interpret['"]/.test(source));const ordinary=await readFile(new URL('../src/stt-client.js',import.meta.url),'utf8');assert.ok(!ordinary.includes('X-STT-Experiment'));const html=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.ok(html.includes('id="experiment-capture-only" type="checkbox"'));assert.ok(!html.includes('id="experiment-capture-only" type="checkbox" checked'));
});

test('disconnect cancels an experiment backend slot immediately, independent of STT',async()=>{
 const {createSttExperiment}=await import('../server/stt-experiment.mjs');const {SttGate}=await import('../server/security.mjs');const gate=new SttGate({maximum:1});let ready;const begun=new Promise(r=>ready=r),cancel=new AbortController();const endpoint=createSttExperiment({config:async()=>({key:'private'}),gate,providerFactory:()=>({async transcribe(){ready();return new Promise(()=>{});}})});
 const work=endpoint({headers:{'x-stt-experiment':'A','content-type':'audio/webm','x-audio-duration-ms':'1000'},signal:cancel.signal,readBody:async()=>Buffer.alloc(256)},(status,data)=>({status,data}));await begun;assert.equal(gate.active,1);cancel.abort();assert.equal((await work).status,408);assert.equal(gate.active,0);
});
