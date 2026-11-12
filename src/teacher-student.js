import {LessonApi,LessonError,consumeInvite,readSession,writeSession,roomToken,roomId,lessonMessage} from './teacher-api.js';
import {teacherApiBase} from './teacher-config.js';
import {TeacherCommandBridge} from './teacher-bridge.js';
const STORAGE_KEY='korean-stickman.lesson.student';
// Strip invitation fragments before starting game networking. No invite is ever placed in a query string.
let incoming=null,inviteError=null;try{if(globalThis.location)incoming=consumeInvite();}catch(error){inviteError=error;}
export class StudentLesson{
 constructor({api=new LessonApi(teacherApiBase()),storage,locks=globalThis.navigator?.locks,snapshot,execute,level,restoreLevel,correct,cancel,onChange=()=>{},pollMs=1000,now=Date.now,schedule=setTimeout,unschedule=clearTimeout}={}){
  Object.assign(this,{api,storage,locks,snapshot,execute,level,restoreLevel,correct,cancel,onChange,pollMs,now});
  // Window timers reject a StudentLesson receiver. Keep injected/native timers as plain calls.
  this.schedule=(...args)=>schedule(...args);this.unschedule=(...args)=>unschedule(...args);if(storage===undefined){try{this.storage=globalThis.sessionStorage;}catch{this.storage=null;}}this.status='idle';this.enabled=false;this.events=[];this.connected=false;this.authorized=false;this.ended=false;this.inflight=null;this.processing=new Set();this.leaseId=null;this.generation=0;
 }
 state(status,message){this.status=status;this.message=message;this.onChange(this);}
 async start(invitation=incoming){
  if(inviteError){this.state('error',lessonMessage(inviteError));return;}
  let saved=readSession(this.storage,STORAGE_KEY);
  if(invitation){if(saved&&saved.roomId!==invitation.roomId){this.bridge?.end();try{this.storage.removeItem('korean-stickman.lesson.commands.'+saved.roomId);}catch{}}saved=saved?.roomId===invitation.roomId&&saved.studentToken?saved:{...invitation,studentToken:roomToken()};writeSession(this.storage,STORAGE_KEY,saved);incoming=null;}
  if(!saved)return;
  if(saved.expiresAt&&saved.expiresAt<=this.now()){this.forget(saved.roomId);this.state('ended','Срок урока истёк.');return;}
  if(!this.locks){this.state('error',lessonMessage(new LessonError('locks-unavailable')));return;}
  this.leaseId=roomId();this.credentials=saved;if(['creator','home'].includes(saved.level))this.restoreLevel?.(saved.level);this.enabled=true;this.ended=false;
  this.bridge=new TeacherCommandBridge({storage:this.storage,key:'korean-stickman.lesson.commands.'+saved.roomId,level:this.level,execute:this.execute,correct:this.correct,cancel:this.cancel});
  // A held Web Lock blocks duplicated tabs even if sessionStorage was copied by the browser.
  this.lockTask=this.locks.request('korean-stickman.lesson.'+saved.roomId,{ifAvailable:true},async lock=>{
   if(!lock){this.state('conflict','Урок уже открыт в другой вкладке. Закрой её и обнови эту страницу.');return;}
   this.hasLock=true;const held=new Promise(resolve=>this.unlock=resolve);this.state('connecting','Подключаемся к уроку…');this.tick();await held;this.hasLock=false;
  }).catch(()=>this.state('error',lessonMessage(new LessonError('locks-unavailable'))));
 }
 get sharing(){return this.enabled&&this.authorized&&this.hasLock&&!this.ended;}
 event(type,details={}){
  if(!this.sharing)return;
  const {attemptId=null,text='',server='',result=''}=details;
  this.events.push({id:roomId(),type,attemptId,text:String(text).slice(0,700),server:String(server).slice(0,80),result:String(result).slice(0,500)});this.events=this.events.slice(-50);
 }
 async call(route,body){const c=this.credentials;return this.api.request('/'+c.roomId+'/'+route,body,c.studentToken);}
 async tick(){
  if(this.ended||!this.hasLock)return;
  try{await this.sync();}finally{if(!this.ended&&this.hasLock)this.timer=this.schedule(()=>this.tick(),this.pollMs);}
 }
 async sync(){if(this.inflight)return this.inflight;this.inflight=this.syncWork().finally(()=>this.inflight=null);return this.inflight;}
 async syncWork(){
  const generation=this.generation,c=this.credentials;
  try{
   if(c.inviteToken){const joined=await this.api.request('/'+c.roomId+'/join',{inviteToken:c.inviteToken,studentToken:c.studentToken,leaseId:this.leaseId});if(this.ended||generation!==this.generation)return;if(joined.serverVersion!=='0.3.0')throw new LessonError('server-version-mismatch');delete c.inviteToken;c.expiresAt=joined.expiresAt;writeSession(this.storage,STORAGE_KEY,c);}
   const events=this.events.slice(0,4),snapshot=this.snapshot();c.level=snapshot.level;writeSession(this.storage,STORAGE_KEY,c);const data=await this.call('student-sync',{leaseId:this.leaseId,snapshot,events});if(this.ended||generation!==this.generation)return;
   c.expiresAt=data.expiresAt;writeSession(this.storage,STORAGE_KEY,c);this.events.splice(0,events.length);this.connected=true;this.authorized=true;this.state('connected','Подключено к преподавателю');
   for(const command of data.commands){if(this.processing.has(command.id))continue;this.processing.add(command.id);this.bridge.deliver(command,(id,status,message,result)=>this.ack(id,status,message,result)).catch(error=>this.handleError(error)).finally(()=>this.processing.delete(command.id));}
  }catch(error){this.handleError(error);}
 }
 async ack(id,status,message,result={}){if(this.ended)throw new LessonError('lesson-ended');try{return await this.call('ack',{leaseId:this.leaseId,id,status,message,...(result.reason?{reason:result.reason}:{}),...(result.missing?.length?{missing:result.missing}:{})});}catch(error){this.handleError(error);throw error;}}
 handleError(error){
  this.connected=false;
  if(['server-version-mismatch','lesson-ended','invalid-invitation','invitation-used','forbidden','storage-unavailable'].includes(error?.code)){this.finish();this.state('ended',lessonMessage(error));}
  else if(error?.code==='student-active-elsewhere'){this.state('conflict',lessonMessage(error));}
  else this.state('reconnecting',lessonMessage(error));
 }
 forget(roomId=this.credentials?.roomId){try{this.storage.removeItem(STORAGE_KEY);if(roomId)this.storage.removeItem('korean-stickman.lesson.commands.'+roomId);}catch{}}
 finish(){this.ended=true;this.enabled=false;this.connected=false;this.generation++;this.unschedule(this.timer);this.bridge?.end();this.unlock?.();this.events=[];this.forget();}
 async disconnect(){if(!this.credentials)return;const credentials=this.credentials,leaseId=this.leaseId;this.finish();this.state('ended','Подключение к уроку отключено.');try{await this.api.request('/'+credentials.roomId+'/leave',{leaseId},credentials.studentToken);}catch{}}
 release(){if(this.hasLock&&!this.ended)void this.api.request('/'+this.credentials.roomId+'/leave',{leaseId:this.leaseId},this.credentials.studentToken,{keepalive:true}).catch(()=>{});}
}
