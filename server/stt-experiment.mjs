import {createHash} from 'node:crypto';
import {GroqWhisper,AUDIO_TYPES,SttError} from './stt.mjs';
import {OpenAiTranscribe} from './openai-stt.mjs';
import {SttGate} from './security.mjs';
import {STT_VARIANTS,GROQ_EXPERIMENT_PROMPT} from '../src/stt-experiment-config.js';
export function experimentPrompt(value=GROQ_EXPERIMENT_PROMPT){
 // Whisper uses byte-level tokens. This conservative UTF-8 byte bound is <=224 tokens.
 if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value,'utf8')>224)throw new SttError('invalid-experiment-prompt',503,'experiment');return value;
}
export function createSttExperiment({config,gate=new SttGate({maximum:1,perMinute:8}),timeoutMs=40000,providerFactory}={}){
 return async(request,respond)=>{
  const started=performance.now(),variant=STT_VARIANTS.find(v=>v.id===request.headers['x-stt-experiment']);let release,timer,sha256=null,model=null,providerHttpStatus=null;
  let rejectCancelled;const cancelled=new Promise((_,reject)=>{rejectCancelled=reject;});
  const controller=new AbortController(),stop=()=>{rejectCancelled(new SttError('interrupted',408,'experiment'));controller.abort();};request.signal?.addEventListener('abort',stop,{once:true});
  const meta=()=>({experimentVersion:'3.0.2',variant:variant?.id??null,provider:variant?.provider??null,model,sha256,elapsedMs:Math.round(performance.now()-started)});
  try{
   if(!variant)throw new SttError('invalid-experiment',422,'experiment');
   const language=request.headers['x-stt-language']||'ko',mime=request.headers['content-type']||'',duration=Number(request.headers['x-audio-duration-ms']);
   if(language!=='ko')throw new SttError('invalid-language',422,'experiment');
   if(!AUDIO_TYPES.has(mime.split(';')[0].trim().toLowerCase()))throw new SttError('unsupported-format',415,'experiment');
   if(!Number.isFinite(duration)||duration<500)throw new SttError('too-short',422,'experiment');if(duration>300000)throw new SttError('too-long',413,'experiment');
   if(Number(request.headers['content-length'])>4000000)throw new SttError('too-large',413,'experiment');
   release=gate.acquire();if(!release)return respond(429,{ok:false,error:'rate-limit',source:'experiment',...meta()},{'Retry-After':'60'});
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new SttError('timeout',504,'experiment'));controller.abort();},timeoutMs);});
   const work=(async()=>{
    if(request.signal?.aborted)throw new SttError('interrupted',408,'experiment');
    const audio=await request.readBody(4000000,controller.signal);if(audio.byteLength<128)throw new SttError('empty-audio',422,'experiment');if(audio.byteLength>4000000)throw new SttError('too-large',413,'experiment');
    sha256=createHash('sha256').update(audio).digest('hex');const settings=await config();if(controller.signal.aborted)throw new SttError('interrupted',408,'experiment');
    model=variant.provider==='groq'?(settings.model||'whisper-large-v3'):'gpt-transcribe';
    const prompt=variant.provider==='groq'&&variant.hints?experimentPrompt(settings.groqSttPrompt??GROQ_EXPERIMENT_PROMPT):'';
    const provider=providerFactory?providerFactory(variant,settings):variant.provider==='groq'?new GroqWhisper(settings):new OpenAiTranscribe(settings);
    const result=await provider.transcribe(audio,mime,{language:'ko',signal:controller.signal,hints:variant.hints,prompt,raw:true});
    if(typeof result?.text!=='string'||result.text.length>4000)throw new SttError('invalid-response',502,'experiment');
    return {ok:true,...meta(),text:result.text,quality:result.quality||'not-assessed',context:variant.hints?(variant.provider==='groq'?{prompt}:{keywords:['공책','옷','영화','펜']}):null};
   })();
   return respond(200,await Promise.race([work,timeout,cancelled]));
  }catch(error){providerHttpStatus=error.providerHttpStatus??null;return respond(error instanceof SttError?error.status:500,{ok:false,error:error instanceof SttError?error.code:'server-error',source:error instanceof SttError?error.source:'experiment',providerHttpStatus,...meta()});}
  finally{clearTimeout(timer);release?.();request.signal?.removeEventListener('abort',stop);}
 };
}
