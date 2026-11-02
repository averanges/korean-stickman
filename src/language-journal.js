const redact=s=>String(s).replace(/\b(?:gsk_|sk-)[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|(?:GROQ_API_KEY|LLM_API_KEY|token|cookie)\s*[=:]\s*\S+/giu,'[скрыто]');
export class LanguageJournal{
 constructor(onChange=()=>{}){this.records=[];this.onChange=onChange;this.cached='Языковой слой: команд ещё нет.';this.sequence=0;}
 start(result,input){const record={id:++this.sequence,input,raw:result.raw,normalized:result.normalized,local:result.local,features:result.features,method:result.method,llmCalled:result.llmCalled,llmRequested:result.llmRequested,llmError:result.llmError,llmServer:result.server,intent:result.interpretation,basis:result.basis||(result.usesContext?'context':'unambiguous'),hint:result.hint||null,validation:result.validation,outcome:result.validation.ok?'ready':result.interpretation.status==='clarify'?'clarification':'rejected',timing:{...result.timing,executionMs:0}};this.records.push(record);this.records=this.records.slice(-50);this.refresh();return record;}
 finish(record,outcome,ms=0){record.outcome=outcome;record.timing.executionMs=ms;this.refresh();}
 refresh(){this.cached='Korean Stickman — языковой слой V3.0 (текущая сессия, до 50 команд)\n'+this.records.map(r=>redact(JSON.stringify(r,null,2))).join('\n\n');this.onChange();}
 report(){return this.cached;}
}
