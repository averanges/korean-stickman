import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {SttServers,ServerChecks,STT_SERVERS,AMVERA_API_BASE_URL} from '../src/stt-servers.js';import {SttConnection,SERVER_ORDER} from '../src/stt-connection.js';import {FailoverSttProvider} from '../src/stt-failover.js';import {RoutedSttProvider} from '../src/routed-stt.js';import {VoiceDiagnostics} from '../src/voice-diagnostics.js';import {buildPages} from '../scripts/build-pages.mjs';
const health=(extra={})=>({ok:true,source:'amvera-proxy',version:'1.0.0',upstream:{reachable:true,sttReady:true,httpStatus:200,...extra},limits:{maxAudioBytes:4000000}}),response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const entries=()=>STT_SERVERS.map(e=>({...e,url:`https://${e.id}.example.com`}));
const make=(fetcher)=>new SttConnection(new SttServers(entries()),{storage:null,windowMs:2,selectionMs:50,probeMs:50,fetcher});
const standard=id=>({ok:true,configured:true,apiVersion:'1',platform:id,version:'3.0.0'}),idOf=url=>new URL(url).hostname.split('.')[0];
const blob=()=>new Blob([Buffer.alloc(256)],{type:'audio/webm;codecs=opus'}),options=()=>({durationMs:2000,language:'ko',signal:new AbortController().signal,onStage(){}});

test('fourth Amvera entry is manual-only and uses the specified public endpoint and conservative limits',()=>{
 const registry=new SttServers();assert.deepEqual(registry.entries.map(e=>e.id),['render','netlify','vercel','amvera']);assert.equal(registry.get('amvera').manualOnly,true);assert.equal(registry.endpoint('amvera','transcribe'),AMVERA_API_BASE_URL+'/transcribe');assert.equal(registry.limits('amvera').maxAudioBytes,4000000);assert.equal(registry.limits('amvera').maxDurationMs,300000);assert.deepEqual(SERVER_ORDER,['render','vercel','netlify']);
});
test('Amvera health adapter reads upstream readiness, records diagnostics, and never relaxes other contracts',async()=>{
 const registry=new SttServers(entries());const checks=new ServerChecks(registry,{fetcher:async()=>response(health())});await checks.probe('amvera');assert.equal(checks.rows.get('amvera').configured,true);assert.equal(checks.rows.get('amvera').platform,'amvera');assert.equal(checks.rows.get('amvera').llmEnabled,false);assert.ok(checks.report().includes('sttReady=true'));assert.ok(checks.report().includes('Только ручной выбор'));
 for(const upstream of [{sttReady:false},{reachable:false,sttReady:false,error:'upstream-network',httpStatus:null},{httpStatus:503,sttReady:false},{httpStatus:503}]){checks.fetcher=async()=>response(health(upstream));await checks.probe('amvera');assert.equal(checks.rows.get('amvera').state,'ok');assert.equal(checks.rows.get('amvera').configured,false);}
 checks.fetcher=async()=>response(health({error:'upstream-network',sttReady:false}));await checks.probe('amvera');assert.ok(checks.report().includes('error=upstream-network'));
 await checks.probe('vercel');assert.equal(checks.rows.get('vercel').error,'invalid-response');
 for(const data of [{ok:true},standard('vercel'),{...health(),source:'unknown'},health({sttReady:'true'})]){checks.fetcher=async()=>response(data);await checks.probe('amvera');assert.equal(checks.rows.get('amvera').error,'invalid-response');}
});
test('manual Amvera is usable only when its upstream STT is ready',async()=>{
 for(const ready of [true,false]){const c=make(async url=>response(idOf(url)==='amvera'?health({sttReady:ready}):standard(idOf(url))));c.setMode('amvera');assert.equal(await c.check(),ready);assert.equal(c.ready,ready);if(ready)assert.equal(c.registry.selected,'amvera');}
});
test('healthy Amvera is never selected automatically, including remembered manual success',async()=>{
 const stored=[];const c=make(async url=>{if(idOf(url)!=='amvera')throw Error('offline');return response(health());});c.storage={setItem:(...v)=>stored.push(v)};c.success('amvera');assert.equal(c.lastSuccess,null);assert.equal(stored.length,0);c.lastSuccess='amvera';c.setMode('auto');assert.equal(await c.check(),false);assert.equal(c.ready,false);
});
test('automatic audio attempts exclude previously selected Amvera and exhaust only the original three servers',async()=>{
 const c=make(async url=>response(idOf(url)==='amvera'?health():standard(idOf(url))));c.registry.select('amvera');const calls=[];const p=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(){calls.push(id);throw Object.assign(Error('network'),{code:'network'});}})});await assert.rejects(p.transcribe(blob(),options()));assert.deepEqual(calls,['render','vercel','netlify']);
});
test('manual Amvera sends one unchanged recording to /transcribe and accepts the preserved Vercel contract',async()=>{
 const c=make(async()=>response(health()));c.setMode('amvera');await c.check();const calls=[],audio=blob(),diagnostics=new VoiceDiagnostics();const p=new FailoverSttProvider(c,{fetcher:async(url,request)=>{calls.push({url,request});return response({ok:true,apiVersion:'1',platform:'vercel',version:'3.0.0',text:'안녕하세요'});}});const result=await p.transcribe(audio,{...options(),onStage:(stage,data)=>diagnostics.stage(stage,data)});assert.equal(result.text,'안녕하세요');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://amvera.example.com/transcribe');assert.equal(calls[0].request.body,audio);assert.equal(calls[0].request.headers['Content-Type'],audio.type);assert.ok(diagnostics.report().includes('Amvera'));assert.ok(diagnostics.report().includes('/transcribe'));
});
test('Amvera proxy errors keep exact code, source and HTTP status in diagnostics; no manual failover',async()=>{
 for(const [code,status] of [['upstream-network',502],['upstream-invalid-response',502],['timeout',504],['busy',429]]){const c=make(async()=>response(health()));c.setMode('amvera');await c.check();let calls=0;const diagnostics=new VoiceDiagnostics();const p=new FailoverSttProvider(c,{fetcher:async()=>{calls++;return response({ok:false,error:code,source:'amvera-proxy'},status);}});await assert.rejects(p.transcribe(blob(),{...options(),onStage:(stage,data)=>diagnostics.stage(stage,data)}),e=>{diagnostics.stage('error',{error:e.code,httpStatus:e.httpStatus,source:e.source});return e.code===code&&e.httpStatus===status&&e.source==='amvera-proxy';});assert.equal(calls,1);assert.ok(diagnostics.report().includes(code));assert.ok(diagnostics.report().includes('amvera-proxy'));assert.ok(diagnostics.report().includes('Amvera'));}
});
test('deferred manual Amvera cannot resume after returning to auto',()=>{const c=make();c.mode='amvera';c.deferred='amvera';assert.equal(c.setMode('auto'),true);assert.equal(c.deferred,null);c.deferred='amvera';c.checks.rows.set('amvera',{state:'ok',configured:true,apiVersion:'1'});c.resume();assert.notEqual(c.registry.selected,'amvera');});
test('Pages build defaults or explicitly overrides only the public Amvera address',async()=>{
 for(const amveraBase of [AMVERA_API_BASE_URL,'https://other.amvera.tech','']){const output=await mkdtemp(path.join(tmpdir(),'stickman-amvera-'));await buildPages({apiBase:'https://render.example.com',amveraBase,output});const source=await readFile(path.join(output,'src/stt-servers.js'),'utf8');assert.ok(source.includes(`AMVERA_API_BASE_URL=${JSON.stringify(amveraBase)}`));}
 await assert.rejects(buildPages({apiBase:'https://render.example.com',amveraBase:'https://example.com/secret',output:await mkdtemp(path.join(tmpdir(),'stickman-amvera-invalid-'))}));
});
