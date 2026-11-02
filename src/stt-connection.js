import {ServerChecks} from './stt-servers.js';
export const SERVER_ORDER=['render','vercel','netlify'];
const STORAGE_KEY='korean-stickman-stt-server';
// One bounded parallel check. Late health replies update diagnostics, never an active operation.
export class SttConnection{
 constructor(registry,{fetcher,onChange=()=>{},isBusy=()=>false,storage,windowMs=2500,selectionMs=8000,probeMs=8000,now=Date.now}={}){
  Object.assign(this,{registry,onChange,isBusy,storage,windowMs,selectionMs,now});this.mode='auto';this.state='idle';this.configured=false;this.lastChecked=0;this.pending=null;
  try{this.storage=storage===undefined?globalThis.localStorage:storage;const saved=this.storage?.getItem(STORAGE_KEY);this.lastSuccess=SERVER_ORDER.includes(saved)?saved:null;}catch{}
  this.checks=new ServerChecks(registry,{...(fetcher?{fetcher}:{}),timeoutMs:probeMs,resolveUrl:e=>e.id==='render'&&registry.endpoint(e.id,'health',{local:true}).startsWith('/')?'/health':e.url+'/health',onChange:()=>{this.evaluate?.();this.onChange(this);}});
 }
 get ready(){return this.state==='ready'&&this.configured&&this.registry.available(this.registry.selected);}
 change(state,error=null){this.state=state;this.error=error;this.configured=state==='ready';this.onChange(this);}
 usable(id){const r=this.checks.rows.get(id);return this.registry.available(id)&&r?.state==='ok'&&r.configured===true&&r.apiVersion==='1';}
 success(id){this.registry.select(id);this.lastSuccess=id;try{this.storage?.setItem(STORAGE_KEY,id);}catch{}this.change('ready');}
 setMode(mode){if(this.isBusy())return false;if(mode!=='auto'&&!this.registry.available(mode))return false;this.mode=mode;return true;}
 check(){if(this.pending)return this.pending;if(this.isBusy())return Promise.resolve(this.ready);this.pending=this.run().finally(()=>{this.pending=null;this.onChange(this);});return this.pending;}
 async run(){
  this.change('connecting');if(!this.checks.pending)this.checks.rows.clear();let windowPassed=false,settled=false,timer,deadline;
  return new Promise(resolve=>{
   const finish=id=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(deadline);this.evaluate=null;this.lastChecked=this.now();if(id&&this.isBusy()){this.deferred=id;resolve(false);}else if(id){this.registry.select(id);this.change('ready');resolve(true);}else{this.change('error','server-unavailable');resolve(false);}};
   const evaluate=()=>{
    if(settled)return;
    if(this.mode!=='auto'){const row=this.checks.rows.get(this.mode);if(this.usable(this.mode))finish(this.mode);else if(row&&row.state!=='checking')finish();return;}
    if(this.usable('render')){finish('render');return;}
    const render=this.checks.rows.get('render');const renderFinished=!this.registry.available('render')||(render&&render.state!=='checking');
    const vercel=this.checks.rows.get('vercel'),vercelFinished=!this.registry.available('vercel')||(vercel&&vercel.state!=='checking');
    const rememberedPending=this.lastSuccess&&this.registry.available(this.lastSuccess)&&(!this.checks.rows.has(this.lastSuccess)||this.checks.rows.get(this.lastSuccess).state==='checking');
    if(windowPassed||(renderFinished&&!rememberedPending&&(this.usable('vercel')||vercelFinished))){const candidates=[this.lastSuccess,...SERVER_ORDER].filter(Boolean);const id=candidates.find(id=>id!=='render'&&this.usable(id));if(id){finish(id);return;}}
    if(this.registry.entries.every(e=>!this.registry.available(e.id)||['ok','error','disabled','unconfigured'].includes(this.checks.rows.get(e.id)?.state)))finish();
   };
   this.evaluate=evaluate;timer=setTimeout(()=>{windowPassed=true;evaluate();},this.windowMs);deadline=setTimeout(()=>{windowPassed=true;evaluate();if(!settled)finish();},this.selectionMs);
   this.checks.checkAll().then(evaluate);evaluate();
  });
 }
 resume(){if(this.deferred&&!this.isBusy()){const id=this.deferred;this.deferred=null;if(this.usable(id)){this.registry.select(id);this.change('ready');}}}
 checkAfterIdle(){return this.now()-this.lastChecked>=600000?this.check():Promise.resolve(this.ready);}
}
