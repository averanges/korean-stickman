import {API_BASE_URL,apiUrl} from './api-config.js';
import {STT_POLICIES} from './stt-limits.js';
// Public origins only. Empty addresses mean "not configured", never invented deployments.
export const NETLIFY_API_BASE_URL='https://incandescent-lollipop-01828a.netlify.app';
export const VERCEL_API_BASE_URL='https://korean-stickman.vercel.app';
export const AMVERA_API_BASE_URL='https://korean-stickman-averanges.msk1.amvera.tech';
export const STT_SERVERS=[{id:'render',label:'Render',platform:'render',url:API_BASE_URL,enabled:true},{id:'netlify',label:'Netlify',platform:'netlify',url:NETLIFY_API_BASE_URL,enabled:true},{id:'vercel',label:'Vercel',platform:'vercel',url:VERCEL_API_BASE_URL,enabled:true},{id:'amvera',label:'Amvera',platform:'amvera',url:AMVERA_API_BASE_URL,enabled:true,manualOnly:true}];
export function publicOrigin(value){if(!String(value||'').trim())return '';const url=new URL(String(value).trim());if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Нужен HTTPS-адрес без пути, ключей и параметров.');return url.origin;}
export class SttServers{
 constructor(entries=STT_SERVERS,location=globalThis.location){this.location=location;this.entries=entries.map(e=>({...e,url:publicOrigin(e.url)}));this.selected='render';this.observed=new Map();}
 get(id){return this.entries.find(e=>e.id===id);}
 available(id){const e=this.get(id);return Boolean(e?.url&&e.enabled);}
 update(id,changes){const e=this.get(id);if(!e)throw Error('Сервер не найден');const url=publicOrigin(changes.url);Object.assign(e,{url,enabled:Boolean(changes.enabled)});this.observed.delete(id);}
 select(id){if(!this.available(id))throw Error('Сервер не настроен или отключён');this.selected=id;}
 endpoint(id,kind,{local=false}={}){
  const e=this.get(id);if(!this.available(id))throw Object.assign(Error('api-unconfigured'),{code:'api-unconfigured'});
  if(local&&id==='render')return apiUrl(kind==='health'?'/api/stt/status':'/api/stt',e.url,this.location);
  return e.url+(kind==='health'?'/health':'/transcribe');
 }
 limits(id){const fallback=STT_POLICIES[this.get(id)?.platform]||STT_POLICIES.netlify,observed=this.observed.get(id)||{};return {...fallback,maxAudioBytes:Math.min(fallback.maxAudioBytes,Number(observed.maxAudioBytes)>0?Number(observed.maxAudioBytes):Infinity),maxDurationMs:fallback.maxDurationMs?Math.min(fallback.maxDurationMs,Number(observed.maxDurationMs)>0?Number(observed.maxDurationMs):Infinity):Number(observed.maxDurationMs)>0?Number(observed.maxDurationMs):null};}
 observe(id,limits){if(limits&&typeof limits==='object')this.observed.set(id,{maxAudioBytes:limits.maxAudioBytes,maxDurationMs:limits.maxDurationMs});}
 address(id,{local=false}={}){const endpoint=this.endpoint(id,'transcribe',{local});return endpoint.startsWith('/')?(this.location?.origin||'localhost')+endpoint:endpoint;}
}
export class ServerChecks{
 constructor(registry,{fetcher=(...args)=>fetch(...args),onChange=()=>{},timeoutMs=20000,now=()=>performance.now(),dateNow=()=>new Date().toISOString(),resolveUrl=e=>e.url+'/health'}={}){Object.assign(this,{registry,fetcher,onChange,timeoutMs,now,dateNow,resolveUrl});this.rows=new Map();this.pending=null;}
 checkAll(){if(this.pending)return this.pending;this.pending=Promise.resolve().then(()=>Promise.allSettled(this.registry.entries.map(e=>this.probe(e.id)))).finally(()=>{this.pending=null;this.onChange();});this.onChange();return this.pending;}
 set(id,data){this.rows.set(id,{id,...data});this.onChange();}
 async probe(id){
  const entry={...this.registry.get(id)};if(!entry.url||!entry.enabled){this.set(id,{state:entry.url?'disabled':'unconfigured',url:entry.url,httpStatus:null});return;}
  const start=this.now(),base={url:new URL(this.resolveUrl(entry),this.registry.location?.origin||entry.url).href,checkedAt:this.dateNow()};this.set(id,{...base,state:'checking'});const controller=new AbortController();let timer,finished=false;
  try{
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('timeout'),{code:'timeout'}));},this.timeoutMs);});
   const result=await Promise.race([(async()=>{const response=await this.fetcher(this.resolveUrl(entry),{method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal});if(!finished)this.set(id,{...base,state:'checking',httpStatus:response.status});let data;try{data=await response.json();}catch{throw Object.assign(Error('invalid-response'),{code:'invalid-response',httpStatus:response.status});}return {response,data};})(),timeout]);
   const response=result.response;let data=result.data;
   if(!response.ok)throw Object.assign(Error('http-error'),{code:'http-error',httpStatus:response.status});
   let normalized;
   if(entry.platform==='amvera'){
    const upstream=data?.upstream;
    if(data?.ok!==true||data.source!=='amvera-proxy'||typeof upstream?.sttReady!=='boolean'||typeof upstream.reachable!=='boolean')throw Object.assign(Error('invalid-response'),{code:'invalid-response',httpStatus:response.status});
    normalized={...data,apiVersion:'1',version:typeof data.version==='string'?data.version.slice(0,40):'—',platform:'amvera',configured:upstream.sttReady&&upstream.reachable&&upstream.httpStatus===200};
   }else{
   if(data?.ok!==true||typeof data.configured!=='boolean'||data.apiVersion!=='1'||!['render','netlify','vercel'].includes(data.platform)||data.platform!==entry.platform||!/^v?\d+(?:\.\d+){0,3}$/.test(data.apiVersion)||!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/i.test(data.version))throw Object.assign(Error('invalid-response'),{code:'invalid-response',httpStatus:response.status});
    normalized=data;
   }
   if(this.registry.get(id).url!==entry.url||!this.registry.available(id)){this.set(id,{state:'not-checked'});return;}
   const upstream=entry.platform==='amvera'?{reachable:data.upstream.reachable,sttReady:data.upstream.sttReady,httpStatus:data.upstream.httpStatus??null,error:typeof data.upstream.error==='string'?data.upstream.error.slice(0,80):null,cached:data.upstream.cached===true}:null;data=normalized;
   this.registry.observe(id,data.limits);this.set(id,{...base,state:'ok',httpStatus:response.status,latencyMs:Math.round(this.now()-start),apiVersion:String(data.apiVersion).slice(0,40),version:String(data.version||'').slice(0,40),platform:String(data.platform).slice(0,40),configured:data.configured,upstream,manualOnly:entry.manualOnly===true,llmEnabled:data.capabilities?.interpretation?.version===1&&data.capabilities.interpretation.enabled===true});
  }catch(error){if(this.registry.get(id).url===entry.url&&this.registry.available(id))this.set(id,{...base,state:'error',httpStatus:error.httpStatus??this.rows.get(id)?.httpStatus??null,latencyMs:Math.round(this.now()-start),error:error.code||'network'});}
  finally{finished=true;clearTimeout(timer);}
 }
 report(){return 'Серверы STT (только доступность, не проверка Groq)\n'+this.registry.entries.map(e=>{const r=this.rows.get(e.id)||{};return `${e.label}: ${r.url||e.url||'Не настроен'}; ${!e.enabled?'Отключён':r.state||'Не проверен'}; HTTP ${r.httpStatus??'—'}; ${r.latencyMs??'—'} мс; API ${r.apiVersion||'—'}; сборка ${r.version||'—'}; ${r.error||'—'}; ${r.checkedAt||'—'}${e.manualOnly?' ; Только ручной выбор':''}${r.upstream?' ; Vercel: reachable='+r.upstream.reachable+', sttReady='+r.upstream.sttReady+', HTTP '+(r.upstream.httpStatus??'—')+', error='+(r.upstream.error||'—')+', cached='+r.upstream.cached:''}`;}).join('\n');}
}
