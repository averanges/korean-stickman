import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createFunction} from '../server/functions.mjs';
import {createSttApi} from '../server/api.mjs';
import {readStream} from '../server/http-adapters.mjs';
import {SttError} from '../server/stt.mjs';
import {SttGate} from '../server/security.mjs';
import {STT_POLICIES} from '../src/stt-limits.js';
import {SttServers,ServerChecks,publicOrigin} from '../src/stt-servers.js';
import {RoutedSttProvider} from '../src/routed-stt.js';
import {createDiagnosticSpeech} from '../src/stt-diagnostic.js';
import {VoiceDiagnostics} from '../src/voice-diagnostics.js';
import {buildPages} from '../scripts/build-pages.mjs';
const origin='https://averanges.github.io',url='https://example.netlify.app';
const headers={Origin:origin,'Content-Type':'audio/webm;codecs=opus','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'6000'};
const health=(platform='render')=>({ok:true,status:'ready',configured:true,apiVersion:'1',version:'2.7.0',platform,limits:STT_POLICIES[platform]});
const response=data=>({ok:true,status:200,json:async()=>data});
const entries=()=>['render','netlify','vercel'].map(id=>({id,label:id,platform:id,url:`https://${id}.example.com`,enabled:true}));
const flush=()=>new Promise(r=>setImmediate(r));
for(const platform of ['netlify','vercel'])test(platform+' Web adapter preserves complete ko/ru binary audio and shared contract, no health STT',async()=>{
 const calls=[],env={API_PUBLIC_ORIGIN:url,FRONTEND_ORIGIN:origin,GROQ_API_KEY:'test-private-key'};
 const handler=createFunction(platform,{env,providerFactory:settings=>({async transcribe(audio,mime,options){assert.equal(settings.key,'test-private-key');calls.push({audio,mime,language:options.language});return {text:options.language==='ru'?'Создай стол':'책상이 있어요'};}})});
 let r=await handler(new Request(url+'/health',{headers:{Origin:origin}}));assert.equal(r.status,200);const status=await r.json();assert.equal(status.platform,platform);assert.equal(status.apiVersion,'1');assert.equal(status.configured,true);assert.equal(calls.length,0);assert.ok(!JSON.stringify(status).includes('test-private-key'));
 const bytes=Buffer.from('begin|four seconds silence|end'.repeat(20));
 for(const language of ['ko','ru']){r=await handler(new Request(url+'/transcribe',{method:'POST',headers:{...headers,'X-STT-Language':language},body:bytes}));assert.equal(r.status,200);const d=await r.json();assert.equal(d.ok,true);assert.equal(d.language,language);assert.deepEqual(calls.at(-1).audio,bytes);assert.equal(calls.at(-1).mime,'audio/webm;codecs=opus');}
 r=await handler(new Request(url+'/api/stt/status',{headers:{Origin:origin}}));assert.equal(r.status,200);
 r=await handler(new Request(url+'/api/stt',{method:'POST',headers,body:bytes}));assert.equal(r.status,200);assert.equal(calls.length,3);
 r=await handler(new Request(url+'/transcribe',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-requested-with,x-audio-duration-ms,x-stt-language'}}));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);
 for(const address of ['https://evil.example','https://averanges.github.io.evil.example']){r=await handler(new Request(url+'/health',{headers:{Origin:address}}));assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);}
 r=await handler(new Request(url+'/transcribe',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'}}));assert.equal(r.status,403);
});
test('function policies reject oversize, long duration, unsupported MIME/language and missing config before Groq',async()=>{
 let calls=0;const env={URL:url,FRONTEND_ORIGIN:origin,GROQ_API_KEY:'secret'},handler=createFunction('netlify',{env,providerFactory:()=>({transcribe(){calls++;return {text:'안녕하세요'};}})});
 for(const [extra,body,status,code] of [[{},Buffer.alloc(4000001),413,'too-large'],[{'X-Audio-Duration-Ms':'300001'},Buffer.alloc(200),413,'too-long'],[{'Content-Type':'text/plain'},Buffer.alloc(200),415,'unsupported-format'],[{'X-STT-Language':'en'},Buffer.alloc(200),422,'invalid-language'],[{},Buffer.alloc(10),422,'empty-audio']]){const r=await handler(new Request(url+'/transcribe',{method:'POST',headers:{...headers,...extra},body}));assert.equal(r.status,status);assert.equal((await r.json()).error,code);assert.equal(r.headers.get('access-control-allow-origin'),origin);}
 env.GROQ_API_KEY='';const r=await handler(new Request(url+'/transcribe',{method:'POST',headers,body:Buffer.alloc(200)}));assert.equal(r.status,503);assert.equal((await r.json()).error,'not-configured');assert.equal(calls,0);
});
test('shared timeout, Groq errors and rate limits retain safe metadata and release concurrency',async()=>{
 const gate=new SttGate({maximum:1}),common={platform:'vercel',origins:[url],frontends:[origin],config:async()=>({key:'private'}),limits:{...STT_POLICIES.vercel,timeoutMs:8},gate},request={method:'POST',path:'/transcribe',headers:{host:new URL(url).host,origin,'content-type':'audio/webm','x-requested-with':'KoreanStickman','x-audio-duration-ms':'1000'},readBody:async()=>Buffer.alloc(200)};
 let entered;const started=new Promise(resolve=>entered=resolve);const hanging=createSttApi({...common,providerFactory:()=>({transcribe:()=>{entered();return new Promise(()=>{});}})});const pending=hanging(request);await started;assert.equal((await hanging(request)).status,429);const timeout=await pending;assert.equal(timeout.status,504);assert.equal(JSON.parse(timeout.body).error,'timeout');assert.equal(gate.active,0);
 const failure=createSttApi({...common,providerFactory:()=>({transcribe(){throw new SttError('provider-auth',502,'Groq');}})});const r=await failure(request);assert.equal(JSON.parse(r.body).source,'Groq');assert.ok(!r.body.includes('private'));assert.equal(gate.active,0);
 const broken=createSttApi({...common,providerFactory:()=>({transcribe(){throw Error('private');}})});assert.equal(JSON.parse((await broken(request)).body).error,'server-error');
 const stuckBody={...request,readBody:()=>new Promise(()=>{})};assert.equal((await hanging(stuckBody)).status,504);assert.equal(gate.active,0);
});
test('stream read aborts promptly and Web binary oversize has a normal JSON response',async()=>{
 const abort=new AbortController(),stream=new ReadableStream({start(){}});const pending=readStream(stream,100,abort.signal);abort.abort();await assert.rejects(pending,e=>e.code==='timeout');
});
test('registry defaults Render, leaves undeployed alternatives blank and validates origins without changing selection',()=>{
 const registry=new SttServers();assert.equal(registry.selected,'render');assert.equal(registry.available('netlify'),false);assert.equal(registry.available('vercel'),false);assert.throws(()=>registry.select('netlify'));assert.equal(registry.selected,'render');
 for(const value of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com?key=secret','https://example.com/#secret'])assert.throws(()=>publicOrigin(value));
 const r=new SttServers(entries(),{hostname:'localhost',origin:'http://localhost:5173',protocol:'http:'});assert.equal(r.endpoint('render','transcribe',{local:true}),'/api/stt');r.select('netlify');assert.equal(r.endpoint(r.selected,'transcribe'),'https://netlify.example.com/transcribe');r.update('netlify',{url:'',enabled:false});assert.equal(r.selected,'netlify');assert.equal(r.available('netlify'),false);
});
test('parallel availability probes are independent, coalesced, skip empty/disabled and never select fastest',async()=>{
 const registry=new SttServers(entries());registry.update('vercel',{url:'',enabled:true});let finishRender;const urls=[],checks=new ServerChecks(registry,{fetcher:async url=>{urls.push(url);return url.includes('render')?new Promise(r=>finishRender=r):response(health('netlify'));}});
 const all=checks.checkAll();assert.equal(all,checks.checkAll());await flush();assert.equal(checks.rows.get('netlify').state,'ok');assert.equal(checks.rows.get('render').state,'checking');assert.equal(checks.rows.get('vercel').state,'unconfigured');assert.equal(registry.selected,'render');assert.equal(urls.length,2);finishRender(response(health()));await all;assert.equal(checks.rows.get('render').state,'ok');assert.ok(checks.report().includes('HTTP 200'));assert.ok(checks.report().includes('Не настроен'));
 registry.update('netlify',{url:'https://netlify.example.com',enabled:false});urls.length=0;checks.fetcher=async url=>{urls.push(url);return response(health());};await checks.checkAll();assert.equal(urls.length,1);assert.equal(checks.rows.get('netlify').state,'disabled');
});
test('health diagnostics distinguish HTTP, invalid JSON, bad metadata, timeout and late replies',async()=>{
 const registry=new SttServers(entries());let late;const checks=new ServerChecks(registry,{timeoutMs:5,fetcher:async url=>url.includes('render')?new Promise(r=>late=r):url.includes('netlify')?{ok:false,status:503,json:async()=>({error:'offline'})}:{ok:true,status:200,json:async()=>{throw Error('bad-json');}}});await checks.checkAll();assert.equal(checks.rows.get('render').error,'timeout');assert.equal(checks.rows.get('netlify').httpStatus,503);assert.equal(checks.rows.get('netlify').error,'http-error');assert.equal(checks.rows.get('vercel').error,'invalid-response');late(response(health()));await flush();assert.equal(checks.rows.get('render').error,'timeout');
 checks.fetcher=async()=>response({...health(),apiVersion:'gsk_secret-must-never-copy'});await checks.checkAll();assert.equal(checks.rows.get('render').error,'invalid-response');assert.ok(!checks.report().includes('gsk_secret'));
});
test('explicit routing uses one selected endpoint, checks limits locally and never resends to another server',async()=>{
 const registry=new SttServers(entries()),urls=[];registry.select('netlify');const provider=new RoutedSttProvider(registry,()=>registry.selected,{fetcher:async url=>{urls.push(url);return response({text:'안녕하세요'});}});const options={durationMs:6000,language:'ko'};
 assert.equal((await provider.transcribe(new Blob([Buffer.alloc(200)],{type:'audio/mp4'}),options)).text,'안녕하세요');assert.deepEqual(urls,['https://netlify.example.com/transcribe']);await assert.rejects(provider.transcribe(new Blob([Buffer.alloc(4000001)]),options),e=>e.code==='too-large');await assert.rejects(provider.transcribe(new Blob(['x']),{...options,durationMs:300001}),e=>e.code==='too-long');assert.equal(urls.length,1);
 provider.fetcher=async()=>{urls.push('only-selected');throw Error('offline');};await assert.rejects(provider.transcribe(new Blob(['x']),options),e=>e.code==='network');assert.equal(urls.length,2);assert.equal(registry.selected,'netlify');registry.observe('netlify',{maxAudioBytes:99999999});assert.equal(registry.limits('netlify').maxAudioBytes,4000000);
});
test('diagnostic manual capture keeps pauses, never executes commands; only explicit comparison resends same clip/language',async()=>{
 let time=0,tick,volume=.03;const sent=[],registry=new SttServers(entries()),diagnostics=new VoiceDiagnostics();let selected='render';
 class Recorder{static isTypeSupported(){return true;}constructor(_,settings){this.mimeType=settings.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([Buffer.alloc(200)])});this.onstop?.();});}}
 class Context{resume(){}close(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {getFloatTimeDomainData:out=>out.fill(volume)};}}
 const provider={async transcribe(audio,options){sent.push({selected,audio,language:options.language});return {text:'Создай стол'};}};
 const speech=createDiagnosticSpeech({registry,select:()=>selected,diagnostics,capture:{provider,Recorder,AudioContext:Context,navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){},addEventListener(){}}]};}}},now:()=>time,schedule:fn=>{tick=fn;return 1;},unschedule:()=>tick=null}});
 const advance=(ms,v)=>{volume=v;for(let n=0;n<ms;n+=50){time+=50;tick?.();}};speech.setLanguage('ru');await speech.start();advance(1000,.03);advance(4000,0);assert.equal(speech.recording,true);assert.equal(sent.length,0);advance(1000,.03);speech.stop();await flush();assert.equal(sent.length,1);assert.equal(diagnostics.data.transcript,'Создай стол');assert.equal(diagnostics.data.action,'Не выполняется: диагностический тест');assert.equal(diagnostics.data.stage,'completed');assert.equal(speech.comparison.durationMs,6000);await flush();assert.equal(sent.length,1);
 selected='netlify';await speech.compare();assert.equal(sent.length,2);assert.equal(sent[1].selected,'netlify');assert.equal(sent[1].audio,sent[0].audio);assert.equal(sent[1].language,'ru');speech.cancel();assert.equal(speech.comparison,null);assert.equal(speech.pending,null);
 await speech.start();advance(1000,0);speech.cancel();await flush();assert.equal(sent.length,2);
});
test('Pages builds centralized public origins only, including subpath resources; server configs share one handler',async()=>{
 const output=await mkdtemp(path.join(tmpdir(),'stickman-v27-'));await buildPages({apiBase:'https://korean-stickman.onrender.com',netlifyBase:'https://example.netlify.app',vercelBase:'https://example.vercel.app',output});const registry=await readFile(path.join(output,'src/stt-servers.js'),'utf8');assert.ok(registry.includes('https://example.netlify.app'));assert.ok(registry.includes('https://example.vercel.app'));const files=await readdir(output,{recursive:true});assert.ok(!files.some(f=>/server|\.env|netlify.toml|vercel.json/.test(f)&&!f.endsWith('stt-servers.js')));const html=await readFile(path.join(output,'index.html'),'utf8');assert.ok(html.includes('src/main.js'));assert.ok(html.includes('src/style.css'));
 const root=new URL('../',import.meta.url);assert.ok((await readFile(new URL('netlify/functions/stt.mjs',root),'utf8')).includes('createFunction'));for(const name of ['api/health.js','api/transcribe.js'])assert.ok((await readFile(new URL(name,root),'utf8')).includes('createFunction'));const config=JSON.parse(await readFile(new URL('vercel.json',root),'utf8'));assert.equal(config.functions['api/*.js'].maxDuration,60);assert.equal(config.outputDirectory,'backend-public');
});

test('actual Node HTTP exposes unified aliases, safe errors, preflight and blocks secrets in API-only mode',async()=>{
 const {createApp}=await import('../server.mjs');let calls=0;const app=createApp({apiOnly:true,origins:['https://render.example.com'],frontends:[origin],config:async()=>({key:'test-private'}),providerFactory:()=>({async transcribe(){calls++;return {text:'안녕하세요'};}})});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`,h={Host:'render.example.com',Origin:origin};
 try{for(const route of ['/health','/api/stt/status']){const r=await fetch(base+route,{headers:h});assert.equal(r.status,200);assert.equal((await r.json()).platform,'render');}assert.equal(calls,0);for(const route of ['/transcribe','/api/stt']){const r=await fetch(base+route,{method:'POST',headers:{...headers,...h},body:Buffer.alloc(200)});assert.equal(r.status,200);assert.equal((await r.json()).text,'안녕하세요');}assert.equal(calls,2);
 const options=await fetch(base+'/transcribe',{method:'OPTIONS',headers:{...h,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-requested-with,x-audio-duration-ms'}});assert.equal(options.status,204);
 for(const route of ['/.env','/server/api.mjs','/src/main.js','/index.html'])assert.equal((await fetch(base+route,{headers:h})).status,404);
 }finally{await new Promise(r=>app.close(r));}
});
test('chunked Node upload larger than budget returns readable 413 without destroying the connection',async()=>{
 const http=await import('node:http'),{nodeApi}=await import('../server/http-adapters.mjs');const api=createSttApi({config:async()=>({key:'private'}),limits:{...STT_POLICIES.render,maxAudioBytes:150},providerFactory:()=>({transcribe(){throw Error('must not run');}})}),app=http.createServer((req,res)=>nodeApi(api,req,res,'/transcribe'));await new Promise(r=>app.listen(0,'127.0.0.1',r));
 try{const r=await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:app.address().port,path:'/transcribe',method:'POST',headers:{'content-type':'audio/webm','x-requested-with':'KoreanStickman','x-audio-duration-ms':'1000'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.write(Buffer.alloc(100));req.end(Buffer.alloc(100));});assert.equal(r.status,413);assert.equal(JSON.parse(r.body).error,'too-large');}finally{await new Promise(r=>app.close(r));}
});
test('client distinguishes platform non-JSON 413/504 and malformed successful responses without retry',async()=>{
 const {HttpSttProvider}=await import('../src/stt-client.js');for(const [status,code] of [[413,'too-large'],[504,'timeout'],[200,'invalid-response']]){let calls=0;const provider=new HttpSttProvider(async()=>{calls++;return {status,ok:status===200,json:async()=>{throw Error('HTML response');}};},()=>'/transcribe');await assert.rejects(provider.transcribe(new Blob(['x']),{durationMs:1000}),e=>e.code===code&&e.httpStatus===status);assert.equal(calls,1);}const bad=new HttpSttProvider(async()=>response({wrong:'shape'}),()=>'/transcribe');await assert.rejects(bad.transcribe(new Blob(['x']),{durationMs:1000}),e=>e.code==='invalid-response');
});
