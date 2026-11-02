import {apiUrl} from './api-config.js';
// A bounded wake-up check, never a keep-alive loop. It does not call Groq.
export class VoiceHealth {
 constructor({fetcher=(...args)=>fetch(...args),resolveUrl=apiUrl,onChange=()=>{},now=Date.now,attemptMs=20000,totalMs=75000,delays=[5000,10000]}={}){Object.assign(this,{fetcher,resolveUrl,onChange,now,attemptMs,totalMs,delays});this.state='idle';this.configured=null;this.lastChecked=0;this.pending=null;}
 get ready(){return this.state==='ready'&&this.configured===true;}
 change(state,extra={}){this.state=state;Object.assign(this,extra);this.onChange(this);}
 check(){if(this.pending)return this.pending;this.pending=this.run().finally(()=>{this.pending=null;});return this.pending;}
 cancel(){this.cancelled=true;this.controller?.abort();this.cancelWait?.();}
 async run(){
  const started=this.now();this.change('connecting',{error:null,attempt:0,httpStatus:null});
  try{
   const url=this.resolveUrl('/api/stt/status');
   for(let i=0;i<=this.delays.length;i++){
    if(this.cancelled)return false;
    if(i){const remaining=this.totalMs-(this.now()-started);if(remaining<=this.delays[i-1])break;await new Promise(resolve=>{const timer=setTimeout(resolve,this.delays[i-1]);this.cancelWait=()=>{clearTimeout(timer);resolve();};});if(this.cancelled)return false;}
    const left=this.totalMs-(this.now()-started);if(left<=0)break;
    this.change('connecting',{attempt:i+1});const controller=this.controller=new AbortController();let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('health-timeout'));},Math.min(this.attemptMs,left));});
    try{const {response,data}=await Promise.race([(async()=>{const response=await this.fetcher(url,{method:'GET',credentials:'omit',cache:'no-store',signal:controller.signal});return {response,data:await response.json()};})(),timeout]);if(this.cancelled)return false;this.httpStatus=response.status;if(!response.ok||typeof data.configured!=='boolean')throw Error('server-unavailable');this.lastChecked=this.now();this.change('ready',{configured:data.configured,limits:data.limits,version:data.version});return this.ready;}
    catch{}finally{clearTimeout(timer);}
   }
   if(this.cancelled)return false;this.lastChecked=this.now();this.change('error',{error:'server-unavailable'});return false;
  }catch(error){this.lastChecked=this.now();this.change('error',{error:error.code==='api-unconfigured'?'api-unconfigured':'server-unavailable'});return false;}
 }
 checkAfterIdle(){if(this.now()-this.lastChecked>=600000)return this.check();return this.pending||Promise.resolve(this.ready);}
}
