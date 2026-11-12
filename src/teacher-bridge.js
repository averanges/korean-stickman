import {validRoomOperation,roomOperations,teacherCommandLevel,REACTIONS} from './teacher-room.js';
import {validAge,validFamily} from './identity-topics.js';
import {catalogs} from './catalog.js';
import {writeSession,readSession} from './teacher-api.js';
const terminal=new Set(['executed','rejected','blocked','error']);
export function engineTeacherCommand(command){
 if(command.action==='room')return roomOperations(command)?{ok:true,source:'teacher',teacherRoom:true,commands:roomOperations(command)}:null;
 if(command.action==='set_age')return validAge(command.age)?{ok:true,action:'set_age',age:command.age,source:'teacher'}:null;
 if(command.action==='family')return validFamily(command.members)&&command.members.length&&typeof command.present==='boolean'?{ok:true,action:'family',members:command.members,present:command.present,source:'teacher'}:null;
 if(command.action==='feedback'&&REACTIONS.includes(command.value)&&!command.field)return {ok:true,action:'teacher_feedback',cue:command.value,source:'teacher'};
 if(command.action==='apply'){const entries=Object.entries(command.attributes||{});if(!entries.length||entries.length>3||entries.some(([f,v])=>!Object.hasOwn(catalogs,f)||!Object.hasOwn(catalogs[f],v)))return null;return {ok:true,action:'batch',source:'teacher',commands:entries.map(([field,value],i)=>({...engineTeacherCommand({action:'set',field,value}),source:i?'teacher-batch':'teacher'}))};}
 if(command.action==='greet'&&!command.field&&!command.value)return {ok:true,action:'greet',canonical:'안녕하세요',source:'teacher'};
 if(command.action!=='set'||!Object.hasOwn(catalogs,command.field)||!Object.hasOwn(catalogs[command.field],command.value))return null;
 return {ok:true,action:'set',field:command.field,value:command.value,canonical:catalogs[command.field][command.value].ko+'입니다',source:'teacher'};
}
export class TeacherCommandBridge{
 constructor({storage,key,level,execute,correct=()=>{},cancel=()=>{},timeoutMs=55000,roomTimeoutMs=110000}={}){Object.assign(this,{storage,key,level,execute,correct,cancel,timeoutMs,roomTimeoutMs});this.journal=readSession(storage,key)||{};this.queue=Promise.resolve();this.pending=new Map();this.active=false;this.closed=false;}
 save(id,record){Object.defineProperty(this.journal,id,{value:record,enumerable:true,writable:true,configurable:true});const keys=Object.keys(this.journal);for(const old of keys.slice(0,Math.max(0,keys.length-100)))delete this.journal[old];writeSession(this.storage,this.key,this.journal);}
 deliver(command,ack){
  if(this.pending.has(command.id))return this.pending.get(command.id);
  const task=this.queue.then(()=>this.run(command,ack));this.queue=task.catch(()=>{});this.pending.set(command.id,task);task.finally(()=>this.pending.delete(command.id)).catch(()=>{});return task;
 }
 async run(command,ack){
  if(this.closed)return;
  let record=Object.hasOwn(this.journal,command.id)?this.journal[command.id]:null;
  if(record?.state==='started'){record={state:'error',message:'Страница обновилась во время действия. Результат неизвестен; повторного выполнения не будет.'};this.save(command.id,record);}
  if(terminal.has(record?.state))return ack(command.id,record.state,record.message,{reason:record.reason||'',missing:record.missing||[]});
  const engine=engineTeacherCommand(command),expectedLevel=teacherCommandLevel(command);
  if(!engine||this.level()!==expectedLevel){record={state:'rejected',message:'Команда недоступна на текущем уровне.'};this.save(command.id,record);return ack(command.id,record.state,record.message,{reason:record.reason||'',missing:record.missing||[]});}
  // Store before delivery acknowledgement; an unavailable store must never permit execution.
  this.save(command.id,{state:'received'});const receipt=await ack(command.id,'received','Получено учеником.');
  if(this.closed||!receipt.accepted)return;
  if(this.level()!==expectedLevel){this.save(command.id,{state:'rejected',message:'Ученик перешёл на другой уровень.'});return ack(command.id,'rejected','Ученик перешёл на другой уровень.');}
  this.save(command.id,{state:'started'});this.active=true;this.engineStarted=false;let timer,expired=false;
  try{
   if(command.correctsAttemptId)this.correct(command.correctsAttemptId);
   const result=await Promise.race([Promise.resolve().then(()=>this.closed?{cancelled:true}:this.execute(engine,{correctsAttemptId:command.correctsAttemptId||null,onStart:async()=>{if(this.closed||expired)return false;const running=await ack(command.id,'running','Выполняется игровым движком.');this.engineStarted=!this.closed&&!expired&&running.accepted;return this.engineStarted;}})),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;if(expectedLevel!=='home'||this.engineStarted)this.cancel();reject(Error('timeout'));},expectedLevel==='home'?this.roomTimeoutMs:this.timeoutMs);})]);
   const outcomes=Array.isArray(result)?result:[result],outcome=outcomes.every(r=>r?.type==='success')?{type:'success',message:outcomes.map(r=>r.message).filter(Boolean).join(' · ')}:outcomes.find(r=>r?.type!=='success');
   record=outcome?.type==='success'?{state:'executed',message:outcome.message||'Подтверждено игровым движком.'}:outcome?.type==='blocked'?{state:'blocked',message:outcome.message,reason:outcome.reason,missing:outcome.missing||[]}:outcome?.type==='error'?{state:'error',message:outcome.message}:{state:'rejected',message:outcome?.message||'Действие отменено игровым движком.'};
  }catch{record={state:'error',message:'Игровое действие не подтверждено или истекло время ожидания.'};}
  finally{clearTimeout(timer);this.active=false;}
  if(this.closed)return;this.save(command.id,record);return ack(command.id,record.state,record.message,{reason:record.reason||'',missing:record.missing||[]});
 }
 end(){this.closed=true;if(this.active&&(this.level()!=='home'||this.engineStarted))this.cancel();}
}
