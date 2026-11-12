import {validRoomOperation,roomOperations,teacherCommandLevel,safeRoomSnapshot,REACTIONS,ROOM_OBJECT_IDS} from '../src/teacher-room.js';
import {validAge,validFamily} from '../src/identity-topics.js';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {ATTEMPT_STATUSES} from '../src/teacher-resolution.js';
import {catalogs} from '../src/catalog.js';
export const secret=()=>randomBytes(32).toString('hex');
const hash=s=>createHash('sha256').update(s).digest();
const token=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
const id=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{8,100}$/u.test(s)&&!['__proto__','constructor','prototype'].includes(s);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function shape(x,keys){if(!plain(x)||Object.keys(x).some(k=>!keys.includes(k)))throw new RoomError(400,'invalid-data');}
function text(x,max=500){if(x===undefined||x===null)return '';if(typeof x!=='string'||x.length>max)throw new RoomError(400,'invalid-data');return x;}
export class RoomError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const final=new Set(['executed','rejected','blocked','error','timeout']);
export function validCommand(input){
 shape(input,['id','action','field','value','attributes','age','members','present','operation','operations','level','correctsAttemptId']);
 if(!id(input.id)||!['set','greet','feedback','apply','set_age','family','room'].includes(input.action))throw new RoomError(400,'invalid-command');
 if(input.action==='room'){if(!roomOperations(input)||input.level!==undefined||['field','value','attributes','age','members','present'].some(k=>input[k]!==undefined))throw new RoomError(400,'invalid-command');}else if(input.operation!==undefined||input.operations!==undefined)throw new RoomError(400,'invalid-command');
 if(input.level!==undefined&&(input.action!=='feedback'||!['home','creator'].includes(input.level)))throw new RoomError(400,'invalid-command');
 if(input.action==='set'&&(!Object.hasOwn(catalogs,input.field)||!Object.hasOwn(catalogs[input.field],input.value)))throw new RoomError(400,'invalid-command');
 if(input.action==='greet'&&(input.field!==undefined||input.value!==undefined))throw new RoomError(400,'invalid-command');
 if(input.action==='feedback'&&(input.field!==undefined||!REACTIONS.includes(input.value)))throw new RoomError(400,'invalid-command');
 if(input.action==='apply'){if(input.field!==undefined||input.value!==undefined||!plain(input.attributes)||!Object.keys(input.attributes).length||Object.keys(input.attributes).length>3||Object.entries(input.attributes).some(([f,v])=>!Object.hasOwn(catalogs,f)||!Object.hasOwn(catalogs[f],v)))throw new RoomError(400,'invalid-command');}
 else if(input.attributes!==undefined)throw new RoomError(400,'invalid-command');
 if(input.action==='set_age'){if(!validAge(input.age)||input.field!==undefined||input.value!==undefined)throw new RoomError(400,'invalid-command');}else if(input.age!==undefined)throw new RoomError(400,'invalid-command');
 if(input.action==='family'){if(!validFamily(input.members)||!input.members.length||typeof input.present!=='boolean'||input.field!==undefined||input.value!==undefined)throw new RoomError(400,'invalid-command');}else if(input.members!==undefined||input.present!==undefined)throw new RoomError(400,'invalid-command');
 if(input.correctsAttemptId!==undefined&&input.correctsAttemptId!==null&&!id(input.correctsAttemptId))throw new RoomError(400,'invalid-command');
 return {...input};
}
function snapshot(input){
 shape(input,['level','profile','lastPhrase','interpretation','lastCommand','voiceAttemptId','attempt','room','voice']);
 if(!['creator','home'].includes(input.level))throw new RoomError(400,'invalid-data');
 shape(input.profile,['gender','country','profession','age','family','awake','name']);
 if(input.profile.age!==undefined&&input.profile.age!==null&&!validAge(input.profile.age)||input.profile.family!==undefined&&!validFamily(input.profile.family))throw new RoomError(400,'invalid-data');
 const profile={age:input.profile.age??null,family:input.profile.family||[],awake:input.profile.awake===true,name:text(input.profile.name,32)};
 for(const field of Object.keys(catalogs)){const value=input.profile[field]??null;if(value!==null&&!Object.hasOwn(catalogs[field],value))throw new RoomError(400,'invalid-data');profile[field]=value;}
 let attempt=null;if(input.attempt){const a=input.attempt;shape(a,['id','phrase','sttText','interpretation','status','suggestions','proposals','deadline']);if(!id(a.id)||!ATTEMPT_STATUSES.includes(a.status)||!(a.deadline===null||Number.isFinite(a.deadline))||!Array.isArray(a.suggestions)||a.suggestions.length>3)throw new RoomError(400,'invalid-data');if(a.proposals!==undefined&&(!Array.isArray(a.proposals)||a.proposals.length>3))throw new RoomError(400,'invalid-data');for(const c of a.proposals||[]){shape(c,['action','operation','operations']);if(c.action!=='room')throw new RoomError(400,'invalid-data');validCommand({id:'proposal',...c});}for(const attributes of a.suggestions)validCommand({id:'suggestion',action:'apply',attributes});attempt={id:a.id,phrase:text(a.phrase),sttText:text(a.sttText),interpretation:text(a.interpretation,1800),status:a.status,suggestions:a.suggestions,proposals:a.proposals||[],deadline:a.deadline};}
 const room=input.room===undefined||input.room===null?null:safeRoomSnapshot(input.room);if(input.room&&!room)throw new RoomError(400,'invalid-data');let voice=null;if(input.voice){shape(input.voice,['stage','server','error','technical']);if(typeof input.voice.technical!=='boolean')throw new RoomError(400,'invalid-data');voice={stage:text(input.voice.stage,40),server:text(input.voice.server,80),error:text(input.voice.error,80),technical:input.voice.technical};}
 return {level:input.level,profile,attempt,room,voice,lastPhrase:text(input.lastPhrase),interpretation:text(input.interpretation,3000),lastCommand:text(input.lastCommand,1000),voiceAttemptId:input.voiceAttemptId===null||input.voiceAttemptId===undefined?null:id(input.voiceAttemptId)?input.voiceAttemptId:(()=>{throw new RoomError(400,'invalid-data');})()};
}
const EVENT_TYPES=new Set(['recording-start','recording-end','upload-start','stt-server','transcript','interpretation','success','error','correction']);
function event(input){
 shape(input,['id','type','attemptId','text','server','result']);
 if(!id(input.id)||!EVENT_TYPES.has(input.type)||input.attemptId!==null&&input.attemptId!==undefined&&!id(input.attemptId))throw new RoomError(400,'invalid-event');
 return {id:input.id,type:input.type,attemptId:input.attemptId||null,text:text(input.text,3000),server:text(input.server,80),result:text(input.result,500)};
}
export class LessonRooms{
 constructor({now=Date.now,ttlMs=3600000,leaseMs=8000,commandMs=120000,maxRooms=100}={}){Object.assign(this,{now,ttlMs,leaseMs,commandMs,maxRooms});this.rooms=new Map();}
 cleanup(){for(const [key,r]of this.rooms)if(r.expiresAt<=this.now())this.rooms.delete(key);}
 create(){
  this.cleanup();if(this.rooms.size>=this.maxRooms)throw new RoomError(429,'room-capacity');
  const roomId=randomBytes(16).toString('hex'),teacherToken=secret(),inviteToken=secret();
  const room={id:roomId,expiresAt:this.now()+this.ttlMs,teacherHash:hash(teacherToken),inviteHash:hash(inviteToken),studentHash:null,leaseId:null,leaseUntil:0,lastSeen:0,joined:false,state:null,commands:[],events:[],eventIds:new Set(),attemptIds:new Set()};
  this.rooms.set(roomId,room);return {serverVersion:'0.3.0',roomId,teacherToken,inviteToken,expiresAt:room.expiresAt};
 }
 room(roomId){const r=this.rooms.get(roomId);if(!r||r.expiresAt<=this.now()){this.rooms.delete(roomId);throw new RoomError(410,'lesson-ended');}for(const command of r.commands)if(!final.has(command.status)&&command.expiresAt<=this.now()){command.status='timeout';command.message='Подтверждение выполнения не получено вовремя.';}return r;}
 match(value,digest){return token(value)&&Boolean(digest)&&timingSafeEqual(hash(value),digest);}
 auth(roomId,value,role){const r=this.room(roomId);if(!this.match(value,role==='teacher'?r.teacherHash:r.studentHash))throw new RoomError(403,'forbidden');return r;}
 lease(r,leaseId){
  if(!id(leaseId))throw new RoomError(400,'invalid-lease');
  if(r.leaseId!==leaseId&&r.leaseUntil>this.now())throw new RoomError(409,'student-active-elsewhere');
  r.leaseId=leaseId;r.leaseUntil=this.now()+this.leaseMs;r.lastSeen=this.now();
 }
 join(roomId,input){
  shape(input,['inviteToken','studentToken','leaseId']);const r=this.room(roomId);
  if(!this.match(input.inviteToken,r.inviteHash)||!token(input.studentToken)||input.studentToken===input.inviteToken||this.match(input.studentToken,r.teacherHash))throw new RoomError(403,'invalid-invitation');
  if(r.studentHash&&!this.match(input.studentToken,r.studentHash))throw new RoomError(409,'invitation-used');
  this.lease(r,input.leaseId);if(!r.studentHash)r.studentHash=hash(input.studentToken);r.joined=true;
  return {ok:true,serverVersion:'0.3.0',expiresAt:r.expiresAt};
 }
 studentSync(roomId,credential,input){
  shape(input,['leaseId','snapshot','events']);const r=this.auth(roomId,credential,'student');
  // Validate the entire payload before changing session state.
  const state=input.snapshot?snapshot(input.snapshot):null;
  if(input.events!==undefined&&(!Array.isArray(input.events)||input.events.length>12))throw new RoomError(400,'invalid-event');
  const events=(input.events||[]).map(event);this.lease(r,input.leaseId);if(state){r.state=state;if(state.voiceAttemptId)r.attemptIds.add(state.voiceAttemptId);if(state.attempt)r.attemptIds.add(state.attempt.id);}
  for(const item of events)if(!r.eventIds.has(item.id)){r.eventIds.add(item.id);r.events.push({...item,at:this.now()});if(item.attemptId)r.attemptIds.add(item.attemptId);}
  r.events=r.events.slice(-60);if(r.eventIds.size>300)r.eventIds=new Set(r.events.map(e=>e.id));if(r.attemptIds.size>100)r.attemptIds=new Set(r.events.map(e=>e.attemptId).filter(Boolean));
  return {ok:true,serverVersion:'0.3.0',expiresAt:r.expiresAt,commands:r.commands.filter(c=>!final.has(c.status)).map(c=>({...c}))};
 }
 teacherSync(roomId,credential){const r=this.auth(roomId,credential,'teacher');return {ok:true,serverVersion:'0.3.0',expiresAt:r.expiresAt,joined:r.joined,online:r.joined&&r.leaseUntil>this.now(),lastSeen:r.lastSeen,state:r.state,events:r.events,commands:r.commands};}
 command(roomId,credential,input){
  const r=this.auth(roomId,credential,'teacher'),command=validCommand(input),existing=r.commands.find(c=>c.id===command.id);
  if(existing){if(JSON.stringify(existing.input)!==JSON.stringify(command))throw new RoomError(409,'command-id-conflict');return {ok:true,command:existing};}
  if(r.commands.filter(c=>!final.has(c.status)).length>=6)throw new RoomError(429,'command-queue-full');
  if(command.correctsAttemptId&&!r.attemptIds.has(command.correctsAttemptId))throw new RoomError(400,'unknown-attempt');
  const denied=r.state?.level&&r.state.level!==teacherCommandLevel(command);const item={...command,input:command,status:denied?'rejected':'sent',message:denied?'Ученик находится на другом уровне.':'',createdAt:this.now(),expiresAt:this.now()+this.commandMs};
  r.commands.push(item);r.commands=r.commands.slice(-100);return {ok:true,command:item};
 }
 acknowledge(roomId,credential,input){
  shape(input,['leaseId','id','status','message','reason','missing']);const r=this.auth(roomId,credential,'student');
  if(r.leaseId!==input.leaseId||r.leaseUntil<=this.now())throw new RoomError(409,'lease-expired');
  const c=r.commands.find(c=>c.id===input.id);if(!c)throw new RoomError(404,'command-not-found');
  const message=text(input.message,500);if(!['received','running','executed','blocked','rejected','error'].includes(input.status))throw new RoomError(400,'invalid-ack');
  if(final.has(c.status))return {ok:true,accepted:c.status===input.status,command:c};
  if(input.status==='executed'&&!['received','running'].includes(c.status))throw new RoomError(409,'not-received');
  if(input.status==='running'&&!['received','running'].includes(c.status))throw new RoomError(409,'not-received');
  if(['executed','blocked'].includes(input.status)&&!['received','running'].includes(c.status))throw new RoomError(409,'not-received');
  const reason=text(input.reason,80),missing=input.missing||[];if(!Array.isArray(missing)||missing.length>ROOM_OBJECT_IDS.length||missing.some(id=>!ROOM_OBJECT_IDS.includes(id)))throw new RoomError(400,'invalid-data');
  c.status=input.status;c.message=message;c.reason=reason;c.missing=missing;c.updatedAt=this.now();return {ok:true,accepted:true,command:c};
 }
 leave(roomId,credential,input){shape(input,['leaseId']);const r=this.auth(roomId,credential,'student');if(r.leaseId===input.leaseId){r.leaseUntil=0;r.lastSeen=0;}return {ok:true};}
 close(roomId,credential){this.auth(roomId,credential,'teacher');this.rooms.delete(roomId);return {ok:true};}
}
