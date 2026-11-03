import {apiUrl} from './api-config.js';
export class SpeechError extends Error {
  constructor(code,details={}){super(code);this.code=code;Object.assign(this,details);}
}
const known=new Set(['upstream-network','upstream-invalid-response','busy','invalid-duration','request-aborted','upload-error','forbidden-origin','forbidden','unsupported-format','invalid-language','not-configured','empty-audio','too-short','too-large','unclear','provider-auth','provider-error','rate-limit','timeout','network','server-error','too-long','invalid-response']);
function resultOf(status,data,strict=false){
  if(status<200||status>=300){const code=status===413?(data?.error==='too-long'?'too-long':'too-large'):status===504&& !data?.error?'timeout':known.has(data?.error)?data.error:'service-unavailable';throw new SpeechError(code,{httpStatus:status,source:['Groq','Render','Netlify','Vercel','render','netlify','vercel','amvera-proxy'].includes(data?.source)?data.source:code.startsWith('provider-')||['unclear','rate-limit'].includes(code)?'STT/Groq':'Render',stage:'processing'});}
  if(strict&&(data?.ok!==true||data.apiVersion!=='1'||!['render','vercel','netlify'].includes(data.platform)))throw new SpeechError('invalid-response',{httpStatus:status,stage:'processing'});
  if(typeof data?.text!=='string')throw new SpeechError('invalid-response',{httpStatus:status,source:'platform',stage:'processing'});
  if(!data.text.trim())throw new SpeechError('unclear',{httpStatus:status,source:'STT/Groq',stage:'processing'});
  return {text:data.text};
}
// Real browser uses upload completion from XHR; injected fetch remains available for tests/fallback.
export class HttpSttProvider {
  constructor(fetcher,resolveUrl=apiUrl,timeoutMs=65000,strict=false){this.strict=strict;this.fetcher=fetcher;this.resolveUrl=resolveUrl;this.timeoutMs=timeoutMs;}
  async transcribe(audio,{durationMs,signal,language='ko',onStage=()=>{}}){
    if(!['ko','ru'].includes(language))throw new SpeechError('invalid-language');
    const endpoint=this.resolveUrl('/api/stt');
    const headers={'Content-Type':audio.type,'X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':String(Math.round(durationMs))};
    if(language!=='ko')headers['X-STT-Language']=language;
    if(!this.fetcher&&globalThis.XMLHttpRequest)return this.xhr(endpoint,audio,headers,signal,onStage);
    let timedOut=false,finished=false,timer,abort;
    const controller=new AbortController(),fetcher=this.fetcher||globalThis.fetch,started=performance.now();
    const cancelled=new Promise((_,reject)=>{abort=()=>{controller.abort();reject(new DOMException('Cancelled','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new SpeechError('timeout',{stage:'processing'}));},this.timeoutMs);});
    try{
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      onStage('uploading',{sent:true,transport:'fetch'});
      const work=(async()=>{
        const response=await fetcher(endpoint,{method:'POST',credentials:'omit',headers,body:audio,signal:controller.signal});
        if(finished||signal?.aborted)throw new DOMException('Cancelled','AbortError');
        onStage('processing',{httpStatus:response.status,waitMs:Math.round(performance.now()-started)});
        let data;try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw new SpeechError(response.status===413?'too-large':response.status===504?'timeout':response.status>=500?'service-unavailable':'invalid-response',{httpStatus:response.status,source:'platform'});}
        return resultOf(response.status,data,this.strict);
      })();
      return await Promise.race([work,timeout,cancelled]);
    }catch(error){if(timedOut)throw new SpeechError('timeout',{stage:'processing'});if(error.name==='AbortError'||error instanceof SpeechError)throw error;throw new SpeechError('network',{stage:'uploading'});}
    finally{finished=true;onStage('timing',{waitMs:Math.round(performance.now()-started)});clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }

  xhr(endpoint,audio,headers,signal,onStage){return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest(),started=performance.now();let uploaded=false,settled=false;
    const abort=()=>request.abort();
    const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);onStage('timing',{waitMs:Math.round(performance.now()-started)});if(error)reject(error);else resolve(result);};
    request.open('POST',endpoint);request.timeout=this.timeoutMs;request.withCredentials=false;
    for(const [name,value] of Object.entries(headers))request.setRequestHeader(name,value);
    request.upload.onload=()=>{if(settled)return;uploaded=true;onStage('processing',{});};
    request.onload=()=>{if(settled)return;onStage('processing',{httpStatus:request.status});let data;try{data=JSON.parse(request.responseText);}catch{return finish(new SpeechError(request.status===413?'too-large':request.status===504?'timeout':request.status>=500?'service-unavailable':'invalid-response',{httpStatus:request.status,source:'platform',stage:'processing'}));}try{finish(null,resultOf(request.status,data,this.strict));}catch(error){finish(error);}};
    request.onerror=()=>finish(new SpeechError(uploaded?'server-unavailable':'upload-failed',{stage:uploaded?'processing':'uploading',source:'network/Render'}));
    request.ontimeout=()=>finish(new SpeechError('timeout',{stage:uploaded?'processing':'uploading'}));
    request.onabort=()=>finish(new DOMException('Cancelled','AbortError'));
    if(signal?.aborted){finish(new DOMException('Cancelled','AbortError'));return;}
    signal?.addEventListener('abort',abort,{once:true});
    try{onStage('uploading',{sent:true,transport:'xhr'});request.send(audio);}catch{finish(new SpeechError('upload-failed',{stage:'uploading'}));}
  });}
}
