import {catalogs} from './catalog.js';
export const ATTEMPT_STATUSES=['auto','waiting_teacher','executed','rejected','blocked','timeout'];
export function teacherSuggestions(result){
 const groups=[];
 for(const intent of [...(result?.interpretation?.intents||[]),...(result?.candidates||[])]){
  if(intent.kind!=='set_character_attributes'||intent.polarity!=='positive'||!['statement','instruction'].includes(intent.speechAct)||!['present','dictionary'].includes(intent.tense))continue;
  const attributes=Object.fromEntries(Object.entries(intent.attributes||{}).filter(([field,value])=>Object.hasOwn(catalogs,field)&&Object.hasOwn(catalogs[field],value)));
  if(Object.keys(attributes).length)groups.push(attributes);
 }
 const merged={};for(const group of groups)for(const [field,value]of Object.entries(group)){if(merged[field]&&merged[field]!==value)return groups.slice(0,3);merged[field]=value;}
 const singles=Object.entries(merged).map(([field,value])=>({[field]:value}));return (singles.length>1?[...singles.slice(0,2),merged]:singles).slice(0,3);
}
export class TeacherResolution{
 constructor({now=Date.now,schedule=(...a)=>setTimeout(...a),unschedule=id=>clearTimeout(id),cue=()=>{},onChange=()=>{},waitMs=5000}={}){Object.assign(this,{now,schedule,unschedule,cue,onChange,waitMs});this.attempt=null;this.timer=null;}
 publish(){this.onChange(this.attempt);}
 clearTimer(){this.unschedule(this.timer);this.timer=null;}
 begin(id){this.clearTimer();this.cue('reset');this.attempt={id,phrase:'',sttText:'',interpretation:'',status:'auto',suggestions:[],proposals:[],deadline:null};this.publish();}
 update(id,patch){if(this.attempt?.id!==id)return false;Object.assign(this.attempt,patch);this.publish();return true;}
 wait(id,{animate=true}={}){if(this.attempt?.id!==id)return;this.clearTimer();const deadline=this.now()+this.waitMs;this.update(id,{status:'waiting_teacher',deadline});if(animate)this.cue('thinking');this.timer=this.schedule(()=>{if(this.attempt?.id!==id||this.attempt.status!=='waiting_teacher')return;this.timer=null;this.update(id,{status:'timeout',deadline:null});this.cue('reset');},this.waitMs);}
 claim(id){if(this.attempt?.id!==id)return false;this.clearTimer();this.update(id,{status:'auto',deadline:null});return true;}
 finish(id,status){if(this.attempt?.id!==id)return;this.clearTimer();this.update(id,{status,deadline:null});}
 reset(){this.clearTimer();this.attempt=null;this.publish();}
}
