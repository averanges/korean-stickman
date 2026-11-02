import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceHealth} from '../src/voice-health.js';
import {VoiceDiagnostics,ERROR_MESSAGES} from '../src/voice-diagnostics.js';
import {interpretRussian} from '../src/russian-test.js';
import {parseKorean} from '../src/parser.js';
import {parseRoom} from '../src/room-state.js';
import {WorldState} from '../src/world.js';
import {HttpSttProvider,SpeechError} from '../src/stt-client.js';
import {BrowserSpeech} from '../src/speech.js';
import {GroqWhisper,assessTranscript,SttError} from '../server/stt.mjs';
import {createApp} from '../server.mjs';
const confident=text=>({text,segments:[{text,avg_logprob:-.3,no_speech_prob:.02,compression_ratio:1.1}]});
const flush=()=>new Promise(r=>setImmediate(r));
test('health checks are coalesced, bounded, do not call STT and recheck only after long inactivity',async()=>{
 let calls=0,time=1000000,resolve;const health=new VoiceHealth({now:()=>time,fetcher:()=>{calls++;return new Promise(r=>resolve=r);},resolveUrl:r=>r});
 const a=health.check(),b=health.check();assert.equal(a,b);assert.equal(calls,1);resolve({ok:true,json:async()=>({configured:true})});assert.equal(await a,true);assert.equal(health.ready,true);await health.checkAfterIdle();assert.equal(calls,1);time+=600001;const next=health.checkAfterIdle();assert.equal(calls,2);resolve({ok:true,json:async()=>({configured:false})});assert.equal(await next,false);assert.equal(health.state,'ready');assert.equal(health.configured,false);
});
test('health gives up on hung attempts including hung bodies, then explicit retry can recover',async()=>{
 let calls=0;const health=new VoiceHealth({fetcher:async()=>{calls++;return {ok:true,json:()=>new Promise(()=>{})};},resolveUrl:r=>r,attemptMs:5,totalMs:2000,delays:[2,3]});assert.equal(await health.check(),false);assert.equal(calls,3);assert.equal(health.state,'error');health.fetcher=async()=>({ok:true,json:async()=>({configured:true})});assert.equal(await health.check(),true);let limited=0;const bounded=new VoiceHealth({fetcher:async()=>{limited++;throw Error('offline');},resolveUrl:r=>r,totalMs:5,delays:[100,100]});assert.equal(await bounded.check(),false);assert.equal(limited,1);
});
test('Russian test phrases map to identical Korean game actions and do not accept arbitrary sentences',()=>{
 const world=new WorldState({getItem:()=>null,setItem(){}});
 for(const [ru,ko] of [['Привет','안녕하세요'],['Здравствуй','안녕하세요'],['Я мужчина','남자예요'],['Я женщина','여자예요'],['Я из России','러시아 사람이에요'],['Я из Кореи','한국 사람이에요'],['Я студент','학생이에요'],['Я учитель','선생님이에요'],['Я врач','의사예요']]){const actual=interpretRussian(ru),expected=parseKorean(ko);assert.equal(actual.ok,true);assert.equal(actual.action,expected.action);assert.equal(actual.field,expected.field);assert.equal(actual.value,expected.value);}
 for(const [ru,ko] of [['Создай стол','책상 있어요'],['Создай стул','의자 있어요'],['Создай кровать','침대 있어요'],['Создай книгу','책 있어요'],['Создай воду','물 있어요'],['Создай яблоко','사과 있어요'],['Поставь стол','책상 있어요'],['Прочитай книгу','책을 읽어요'],['Выпей воду','물을 마셔요'],['Съешь яблоко','사과를 먹어요'],['Сядь на стул','의자에 앉아요'],['Встань','일어나요'],['Ляг на кровать','침대에 누워요'],['Поспи на кровати','침대에서 자요'],['Включи лампу','전등을 켜요'],['Выключи лампу','전등을 꺼요'],['Удали стол','책상이 없어요']])assert.deepEqual(interpretRussian(ru,{home:true}).commands,parseRoom(ko).commands,ru);
 for(const text of ['я не мужчина','я из России или Кореи','создай стол и кровать','удали все','моя сестра врач','Я врач?'])assert.equal(interpretRussian(text).ok,false);
 world.apply(interpretRussian('Я мужчина'));world.apply(interpretRussian('Я из России'));world.apply(interpretRussian('Я врач'));assert.equal(world.profile.country,'russia');assert.equal(world.profile.profession,'doctor');
});
test('Groq keeps full audio, selects ru explicitly and applies the same confidence checks',async()=>{
 let form;const bytes=Buffer.from('phrase|four-seconds-silence|end'.repeat(10)),provider=new GroqWhisper({key:'test-key',fetcher:async(_,options)=>{form=options.body;return {ok:true,json:async()=>confident('Создай стол')};}});
 assert.equal((await provider.transcribe(bytes,'audio/webm',{language:'ru'})).text,'Создай стол');assert.equal(form.get('language'),'ru');assert.equal(form.get('prompt'),null);assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()),bytes);assert.throws(()=>assessTranscript(confident('Создай стол')));assert.throws(()=>assessTranscript({...confident('Привет'),segments:[{text:'Привет',avg_logprob:-3,no_speech_prob:.05}]},'ru'));await assert.rejects(provider.transcribe(bytes,'audio/webm',{language:'en'}),e=>e.code==='invalid-language');
});
test('HTTP allows only ko/ru and the new CORS header; health never invokes Groq; failures identify Groq safely',async()=>{
 const languages=[];const app=createApp({origins:['https://korean-stickman.onrender.com'],frontends:['https://averanges.github.io'],apiOnly:true,config:async()=>({key:'hidden-secret'}),providerFactory:()=>({async transcribe(bytes,mime,options){languages.push(options.language);return {text:options.language==='ru'?'Привет':'안녕하세요'};}})});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`,headers={Host:'korean-stickman.onrender.com',Origin:'https://averanges.github.io'};
 try{let response=await fetch(base+'/api/stt/status',{headers});assert.equal(response.status,200);assert.equal(languages.length,0);assert.ok(!(await response.text()).includes('hidden-secret'));response=await fetch(base+'/api/stt',{method:'OPTIONS',headers:{...headers,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-requested-with,x-audio-duration-ms,x-stt-language'}});assert.equal(response.status,204);const audioHeaders={...headers,'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1200'};for(const language of ['ko','ru'])assert.equal((await fetch(base+'/api/stt',{method:'POST',headers:{...audioHeaders,'X-STT-Language':language},body:Buffer.alloc(200)})).status,200);assert.deepEqual(languages,['ko','ru']);assert.equal((await fetch(base+'/api/stt',{method:'POST',headers:{...audioHeaders,'X-STT-Language':'en'},body:Buffer.alloc(200)})).status,422);}finally{await new Promise(r=>app.close(r));}
});
test('transport preserves actionable provider errors, records status/timing and never automatically retries',async()=>{
 const events=[];let calls=0;const provider=new HttpSttProvider(async()=>{calls++;return {ok:false,status:502,json:async()=>({error:'provider-auth',source:'Groq',secret:'must-not-forward'})};},r=>r);
 await assert.rejects(provider.transcribe(new Blob(['audio'],{type:'audio/webm'}),{durationMs:1000,language:'ru',onStage:(stage,data)=>events.push({stage,...data})}),e=>e.code==='provider-auth'&&e.httpStatus===502&&e.source==='Groq'&&!JSON.stringify(e).includes('must-not-forward'));assert.equal(calls,1);assert.equal(events[0].stage,'uploading');assert.ok(events.some(e=>e.httpStatus===502));assert.ok(events.some(e=>e.stage==='timing'));
});
test('XHR reports actual upload completion separately from processing and honors user abort',async()=>{
 const previous=globalThis.XMLHttpRequest;let xhr;
 class Xhr {constructor(){xhr=this;this.upload={};this.headers={};}open(){}setRequestHeader(k,v){this.headers[k]=v;}send(audio){this.audio=audio;}abort(){this.onabort();}}
 globalThis.XMLHttpRequest=Xhr;
 try{const stages=[],provider=new HttpSttProvider(undefined,r=>r),abort=new AbortController();const pending=provider.transcribe(new Blob(['x'],{type:'audio/webm'}),{durationMs:1100,language:'ru',signal:abort.signal,onStage:s=>stages.push(s)});assert.deepEqual(stages,['uploading']);assert.equal(xhr.headers['X-STT-Language'],'ru');xhr.upload.onload();assert.equal(stages.at(-1),'processing');xhr.status=200;xhr.responseText='{"text":"Привет"}';xhr.onload();assert.equal((await pending).text,'Привет');const cancelled=provider.transcribe(new Blob(['x']),{durationMs:1000,signal:abort.signal});abort.abort();await assert.rejects(cancelled,e=>e.name==='AbortError');}finally{globalThis.XMLHttpRequest=previous;}
});
function recorderHarness({fallback=false,denied=false,resumeRejected=false,beforeUpload,provider,onFinal}={}){
 let time=0,tick,recorder;const stages=[],errors=[],calls=[];let loud=.03;
 class Recorder {static isTypeSupported(type){return type.startsWith('audio/webm')||type==='audio/mp4';}constructor(stream,{mimeType}){if(fallback&&mimeType.startsWith('audio/webm'))throw new DOMException('unsupported','NotSupportedError');this.mimeType=mimeType;this.state='inactive';recorder=this;}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['x'.repeat(200)])});this.onstop?.();});}}
 class Context{resume(){if(resumeRejected)return Promise.reject(new DOMException('audio permission','NotAllowedError'));}close(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:s=>s.fill(loud)};}}
 const speech=new BrowserSpeech({beforeUpload,onFinal,onStage:(s,d)=>stages.push({stage:s,...d}),onError:c=>errors.push(c)},{navigator:{mediaDevices:{async getUserMedia(){if(denied)throw new DOMException('denied','NotAllowedError');if(resumeRejected)await new Promise(r=>setTimeout(r,2));return {getTracks:()=>[{stop(){},addEventListener(){}}]};}}},Recorder,AudioContext:Context,provider:provider||{async transcribe(audio,options){calls.push({audio,options});options.onStage('uploading',{sent:true});options.onStage('processing',{});return {text:'Привет'};}},now:()=>time,schedule:f=>{tick=f;return 1;},unschedule:()=>{tick=null;}});
 return {speech,stages,errors,calls,advance(ms,sound=.03){loud=sound;for(let i=0;i<ms;i+=50){time+=50;tick?.();}}};
}
test('manual Russian capture retains long pauses, reports stages, and falls back to MP4 if a constructor rejects WebM',async()=>{
 const h=recorderHarness({fallback:true});h.speech.setLanguage('ru');h.speech.callbacks.onFinal=()=>{h.speech.stage('executing');return {ok:true};};await h.speech.start();h.advance(1000);h.advance(4000,0);assert.equal(h.calls.length,0);assert.equal(h.speech.recording,true);h.advance(1000);h.speech.stop();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.language,'ru');assert.equal(h.calls[0].options.durationMs,6000);assert.equal(h.calls[0].audio.type,'audio/mp4');for(const stage of ['requesting_microphone','recording','audio_ready','uploading','processing','transcribed','executing','completed'])assert.ok(h.stages.some(s=>s.stage===stage),stage);assert.equal(h.speech.pending,null);
});
test('unready backend preserves the full recording without sending it; explicit retry alone resends; deletion is explicit',async()=>{
 let ready=false;const h=recorderHarness({beforeUpload:()=>{if(!ready)throw new SpeechError('server-unavailable',{stage:'audio_ready'});}});await h.speech.start();h.advance(1000);h.speech.stop();await flush();assert.equal(h.calls.length,0);assert.equal(h.speech.pending.audio.size,200);assert.ok(h.errors.includes('server-unavailable'));assert.equal(h.speech.setLanguage('ru'),false);ready=true;await h.speech.retry();assert.equal(h.calls.length,1);assert.equal(h.speech.pending,null);assert.equal(h.speech.active,false);ready=false;await h.speech.start();h.advance(1000);h.speech.stop();await flush();h.speech.cancel();assert.equal(h.speech.pending,null);assert.equal(h.stages.at(-1).stage,'cancelled');
});
test('microphone rejection, unknown command and game failure have distinct stages and allow a new recording',async()=>{
 const denied=recorderHarness({denied:true});await denied.speech.start();assert.ok(denied.errors.includes('not-allowed'));assert.equal(denied.stages.at(-1).failureStage,'requesting_microphone');
 const audioDenied=recorderHarness({resumeRejected:true});await audioDenied.speech.start();assert.equal(audioDenied.speech.recording,true);assert.equal(audioDenied.errors.length,0);audioDenied.speech.cancel();assert.equal(audioDenied.speech.active,false);
 for(const error of ['unknown-command','game-error']){const h=recorderHarness({onFinal:()=>({error})});await h.speech.start();h.advance(1000);h.speech.stop();await flush();assert.ok(h.errors.includes(error));assert.equal(h.speech.pending,null);await h.speech.start();assert.equal(h.speech.recording,true);h.speech.cancel();}
});
test('diagnostic copy is an allowlisted text report, redacts credentials and stores no audio or cookies',()=>{
 const d=new VoiceDiagnostics();d.begin('ru');d.stage('uploading',{mime:'audio/mp4',bytes:200,durationMs:1200,sent:true});d.update({apiKey:'secret',cookies:'secret',audio:new Blob(['secret']),transcript:'GROQ_API_KEY=gsk_privatevaluehere',action:'create desk',httpStatus:502});d.stage('error',{error:'provider-auth',source:'Groq'});const report=d.report();assert.match(report,/Язык STT: ru/);assert.match(report,/Этап сбоя: uploading/);assert.match(report,/create desk/);assert.ok(!report.includes('gsk_privatevaluehere'));assert.ok(!report.includes('secret'));assert.ok(!report.includes('[object Blob]'));assert.notEqual(ERROR_MESSAGES['not-allowed'],ERROR_MESSAGES['provider-error']);
});
test('real HTTP provider errors preserve a safe Groq/Render distinction and release concurrency slots',async()=>{
 let configured=true;const app=createApp({config:async()=>({key:configured?'private-key':''}),providerFactory:()=>({async transcribe(){throw new SttError('provider-error',502,'Groq');}})});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`,headers={'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1000','X-STT-Language':'ru'};
 try{for(let i=0;i<3;i++){const response=await fetch(base+'/api/stt',{method:'POST',headers,body:Buffer.alloc(200)});assert.equal(response.status,502);{const data=await response.json();assert.equal(data.error,'provider-error');assert.equal(data.source,'Groq');assert.equal(data.apiVersion,'1');}}configured=false;const response=await fetch(base+'/api/stt',{method:'POST',headers,body:Buffer.alloc(200)});assert.equal(response.status,503);{const data=await response.json();assert.equal(data.error,'not-configured');assert.equal(data.source,'render');assert.equal(data.apiVersion,'1');}}finally{await new Promise(r=>app.close(r));}
});
test('failed upload is retained without automatic POST retry, and explicit retry uses identical bytes and language',async()=>{
 let calls=0,first;const provider={async transcribe(audio,options){calls++;options.onStage('uploading',{sent:true});if(!first){first=audio;throw new SpeechError('network',{stage:'uploading'});}assert.equal(audio,first);assert.equal(options.language,'ru');return {text:'Привет'};}};
 const h=recorderHarness({provider});h.speech.setLanguage('ru');await h.speech.start();h.advance(1000);h.speech.stop();await flush();assert.equal(calls,1);assert.equal(h.speech.pending.audio,first);await flush();assert.equal(calls,1);await h.speech.retry();assert.equal(calls,2);assert.equal(h.speech.pending,null);assert.equal(h.speech.active,false);
});
