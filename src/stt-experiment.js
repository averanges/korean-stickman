import {STT_VARIANTS,STT_KEYWORDS} from './stt-experiment-config.js';
const redacted=s=>String(s).replace(/\b(?:gsk_|sk-)[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|(?:OPENAI_API_KEY|GROQ_API_KEY)\s*[=:]\s*\S+/giu,'[скрыто]');
export class SttExperiment{
 constructor({endpoint,fetcher=(...a)=>fetch(...a),timeoutMs=55000,onChange=()=>{},now=()=>performance.now(),digest=async audio=>globalThis.crypto?.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await audio.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join(''):null}={}){Object.assign(this,{endpoint,fetcher,timeoutMs,onChange,now,digest});this.running=false;this.sequence=0;this.rows=[];this.history=[];this.clip=null;this.message='Сравнение ещё не запускалось.';}
 async run(clip,{reference=''}={}){
  if(this.running||!clip)return false;
  if(clip.language!=='ko'||clip.audio.size>4000000||clip.audio.size<128||clip.durationMs<500||clip.durationMs>300000){this.message='Нужна корейская запись до 4 МБ и 5 минут.';this.onChange();return false;}
  const endpoint=this.endpoint();if(!endpoint){this.message='Для сравнения нужен настроенный Vercel.';this.onChange();return false;}
  const sequence=++this.sequence,controller=new AbortController();this.controller=controller;this.running=true;this.clip={operationId:clip.operationId,mime:clip.audio.type,bytes:clip.audio.size,durationMs:clip.durationMs,language:clip.language,reference:String(reference).slice(0,500),sha256:null};this.rows=STT_VARIANTS.map(v=>({...v,state:'waiting',requested:false}));this.message='Сравниваем одну запись. Игровые действия не выполняются.';this.onChange();
  try{
   this.clip.sha256=await this.digest(clip.audio);if(sequence!==this.sequence||controller.signal.aborted)return false;
   for(const row of this.rows){
    if(controller.signal.aborted||sequence!==this.sequence)break;
    row.state='running';row.requested=true;this.onChange();const started=this.now(),abort=new AbortController();let timer,stop;
    const cancelled=new Promise((_,reject)=>{stop=()=>{reject(new DOMException('Cancelled','AbortError'));abort.abort();};controller.signal.addEventListener('abort',stop,{once:true});});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('timeout'));abort.abort();},this.timeoutMs);});
    try{
     const work=(async()=>{const r=await this.fetcher(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':clip.audio.type,'X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':String(Math.round(clip.durationMs)),'X-STT-Language':'ko','X-STT-Experiment':row.id},body:clip.audio,signal:abort.signal});let data;try{data=await r.json();}catch{throw Object.assign(Error(r.status===404?'experiment-not-deployed':'invalid-response'),{httpStatus:r.status});}
      if(!r.ok)throw Object.assign(Error(typeof data.error==='string'?data.error:'provider-error'),{httpStatus:r.status,providerHttpStatus:data.providerHttpStatus,source:data.source});
      if(data.ok!==true||data.experimentVersion!=='3.0.2'||data.variant!==row.id||data.provider!==row.provider||typeof data.model!=='string'||typeof data.text!=='string'||data.text.length>4000||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(data.sha256)||this.clip.sha256&&data.sha256!==this.clip.sha256)throw Error('invalid-response');return data;
     })();
     const data=await Promise.race([work,timeout,cancelled]);if(controller.signal.aborted||sequence!==this.sequence)break;
     if(!this.clip.sha256)this.clip.sha256=data.sha256;
     Object.assign(row,{state:'ok',model:data.model,rawText:data.text,serverMs:data.elapsedMs,elapsedMs:Math.round(this.now()-started),quality:data.quality,sha256:data.sha256,context:data.context,extraKeywords:this.clip.reference?STT_KEYWORDS.filter(w=>!this.clip.reference.includes(w)&&data.text.includes(w)):[]});
    }catch(error){if(controller.signal.aborted||sequence!==this.sequence)break;Object.assign(row,{state:'error',error:error.name==='AbortError'?'interrupted':error.message||'network',httpStatus:error.httpStatus??null,providerHttpStatus:error.providerHttpStatus??null,source:error.source??null,elapsedMs:Math.round(this.now()-started)});if(error.httpStatus===404){for(const other of this.rows.filter(r=>r.state==='waiting'))Object.assign(other,{state:'error',error:'experiment-not-deployed'});break;}}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
    this.onChange();
   }
  }catch{this.message='Не удалось подготовить запись к сравнению.';}
  finally{if(sequence===this.sequence){this.running=false;for(const row of this.rows)if(['running','waiting'].includes(row.state))row.state='cancelled';this.history.push(structuredClone({clip:this.clip,rows:this.rows}));this.history=this.history.slice(-20);this.message=controller.signal.aborted?'Сравнение отменено. Результаты завершённых запросов сохранены.':'Сравнение завершено. Результаты не передавались интерпретатору.';this.onChange();}}
  return true;
 }
 cancel(){this.controller?.abort();}
 clear({keepHistory=false}={}){this.cancel();this.sequence++;this.running=false;this.rows=[];this.clip=null;if(!keepHistory)this.history=[];this.message=keepHistory?'Предыдущие сравнения сохранены в отчёте; можно записать новую фразу.':'Запись и результаты сравнения удалены из памяти.';this.onChange();}
 report(){return 'Эксперимент STT 3.0.2 (только текущая сессия)\n'+redacted(JSON.stringify({endpoint:this.endpoint(),clip:this.clip,message:this.message,rows:this.rows,history:this.history},null,2));}
}
