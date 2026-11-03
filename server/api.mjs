import {createSttExperiment} from './stt-experiment.mjs';
import {createLanguageEndpoint} from './language-api.mjs';
import {GroqWhisper,SttError,AUDIO_TYPES} from './stt.mjs';
import {allowedRequest,SttGate} from './security.mjs';
import {STT_POLICIES} from '../src/stt-limits.js';
export const API_VERSION='1',BUILD_VERSION='3.0.2';
export const API_PATHS=['/health','/transcribe','/api/stt/status','/api/stt','/interpret','/api/interpret','/api/stt-experiment'];
export function createSttApi({platform='render',config,origins=[],frontends=[],gate=new SttGate(),providerFactory=settings=>new GroqWhisper(settings),limits=STT_POLICIES[platform],interpreterFactory,llmGate,llmTimeoutMs,experimentGate,experimentTimeoutMs,experimentProviderFactory}={}){
 const experimentEndpoint=createSttExperiment({config,gate:experimentGate,timeoutMs:experimentTimeoutMs,providerFactory:experimentProviderFactory});
 const languageEndpoint=createLanguageEndpoint({config,interpreterFactory,gate:llmGate,timeoutMs:llmTimeoutMs});
 return async({method,path,headers,readBody,signal})=>{
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const respond=(status,data,extra={})=>({status,headers:{...h,...extra},body:status===204?null:JSON.stringify({...data,apiVersion:API_VERSION,version:BUILD_VERSION,platform})});
  try{
   if(!allowedRequest({headers},origins,frontends))return respond(403,{ok:false,error:'forbidden',source:platform});
   if(!API_PATHS.includes(path))return respond(404,{ok:false,error:'not-found',source:platform});
   if(headers.origin){h['Access-Control-Allow-Origin']=headers.origin;h.Vary='Origin';h['Access-Control-Expose-Headers']='Retry-After';}
   const experiment=path==='/api/stt-experiment';if(experiment&&platform!=='vercel'&&!/^(localhost|127\.0\.0\.1)(:\d+)?$/u.test(headers.host||''))return respond(404,{ok:false,error:'not-found',source:platform});
   const health=path==='/health'||path==='/api/stt/status',expected=health?'GET':'POST';
   if(method==='OPTIONS'){
    const permitted=[...(experiment?['x-stt-experiment']:[]),'content-type','x-requested-with','x-audio-duration-ms','x-stt-language','accept'];
    const requested=String(headers['access-control-request-headers']||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
    if(!headers.origin||headers['access-control-request-method']!==expected||requested.some(v=>!permitted.includes(v)))return respond(403,{ok:false,error:'forbidden',source:platform});
    Object.assign(h,{'Access-Control-Allow-Methods':expected+', OPTIONS','Access-Control-Allow-Headers':permitted.join(', '),'Access-Control-Max-Age':'600'});return respond(204,{});
   }
   if(method!==expected){h.Allow=expected+', OPTIONS';return respond(405,{ok:false,error:'method-not-allowed',source:platform});}
   if(health){const settings=await config();return respond(200,{ok:true,status:'ready',configured:Boolean(settings.key),provider:'Groq Whisper',limits,capabilities:{interpretation:{version:1,enabled:settings.llmEnabled!==false&&Boolean(settings.llmKey||settings.key)}}});}
   if(headers['x-requested-with']!=='KoreanStickman')return respond(403,{ok:false,error:'forbidden',source:platform});
   if(experiment)return experimentEndpoint({method,path,headers,readBody,signal},respond);
   if(path==='/interpret'||path==='/api/interpret')return languageEndpoint({method,path,headers,readBody,signal},respond);
   const language=headers['x-stt-language']||'ko',mime=String(headers['content-type']||'').toLowerCase(),duration=Number(headers['x-audio-duration-ms']);
   if(!['ko','ru'].includes(language))throw new SttError('invalid-language',422);
   if(!AUDIO_TYPES.has(mime.split(';')[0].trim()))throw new SttError('unsupported-format',415);
   if(!Number.isFinite(duration)||duration<500)throw new SttError('too-short');
   if(limits.maxDurationMs&&duration>limits.maxDurationMs)throw new SttError('too-long',413);
   if(Number(headers['content-length'])>limits.maxAudioBytes)throw new SttError('too-large',413);
   const settings=await config();if(!settings.key)throw new SttError('not-configured',503);
   const release=gate.acquire();if(!release){h['Retry-After']='60';return respond(429,{ok:false,error:'rate-limit',source:platform});}
   const abort=new AbortController(),stop=()=>abort.abort();if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});let timer,timedOut=false;
   try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;abort.abort();reject(new SttError('timeout',504));},limits.timeoutMs);});
    const work=(async()=>{const audio=await readBody(limits.maxAudioBytes,abort.signal);if(audio.byteLength<128)throw new SttError('empty-audio');if(audio.byteLength>limits.maxAudioBytes)throw new SttError('too-large',413);return providerFactory(settings).transcribe(audio,mime,{language,signal:abort.signal});})();
    const result=await Promise.race([work,timeout]);if(typeof result?.text!=='string'||!result.text.trim())throw new SttError('unclear');return respond(200,{ok:true,text:result.text,language});
   }catch(error){if(timedOut)throw new SttError('timeout',504);throw error;}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);release();}
  }catch(error){const safe=error instanceof SttError;return respond(safe?error.status:500,{ok:false,error:safe?error.code:'server-error',source:safe&&error.source==='Groq'?'Groq':platform,limits});}
 };
}
