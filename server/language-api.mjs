import {SttError} from './stt.mjs';
import {analyzeLocal} from '../src/language-local.js';
import {validateContext,validateForWorld} from '../src/language-contract.js';
import {checkInterpretation} from '../src/language-service.js';
import {GroqInterpreter} from './interpret.mjs';
import {SttGate} from './security.mjs';
export function createLanguageEndpoint({config,interpreterFactory=s=>new GroqInterpreter(s),gate=new SttGate({maximum:1,perMinute:12}),timeoutMs=8000}={}){
 return async(request,respond)=>{
  if(!/^application\/json(?:;|$)/iu.test(request.headers['content-type']||''))return respond(415,{ok:false,error:'invalid-request',source:'llm'});
  const abort=new AbortController(),stop=()=>abort.abort();request.signal?.addEventListener('abort',stop,{once:true});let timer,release,modelCalled=false;
  try{
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new SttError('llm-timeout',504));},timeoutMs);});
   const work=(async()=>{
    if(request.signal?.aborted)throw new SttError('llm-timeout',504);
    if(Number(request.headers['content-length'])>16384)throw new SttError('invalid-request',413);
    let body;try{body=JSON.parse(Buffer.from(await request.readBody(16384,abort.signal)).toString('utf8'));}catch(error){if(error instanceof SttError)throw error;throw new SttError('invalid-request',400);}
    if(!body||Object.keys(body).some(k=>!['text','context','input'].includes(k))||typeof body.text!=='string'||!body.text.trim()||body.text.length>500||!['voice','text'].includes(body.input)||!validateContext(body.context))throw new SttError('invalid-request',400);
    const started=performance.now(),local=analyzeLocal(body.text,body.context,{voice:body.input==='voice'}),localMs=performance.now()-started;
    if(local.terminal)return {ok:true,method:local.document.status==='resolved'?'local':'unresolved',interpretation:local.document,validation:validateForWorld(local.document,body.context,{legacyBatch:local.legacyBatch}),timing:{localMs,llmMs:0},llmCalled:false};
    const settings=await config();if(abort.signal.aborted)throw new SttError('llm-timeout',504);if(settings.llmEnabled===false||!(settings.llmKey||settings.key))throw new SttError('llm-not-configured',503);
    release=gate.acquire();if(!release)throw new SttError('llm-rate-limit',429);
    modelCalled=true;const began=performance.now(),interpretation=await interpreterFactory(settings).interpret(body.text,body.context,{signal:abort.signal});
    if(!checkInterpretation(interpretation,body.text,body.context))throw new SttError('llm-invalid-response',502);
    return {ok:true,method:'llm',interpretation,validation:validateForWorld(interpretation,body.context),llmCalled:true,timing:{localMs,llmMs:performance.now()-began}};
   })();
   return respond(200,await Promise.race([work,timeout]));
  }catch(error){return respond(error instanceof SttError?error.status:500,{ok:false,error:error instanceof SttError?error.code:'llm-unavailable',source:'llm',llmCalled:modelCalled});}
  finally{clearTimeout(timer);release?.();request.signal?.removeEventListener('abort',stop);}
 };
}
