import test from 'node:test';
import assert from 'node:assert/strict';
import {SttConnection} from '../src/stt-connection.js';
import {FailoverSttProvider,shouldFailover} from '../src/stt-failover.js';
import {SttServers} from '../src/stt-servers.js';
import {SpeechError,HttpSttProvider} from '../src/stt-client.js';
import {BrowserSpeech} from '../src/speech.js';
const flush=()=>new Promise(r=>setImmediate(r));
const entries=()=>['render','vercel','netlify'].map(id=>({id,label:id,platform:id,url:`https://${id}.example.com`,enabled:true}));
const health=(id,extra={})=>({ok:true,configured:true,apiVersion:'1',version:'2.7.0',platform:id,...extra});
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});
const idOf=url=>new URL(url).hostname.split('.')[0];
const options=()=>({durationMs:6000,language:'ru',operationId:'test-voice',onStage(){},signal:new AbortController().signal});
const clip=()=>new Blob([Buffer.alloc(200)],{type:'audio/webm'});
function connection(extra={}){return new SttConnection(new SttServers(entries()),{storage:null,windowMs:5,selectionMs:40,probeMs:40,fetcher:async url=>response(health(idOf(url))),...extra});}
test('startup checks all endpoints in parallel, Render wins; no checks before each transcription',async()=>{
 const urls=[],c=connection({fetcher:async url=>{urls.push(url);return response(health(idOf(url)));}});assert.equal(await c.check(),true);assert.equal(c.registry.selected,'render');assert.equal(urls.length,3);
 const p=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(){return {text:'Привет'};}})});await p.transcribe(clip(),options());await p.transcribe(clip(),options());assert.equal(urls.length,3);
});
test('slow Render does not block fallback selection and late health never switches back',async()=>{
 let resolveRender;const c=connection({selectionMs:1000,probeMs:1000,fetcher:async url=>idOf(url)==='render'?new Promise(r=>resolveRender=r):response(health(idOf(url)))});assert.equal(await c.check(),true);assert.equal(c.registry.selected,'vercel');resolveRender(response(health('render')));await c.checks.pending;assert.equal(c.registry.selected,'vercel');
});
test('Netlify is selected when Render and Vercel fail; all failures and incompatible API disable voice',async()=>{
 const c=connection({fetcher:async url=>{if(idOf(url)!=='netlify')throw Error('offline');return response(health('netlify'));}});assert.equal(await c.check(),true);assert.equal(c.registry.selected,'netlify');
 for(const fetcher of [async()=>{throw Error('offline');},async url=>response(health(idOf(url),{apiVersion:'2'})),async url=>response(health(idOf(url),{configured:false})),async()=>({status:200,ok:true,json:async()=>{throw Error('html');}})]){const unavailable=connection({fetcher});assert.equal(await unavailable.check(),false);assert.equal(unavailable.ready,false);assert.equal(unavailable.state,'error');}
});
test('last successful server is persisted, checked again and Render can return next session',async()=>{
 const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};const a=connection({storage});a.success('netlify');const b=connection({storage,fetcher:async url=>{if(idOf(url)==='render')throw Error('offline');return response(health(idOf(url)));}});assert.equal(b.lastSuccess,'netlify');await b.check();assert.equal(b.registry.selected,'netlify');const next=connection({storage});await next.check();assert.equal(next.registry.selected,'render');
 const denied=connection({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});await denied.check();assert.doesNotThrow(()=>denied.success('vercel'));
});
test('selection is deferred while an existing game operation runs and idle checks are bounded',async()=>{
 let busy=false;const c=connection({isBusy:()=>busy});const pending=c.check();busy=true;assert.equal(await pending,false);assert.equal(c.state,'connecting');busy=false;c.resume();assert.equal(c.ready,true);busy=true;assert.equal(await c.check(),true);assert.equal(c.setMode('vercel'),false);busy=false;await c.checkAfterIdle();assert.equal(c.ready,true);
});
test('technical failure forwards identical audio sequentially, remembers success; at most three attempts',async()=>{
 const c=connection();await c.check();let active=0,maximum=0;const seen=[],audio=clip(),o=options();const p=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(blob,opts){active++;maximum=Math.max(maximum,active);seen.push({id,blob,language:opts.language,operationId:opts.operationId});await flush();active--;if(id==='render')throw new SpeechError('server-error',{httpStatus:500});return {text:'Привет'};}})});assert.equal((await p.transcribe(audio,o)).text,'Привет');assert.equal(maximum,1);assert.deepEqual(seen.map(s=>s.id),['render','vercel']);assert.ok(seen.every(s=>s.blob===audio&&s.language==='ru'&&s.operationId===o.operationId));assert.equal(c.registry.selected,'vercel');seen.length=0;await p.transcribe(audio,o);assert.deepEqual(seen.map(s=>s.id),['vercel']);
 const fail=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(){seen.push({id});throw new SpeechError('timeout');}})});seen.length=0;await assert.rejects(fail.transcribe(audio,o),e=>e.exhausted&&e.attemptCount===3);assert.deepEqual(seen.map(s=>s.id),['vercel','render','netlify']);
});
test('Groq 429/key errors, unclear speech, validation and game errors never trigger fallback',async()=>{
 for(const [code,httpStatus] of [['rate-limit',429],['provider-auth',502],['unclear',422],['unknown-command',undefined],['game-error',500],['unsupported-format',415],['invalid-language',422],['too-large',413],['service-unavailable',403]]){
  let count=0;const c=connection();const p=new FailoverSttProvider(c,{providerFactory:()=>({async transcribe(){count++;throw new SpeechError(code,{httpStatus});}})});await assert.rejects(p.transcribe(clip(),options()),e=>e.code===code);assert.equal(count,1,code);
 }
 assert.equal(shouldFailover(new SpeechError('service-unavailable',{httpStatus:503})),true);assert.equal(shouldFailover(new SpeechError('invalid-response',{httpStatus:200})),true);
});
test('manual selection forces one server and incompatible backup limits skip requests without clipping',async()=>{
 const c=connection();c.setMode('netlify');c.registry.select('netlify');let seen=[];const p=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(){seen.push(id);throw new SpeechError('network');}})});await assert.rejects(p.transcribe(clip(),options()));assert.deepEqual(seen,['netlify']);
 c.setMode('auto');c.registry.select('render');seen=[];await assert.rejects(p.transcribe(new Blob([Buffer.alloc(4000001)],{type:'audio/webm'}),options()),e=>e.code==='no-compatible-server'&&e.exhausted&&e.attemptCount===1);assert.deepEqual(seen,['render']);
 seen=[];await assert.rejects(p.transcribe(clip(),{...options(),durationMs:300001}),e=>e.code==='no-compatible-server');assert.deepEqual(seen,['render']);
});
test('actual HTTP client fails over on malformed successful API contract and ignores late timed-out response',async()=>{
 const c=connection();let late;const urls=[];const p=new FailoverSttProvider(c,{timeoutMs:5,fetcher:async url=>{urls.push(url);return idOf(url)==='render'?new Promise(r=>late=r):response({ok:true,apiVersion:'1',platform:idOf(url),text:'Привет'});}});assert.equal((await p.transcribe(clip(),options())).text,'Привет');late(response({ok:true,apiVersion:'1',platform:'render',text:'wrong late result'}));await flush();assert.equal(c.registry.selected,'vercel');assert.equal(urls.length,2);
 c.registry.select('render');urls.length=0;p.fetcher=async url=>{urls.push(url);return idOf(url)==='render'?response({text:'malformed'}):response({ok:true,apiVersion:'1',platform:idOf(url),text:'Привет'});};assert.equal((await p.transcribe(clip(),options())).text,'Привет');assert.equal(urls.length,2);
});
function recorderHarness({provider,onFinal,withoutAnalysis=false}={}){
 let time=0,tick,volume=.03,stopped=0,closed=0,streams=0;const levels=[],errors=[];
 class Recorder{static isTypeSupported(){return true;}constructor(_,opts){this.mimeType=opts.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([Buffer.alloc(200)])});this.onstop?.();});}}
 class Context{resume(){}close(){closed++;}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {getFloatTimeDomainData:out=>out.fill(volume)};}}
 const speech=new BrowserSpeech({onFinal,onLevel:(v,d)=>levels.push({v,...d}),onError:e=>errors.push(e)},{provider,Recorder,AudioContext:withoutAnalysis?null:Context,navigator:{mediaDevices:{async getUserMedia(){streams++;return {getTracks:()=>[{stop(){stopped++;},addEventListener(){}}]};}}},now:()=>time,schedule:fn=>{tick=fn;return 1;},unschedule:()=>tick=null});
 return {speech,levels,errors,stats:()=>({stopped,closed,streams,ticking:Boolean(tick)}),advance(ms,v){volume=v;for(let n=0;n<ms;n+=50){time+=50;tick?.();}}};
}
test('microphone meter follows actual RMS, silence decays without ending capture and resources are released',async()=>{
 let calls=0;const h=recorderHarness({provider:{async transcribe(){calls++;return {text:'안녕하세요'};}}});await h.speech.start();h.advance(1000,.01);const quiet=h.levels.at(-1).v;h.advance(1000,.1);assert.ok(h.levels.at(-1).v>quiet);h.advance(4000,0);assert.ok(h.levels.at(-1).v<.001);assert.equal(h.speech.recording,true);assert.equal(calls,0);assert.equal(h.stats().streams,1);h.speech.stop();await flush();assert.equal(calls,1);assert.equal(h.stats().stopped,1);assert.equal(h.stats().closed,1);assert.equal(h.stats().ticking,false);assert.equal(h.levels.at(-1).active,false);
 const fallback=recorderHarness({withoutAnalysis:true,provider:{async transcribe(){return {text:'안녕하세요'};}}});assert.equal(fallback.speech.supported,true);await fallback.speech.start();fallback.advance(1000,0);fallback.speech.stop();await flush();assert.equal(fallback.errors.length,0);assert.equal(fallback.stats().stopped,1);
});
test('one operation applies once after fallback; retry retains ID and cancel/new recording discard stale response',async()=>{
 const c=connection();let late,count=0,transcriptions=0;const p=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(){transcriptions++;if(id==='render')throw new SpeechError('network');return {text:'안녕하세요'};}})});
 const h=recorderHarness({provider:p,onFinal:()=>{count++;return {ok:true};}});await h.speech.start();h.advance(1000,.03);h.speech.stop();await flush();await flush();assert.equal(count,1);assert.equal(transcriptions,2);
 let sent=[];h.speech.provider={async transcribe(audio,o){sent.push({audio,id:o.operationId});if(sent.length===1)throw new SpeechError('network');return {text:'안녕하세요'};}};await h.speech.start();h.advance(1000,.03);h.speech.stop();await flush();const pending=h.speech.pending;assert.ok(pending.operationId);await h.speech.retry();assert.equal(sent[0].audio,sent[1].audio);assert.equal(sent[0].id,sent[1].id);assert.equal(count,2);
 h.speech.provider={transcribe:()=>new Promise(r=>late=r)};await h.speech.start();h.advance(1000,.03);h.speech.stop();await flush();h.speech.cancel();await h.speech.start();late({text:'stale'});await flush();assert.equal(count,2);assert.equal(h.speech.recording,true);h.speech.cancel();assert.equal(h.stats().ticking,false);
});
test('cancellation aborts even a hanging transport without trying another server',async()=>{
 let calls=0;const c=connection(),abort=new AbortController(),p=new FailoverSttProvider(c,{fetcher:()=>{calls++;return new Promise(()=>{});}});const result=p.transcribe(clip(),{...options(),signal:abort.signal});abort.abort();await assert.rejects(result,e=>e.name==='AbortError');assert.equal(calls,1);
});

test('two automatic backup requests are a lifetime budget for the retained recording, not reset by manual retry',async()=>{
 const c=connection(),seen=[],audio=clip(),p=new FailoverSttProvider(c,{providerFactory:id=>({async transcribe(){seen.push(id);throw new SpeechError('network');}})});
 await assert.rejects(p.transcribe(audio,options()),e=>e.exhausted&&e.attemptCount===3);assert.equal(seen.length,3);await assert.rejects(p.transcribe(audio,options()),e=>e.exhausted&&e.attemptCount===1);assert.equal(seen.length,4);await assert.rejects(p.transcribe(clip(),options()),e=>e.attemptCount===3);assert.equal(seen.length,7);
});
test('primary validation failure and malformed HTTP 400 never start reserve requests',async()=>{
 const c=connection();c.registry.select('vercel');let calls=0;const p=new FailoverSttProvider(c,{providerFactory:()=>({async transcribe(){calls++;return {text:'Привет'};}})});await assert.rejects(p.transcribe(new Blob([Buffer.alloc(4000001)]),options()),e=>e.code==='too-large');assert.equal(calls,0);assert.equal(shouldFailover(new SpeechError('invalid-response',{httpStatus:400})),false);
});
