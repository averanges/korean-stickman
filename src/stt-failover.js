import {RoutedSttProvider} from './routed-stt.js';
import {SpeechError} from './stt-client.js';
import {SERVER_ORDER} from './stt-connection.js';
export function shouldFailover(error){
 if(error.name==='AbortError'||error.httpStatus===429||['provider-auth','rate-limit','unclear','empty-audio','unknown-command','game-error','not-allowed','unsupported-format','invalid-language','too-short','too-large','too-long'].includes(error.code))return false;
 if(error.httpStatus>=400&&error.httpStatus<500)return false;
 if(['network','upload-failed','server-unavailable','timeout','invalid-response'].includes(error.code))return true;
 return [500,502,503,504].includes(error.httpStatus);
}
export class FailoverSttProvider{
 constructor(connection,{fetcher,timeoutMs=30000,providerFactory}={}){Object.assign(this,{connection,fetcher,timeoutMs,providerFactory});this.recordings=new WeakMap();}
 async transcribe(audio,options){
  const {registry}=this.connection,automatic=this.connection.mode==='auto',first=automatic&&!SERVER_ORDER.includes(registry.selected)?SERVER_ORDER[0]:registry.selected,ids=automatic?[first,...SERVER_ORDER.filter(id=>id!==first)]:[this.connection.mode];
  const firstLimits=registry.limits(first);if(audio.size>firstLimits.maxAudioBytes)throw new SpeechError('too-large');if(firstLimits.maxDurationMs&&options.durationMs>firstLimits.maxDurationMs)throw new SpeechError('too-long');
  const budget=this.recordings.get(audio)||{used:0};this.recordings.set(audio,budget);
  const operationStarted=performance.now(),attempts=[],skipped=[];let lastError,reason=null;
  for(const id of ids){
   if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
   if(!registry.available(id))continue;
   const limits=registry.limits(id),health=this.connection.checks.rows.get(id);
   if((audio.size>limits.maxAudioBytes)||(limits.maxDurationMs&&options.durationMs>limits.maxDurationMs)){skipped.push(id+': лимит записи');continue;}
   if(id!==first&&(health?.configured===false||health?.error==='invalid-response')){skipped.push(id+': API не готов');continue;}
   const attempt=attempts.length+1;if(attempt>1){if(budget.used>=2)break;budget.used++;}const started=performance.now();let finished=false;
   const detail=()=>({operationId:options.operationId,attemptCount:attempt,automaticRetries:budget.used,totalWaitMs:Math.round(performance.now()-operationStarted),serverId:id,serverName:registry.get(id).label,serverUrl:registry.address(id,{local:true}),switchReason:reason,attempts:attempts.map(a=>({...a})),skipped:skipped.join('; '),testMode:automatic?'автоматически':'вручную'});
   const onStage=(stage,data={})=>{if(finished||options.signal?.aborted)return;if(data.httpStatus)row.httpStatus=data.httpStatus;options.onStage?.(stage,{...data,...(stage==='routing'?detail():{})});};
   if(attempt>1)options.onStage?.('switching',detail());options.onStage?.('routing',detail());
   const row={server:id,attempt,status:'pending'};attempts.push(row);
   try{
    const provider=this.providerFactory?this.providerFactory(id):new RoutedSttProvider(registry,()=>id,{local:true,fetcher:this.fetcher,timeoutMs:id==='amvera'?registry.limits(id).timeoutMs:this.timeoutMs,strict:true});
    const result=await provider.transcribe(audio,{...options,onStage});
    if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
    row.status='ok';row.waitMs=Math.round(performance.now()-started);finished=true;this.connection.success(id);options.onStage?.('routing',detail());return result;
   }catch(error){
    finished=true;row.status='error';row.error=error.code||error.name;row.httpStatus=error.httpStatus??row.httpStatus??null;row.source=error.source||'';row.waitMs=Math.round(performance.now()-started);lastError=error;reason=row.error;
    options.onStage?.('routing',detail());if(!automatic||!shouldFailover(error))throw Object.assign(error,{attempts,attemptCount:attempt,operationId:options.operationId});
   }
  }
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const error=skipped.some(s=>s.includes('лимит записи'))?new SpeechError('no-compatible-server',{causeCode:lastError?.code}):lastError||new SpeechError('server-unavailable');
  throw Object.assign(error,{exhausted:true,attempts,attemptCount:attempts.length,skipped:skipped.join('; '),operationId:options.operationId});
 }
}
