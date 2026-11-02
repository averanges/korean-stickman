import {analyzeLocal,anchored,grammarFeatures,normalizeText} from './language-local.js';
import {validateDocument,validateForWorld,engineCommand,documentOf} from './language-contract.js';
export function checkInterpretation(document,text,context){
 if(!validateDocument(document,context.level))return false;
 if(grammarFeatures(text).unsafe&&document.status==='resolved')return false;
 return document.intents.every(i=>anchored(i,text,context));
}
export class LanguageService{
 constructor({fetcher=(...args)=>fetch(...args),endpoint=()=>'/interpret',timeoutMs=10000,now=()=>performance.now()}={}){Object.assign(this,{fetcher,endpoint,timeoutMs,now});}
 async interpret(raw,context,{signal,profile,voice=false,allowLlm=true}={}){
  const started=this.now(),local=analyzeLocal(raw,context,{profile,voice}),localMs=this.now()-started;let document=local.document,method=local.document.status==='resolved'?'local':'unresolved',llmCalled=false,llmRequested=false,llmError=null,llmMs=0,server=null;
  if(!local.terminal&&allowLlm){
   const controller=new AbortController();let timer,abort,settled=false;const begun=this.now();
   const cancelled=new Promise((_,reject)=>{abort=()=>{controller.abort();reject(new DOMException('Cancelled','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('llm-timeout'));},this.timeoutMs);});
   try{
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');server=this.endpoint();if(!server)throw Error('llm-not-configured');llmRequested=true;llmCalled=null;
    const work=(async()=>{const response=await this.fetcher(server,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Requested-With':'KoreanStickman'},body:JSON.stringify({text:raw,context,input:voice?'voice':'text'}),signal:controller.signal});if(settled)throw Error('llm-timeout');let data;try{data=await response.json();}catch{throw Error(response.status===404?'llm-not-deployed':'llm-invalid-response');}if(typeof data.llmCalled==='boolean')llmCalled=data.llmCalled;if(!response.ok){if(response.status===404)llmCalled=false;throw Error(response.status===404?'llm-not-deployed':response.status===429?'llm-rate-limit':data.error==='llm-auth'?'llm-auth':'llm-unavailable');}if(data?.ok!==true||!['local','llm','unresolved'].includes(data.method)||!checkInterpretation(data.interpretation,raw,context))throw Error('llm-invalid-response');return data;})();
    const data=await Promise.race([work,timeout,cancelled]);document=data.interpretation;method=document.status==='resolved'?data.method:'unresolved';
   }catch(error){if(error.name==='AbortError'&&signal?.aborted)throw error;llmError=['llm-timeout','llm-not-configured','llm-not-deployed','llm-rate-limit','llm-unavailable','llm-invalid-response','llm-auth'].includes(error.message)?error.message:'llm-unavailable';}
   finally{settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);llmMs=this.now()-begun;}
  }
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const validating=this.now(),validation=validateForWorld(document,context,{legacyBatch:local.legacyBatch}),validationMs=this.now()-validating;
  return {raw,normalized:normalizeText(raw),local:local.document,interpretation:document,method,llmCalled,llmRequested,llmError,server,hint:local.hint,candidates:local.candidates,basis:method==='llm'?'validated-llm':local.usesContext?'unique-context':'unambiguous',features:local.features,usesContext:Boolean(local.usesContext||llmRequested),legacyBatch:Boolean(local.legacyBatch),validation,command:validation.ok?engineCommand(document,raw):null,timing:{localMs,llmMs,validationMs,totalMs:this.now()-started}};
 }
 confirm(result,index,context){const candidate=result.candidates[index];if(!candidate)return null;const document=documentOf('resolved',[candidate]);const validation=validateForWorld(document,context);return {...result,interpretation:document,validation,command:validation.ok?engineCommand(document,result.raw):null,basis:'user-confirmation',method:'local'};}
}
export function languageMessage(result){
 if(result.validation?.message)return result.validation.message;
 const reason=result.interpretation.reason;
 if(reason==='location')return result.candidates.length?`Я услышал «${result.raw}». Ты хотел создать предмет?`:`Я услышал «${result.raw}». Это может быть описанием местоположения; создание предмета не запускаю.`;
 if(reason==='ambiguous')return 'Неясно, какой вариант ты имеешь в виду. Уточни объект или утверждение.';
 if(reason==='unsafe')return 'Я услышал вопрос, отрицание, прошедшее время или рассказ о другом человеке. Новое действие не запускаю.';
 if(reason==='incomplete')return 'Фраза ещё не закончена. Попробуй произнести её целиком.';
 if(reason==='multiple-actions')return 'Вижу несколько действий. Скажи их по одному.';
 if(result.llmError)return 'Не удалось уверенно понять фразу. Простые знакомые команды продолжают работать; попробуй сказать короче.';
 return 'Эта фраза пока не относится к поддерживаемым действиям. Попробуй знакомую короткую команду.';
}
