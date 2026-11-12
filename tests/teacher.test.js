import test from 'node:test';import assert from 'node:assert/strict';import {LessonRooms,RoomError,secret} from '../teacher-service/rooms.mjs';import {createTeacherServer} from '../teacher-service/server.mjs';import {LessonApi,LessonError,consumeInvite,lessonMessage} from '../src/teacher-api.js';import {TeacherCommandBridge} from '../src/teacher-bridge.js';import {StudentLesson} from '../src/teacher-student.js';import {WorldState} from '../src/world.js';import {ActionController} from '../src/controller.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),map};};
const profile=()=>({name:'',awake:false,country:null,profession:null,gender:null}),state=()=>({level:'creator',profile:profile(),lastPhrase:'',interpretation:'',lastCommand:'',voiceAttemptId:null});
const command=(extra={})=>({id:crypto.randomUUID(),action:'set',field:'country',value:'russia',...extra});
function joined(options={}){const rooms=new LessonRooms(options),created=rooms.create(),student=secret(),lease=crypto.randomUUID();rooms.join(created.roomId,{inviteToken:created.inviteToken,studentToken:student,leaseId:lease});rooms.studentSync(created.roomId,student,{leaseId:lease,snapshot:state()});return {rooms,created,student,lease};}
const throws=(fn,status)=>assert.throws(fn,e=>e instanceof RoomError&&e.status===status);
test('cryptographic roles are distinct; invitation is single use, retry-safe and cannot become a teacher credential',()=>{
 const {rooms,created,student,lease}=joined();assert.match(created.teacherToken,/^[a-f0-9]{64}$/);assert.notEqual(created.teacherToken,created.inviteToken);assert.notEqual(created.roomId,created.teacherToken);
 throws(()=>rooms.teacherSync(created.roomId,student),403);throws(()=>rooms.teacherSync(created.roomId,created.inviteToken),403);throws(()=>rooms.studentSync(created.roomId,created.teacherToken,{leaseId:lease}),403);
 assert.equal(rooms.join(created.roomId,{inviteToken:created.inviteToken,studentToken:student,leaseId:lease}).ok,true);
 throws(()=>rooms.join(created.roomId,{inviteToken:created.inviteToken,studentToken:secret(),leaseId:crypto.randomUUID()}),409);
 const fresh=rooms.create();throws(()=>rooms.join(fresh.roomId,{inviteToken:fresh.inviteToken,studentToken:fresh.teacherToken,leaseId:lease}),403);
 const dump=JSON.stringify(rooms.teacherSync(created.roomId,created.teacherToken));for(const credential of [created.teacherToken,created.inviteToken,student])assert.ok(!dump.includes(credential));
});
test('active document lease blocks a second tab, refresh can resume after release or expiry',()=>{
 let now=1000;const {rooms,created,student,lease}=joined({now:()=>now,leaseMs:8000});const next=crypto.randomUUID();throws(()=>rooms.studentSync(created.roomId,student,{leaseId:next}),409);assert.equal(rooms.teacherSync(created.roomId,created.teacherToken).online,true);now+=8001;assert.equal(rooms.teacherSync(created.roomId,created.teacherToken).online,false);assert.equal(rooms.studentSync(created.roomId,student,{leaseId:next}).ok,true);throws(()=>rooms.studentSync(created.roomId,student,{leaseId:lease}),409);rooms.leave(created.roomId,student,{leaseId:next});assert.equal(rooms.teacherSync(created.roomId,created.teacherToken).online,false);
});
test('expiry and teacher close immediately revoke both roles and invitation; no permanent rooms',()=>{
 let now=1000;const a=joined({now:()=>now,ttlMs:100});now+=101;throws(()=>a.rooms.teacherSync(a.created.roomId,a.created.teacherToken),410);assert.equal(a.rooms.rooms.size,0);
 const b=joined();b.rooms.close(b.created.roomId,b.created.teacherToken);throws(()=>b.rooms.studentSync(b.created.roomId,b.student,{leaseId:b.lease}),410);throws(()=>b.rooms.teacherSync(b.created.roomId,b.created.teacherToken),410);throws(()=>b.rooms.join(b.created.roomId,{inviteToken:b.created.inviteToken,studentToken:b.student,leaseId:b.lease}),410);
});
test('commands are whitelisted, idempotent and only become executed after receipt and engine acknowledgement',()=>{
 const {rooms,created,student,lease}=joined(),c=command();const sent=rooms.command(created.roomId,created.teacherToken,c);assert.equal(sent.command.status,'sent');assert.equal(rooms.command(created.roomId,created.teacherToken,c).command.id,c.id);throws(()=>rooms.command(created.roomId,created.teacherToken,{...c,value:'korea'}),409);throws(()=>rooms.command(created.roomId,student,command()),403);
 for(const bad of [command({action:'eval'}),command({field:'name'}),command({value:'unknown'}),command({audio:'binary'}),command({id:'__proto__'})])throws(()=>rooms.command(created.roomId,created.teacherToken,bad),400);
 throws(()=>rooms.acknowledge(created.roomId,student,{leaseId:lease,id:c.id,status:'executed'}),409);rooms.acknowledge(created.roomId,student,{leaseId:lease,id:c.id,status:'received'});assert.equal(rooms.teacherSync(created.roomId,created.teacherToken).commands[0].status,'received');rooms.acknowledge(created.roomId,student,{leaseId:lease,id:c.id,status:'executed',message:'engine confirmed'});assert.equal(rooms.teacherSync(created.roomId,created.teacherToken).commands[0].status,'executed');assert.equal(rooms.studentSync(created.roomId,student,{leaseId:lease}).commands.length,0);
});
test('level two is rejected and timeouts never turn into false success',()=>{
 let now=100;const {rooms,created,student,lease}=joined({now:()=>now,commandMs:50,leaseMs:10000});const c=rooms.command(created.roomId,created.teacherToken,command()).command;now+=51;assert.equal(rooms.teacherSync(created.roomId,created.teacherToken).commands[0].status,'timeout');assert.equal(rooms.acknowledge(created.roomId,student,{leaseId:lease,id:c.id,status:'executed'}).accepted,false);
 rooms.studentSync(created.roomId,student,{leaseId:lease,snapshot:{...state(),level:'home'}});assert.equal(rooms.command(created.roomId,created.teacherToken,command()).command.status,'rejected');
});
test('snapshot/events contain only technical text, are bounded, deduplicated and cannot carry audio',()=>{
 const {rooms,created,student,lease}=joined();const attempt=crypto.randomUUID(),event={id:crypto.randomUUID(),attemptId:attempt,type:'transcript',text:'저는 러시아 사람이에요',server:'Amvera'};
 for(let n=0;n<2;n++)rooms.studentSync(created.roomId,student,{leaseId:lease,snapshot:{...state(),lastPhrase:event.text,voiceAttemptId:attempt},events:[event]});const data=rooms.teacherSync(created.roomId,created.teacherToken);assert.equal(data.events.length,1);assert.equal(data.state.lastPhrase,event.text);assert.equal(rooms.command(created.roomId,created.teacherToken,command({correctsAttemptId:attempt})).command.correctsAttemptId,attempt);
 throws(()=>rooms.studentSync(created.roomId,student,{leaseId:lease,audio:'base64'}),400);throws(()=>rooms.studentSync(created.roomId,student,{leaseId:lease,events:[{...event,audio:'blob'}]}),400);throws(()=>rooms.studentSync(created.roomId,student,{leaseId:lease,snapshot:{...state(),profile:{...profile(),visual:'screen'}}}),400);
});
async function fixture(t){const rooms=new LessonRooms(),origin='http://localhost:5199',server=createTeacherServer({rooms,origins:[origin]});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});const base=`http://127.0.0.1:${server.address().port}`,fetcher=(url,o)=>fetch(url,{...o,headers:{...o.headers,Origin:origin}});return {rooms,server,origin,base,api:new LessonApi(base,{fetcher,timeoutMs:1000})};}
test('actual lesson HTTP server enforces CORS, authorization, strict JSON and rate limits',async t=>{
 const {base,origin,api}=await fixture(t);assert.equal((await fetch(base+'/health')).status,200);assert.equal((await fetch(base+'/teacher-api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 const options=await fetch(base+'/teacher-api/rooms',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),origin);
 const created=await api.request('');await assert.rejects(api.request('/'+created.roomId+'/teacher-sync',{},created.inviteToken),e=>e.status===403);
 assert.equal((await fetch(base+'/.env',{headers:{Origin:origin}})).status,404);assert.equal((await fetch(base+'/teacher-api/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'audio/webm'},body:Buffer.alloc(200)})).status,415);
 for(let n=0;n<4;n++)await api.request('');await assert.rejects(api.request(''),e=>e.status===429);
});
test('engine bridge invokes existing ActionController, confirms after animation and executes duplicate delivery once',async()=>{
 const storage=memory(),world=new WorldState(memory());let finish,calls=0;const controller=new ActionController(world,{wake:async()=>true,setProfile(){},reset(){finish?.(false);},equip:()=>{calls++;return new Promise(r=>finish=r);},changeAppearance:async()=>true});const bridge=new TeacherCommandBridge({storage,key:'journal',level:()=> 'creator',execute:c=>controller.run(c),cancel:()=>controller.cancel()});const c=command(),acks=[];const ack=async(id,status,message)=>{acks.push({id,status,message});return {accepted:true};};const pending=bridge.deliver(c,ack);while(!finish)await new Promise(r=>setImmediate(r));assert.equal(world.profile.country,null);assert.deepEqual(acks.map(x=>x.status),['received']);assert.equal(bridge.deliver(c,ack),pending);finish(true);await pending;assert.equal(world.profile.country,'russia');assert.equal(acks.at(-1).status,'executed');await bridge.deliver(c,ack);assert.equal(calls,1);
});
test('bridge never retries an operation interrupted by page refresh and rejects level two',async()=>{
 const storage=memory(),c=command();storage.setItem('journal',JSON.stringify({[c.id]:{state:'started'}}));let calls=0,corrections=0;const acknowledgements=[];const bridge=new TeacherCommandBridge({storage,key:'journal',level:()=> 'creator',execute:()=>{calls++;return {type:'success'};},correct:()=>corrections++});await bridge.deliver(c,async(id,status)=>{acknowledgements.push(status);return {accepted:true};});assert.equal(calls,0);assert.equal(acknowledgements[0],'error');
 const second=new TeacherCommandBridge({storage:memory(),key:'journal',level:()=> 'home',execute:()=>{calls++;}});await second.deliver(command(),async(id,status)=>{assert.equal(status,'rejected');});assert.equal(calls,0);
});
test('manual correction runs before engine operation; terminal result survives lost acknowledgement',async()=>{
 const order=[],storage=memory(),c=command({correctsAttemptId:crypto.randomUUID()});let loss=true,calls=0;const bridge=new TeacherCommandBridge({storage,key:'journal',level:()=> 'creator',correct:id=>order.push('correct:'+id),execute:async()=>{calls++;order.push('engine');return {type:'success',message:'done'};}});const ack=async(id,status)=>{if(status==='executed'&&loss){loss=false;throw new LessonError('network-error');}return {accepted:true};};await assert.rejects(bridge.deliver(c,ack));assert.ok(order[0].startsWith('correct:'));assert.equal(order[1],'engine');await bridge.deliver(c,ack);assert.equal(calls,1);
});
test('storage failure cannot execute remote operation; ended bridge cancels and does not process queued commands',async()=>{
 let calls=0;const denied=new TeacherCommandBridge({storage:{getItem(){return null;},setItem(){throw Error();}},key:'j',level:()=> 'creator',execute:()=>calls++});await assert.rejects(denied.deliver(command(),async()=>({accepted:true})));assert.equal(calls,0);
 const ended=new TeacherCommandBridge({storage:memory(),key:'j',level:()=> 'creator',execute:()=>calls++});ended.end();await ended.deliver(command(),async()=>({accepted:true}));assert.equal(calls,0);
});
test('invitation is removed from URL immediately and unrelated game URLs remain unchanged',()=>{
 let replaced;const location={hash:'#lesson='+'a'.repeat(32)+'.'+'b'.repeat(64),pathname:'/korean-stickman/',search:'?level=1'};const result=consumeInvite(location,{replaceState:(a,b,url)=>replaced=url});assert.equal(result.roomId,'a'.repeat(32));assert.equal(replaced,'/korean-stickman/?level=1');assert.ok(!replaced.includes('b'.repeat(64)));replaced=null;assert.equal(consumeInvite({...location,hash:''},{replaceState:()=>replaced=true}),null);assert.equal(replaced,null);
});
test('two independent authenticated HTTP clients confirm real engine completion, STT-independent reconnect and no duplicates',async t=>{
 const {api,rooms}=await fixture(t),created=await api.request(''),storage=memory(),world=new WorldState(memory());let engineCalls=0;const controller=new ActionController(world,{wake:async()=>true,setProfile(){},reset(){},equip:async()=>{engineCalls++;return true;},changeAppearance:async()=>true});const locks={request:async(name,opts,callback)=>callback({name})};
 const agent=new StudentLesson({api,storage,locks,snapshot:()=>({level:'creator',profile:{name:world.profile.name,awake:world.profile.awake,gender:world.profile.gender,country:world.profile.country,profession:world.profile.profession},lastPhrase:'',interpretation:'',lastCommand:'',voiceAttemptId:null}),level:()=> 'creator',execute:c=>controller.run(c),schedule:()=>0,unschedule(){}});t.after(()=>agent.finish());await agent.start({roomId:created.roomId,inviteToken:created.inviteToken});for(let n=0;n<20&&!agent.connected;n++)await new Promise(r=>setTimeout(r,5));assert.equal(agent.connected,true);const token=created.teacherToken;
 const queued=await api.request('/'+created.roomId+'/commands',command(),token);assert.equal(queued.command.status,'sent');await agent.sync();await agent.bridge.queue;let view=await api.request('/'+created.roomId+'/teacher-sync',{},token);assert.equal(view.commands[0].status,'executed');assert.equal(world.profile.country,'russia');await agent.sync();assert.equal(engineCalls,1);
 const attempt=crypto.randomUUID();agent.event('recording-start',{attemptId:attempt});agent.event('transcript',{attemptId:attempt,text:'저는 러시아 사람이에요'});agent.event('error',{attemptId:attempt,result:'STT timeout'});await agent.sync();view=await api.request('/'+created.roomId+'/teacher-sync',{},token);assert.equal(view.events.at(-1).result,'STT timeout');assert.equal(view.online,true);
 await agent.disconnect();view=await api.request('/'+created.roomId+'/teacher-sync',{},token);assert.equal(view.online,false);assert.equal(rooms.rooms.size,1);
});

test('closing while receipt is in flight never starts engine; closing during engine cannot recreate forgotten journal',async()=>{
 let receipt,finish,calls=0;const storage=memory(),acks=[];
 const first=new TeacherCommandBridge({storage,key:'j',level:()=> 'creator',execute:()=>{calls++;return {type:'success'};}});
 const pending=first.deliver(command(),()=>new Promise(r=>receipt=r));while(!receipt)await new Promise(r=>setImmediate(r));first.end();storage.removeItem('j');receipt({accepted:true});await pending;assert.equal(calls,0);assert.equal(storage.getItem('j'),null);
 const second=new TeacherCommandBridge({storage,key:'j',level:()=> 'creator',execute:()=>{calls++;return new Promise(r=>finish=r);},cancel:()=>finish({type:'cancelled'})});
 const running=second.deliver(command(),async(id,status)=>{acks.push(status);return {accepted:true};});while(!finish)await new Promise(r=>setImmediate(r));second.end();storage.removeItem('j');await running;assert.equal(storage.getItem('j'),null);assert.deepEqual(acks,['received']);
});

test('student resumes with persisted credential without invitation, reconnects after network failure and does not resend engine action',async t=>{
 const {api}=await fixture(t),created=await api.request(''),storage=memory(),locks={request:async(n,o,cb)=>cb({name:n})};let calls=0,offline=false;
 const transport={request:(...args)=>offline?Promise.reject(new LessonError('network-error')):api.request(...args)};
 const options={api:transport,storage,locks,snapshot:state,level:()=> 'creator',execute:async()=>{calls++;return {type:'success'};},schedule:()=>0,unschedule(){}};
 const first=new StudentLesson(options);await first.start({roomId:created.roomId,inviteToken:created.inviteToken});for(let n=0;n<30&&!first.connected;n++)await new Promise(r=>setTimeout(r,5));assert.equal(first.connected,true);
 const credential=JSON.parse(storage.getItem('korean-stickman.lesson.student'));assert.equal(credential.inviteToken,undefined);
 const c=command();await api.request('/'+created.roomId+'/commands',c,created.teacherToken);await first.sync();await first.bridge.queue;assert.equal(calls,1);
 offline=true;await first.sync();assert.equal(first.status,'reconnecting');first.event('error',{result:'temporary STT failure'});offline=false;await first.sync();assert.equal(first.connected,true);
 await api.request('/'+created.roomId+'/leave',{leaseId:first.leaseId},credential.studentToken);first.bridge.end();first.ended=true;first.unlock?.();
 const restored=new StudentLesson(options);t.after(()=>restored.finish());await restored.start(null);for(let n=0;n<30&&!restored.connected;n++)await new Promise(r=>setTimeout(r,5));assert.equal(restored.connected,true);assert.equal(restored.credentials.studentToken,credential.studentToken);await restored.sync();assert.equal(calls,1);
 const view=await api.request('/'+created.roomId+'/teacher-sync',{},created.teacherToken);assert.equal(view.events.at(-1).result,'temporary STT failure');
});

test('oversized JSON and unsupported preflight are rejected by actual HTTP transport',async t=>{
 const {base,origin}=await fixture(t);const result=await fetch(base+'/teacher-api/rooms',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({audio:'x'.repeat(33000)})});assert.equal(result.status,413);
 const options=await fetch(base+'/teacher-api/rooms',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-audio'}});assert.equal(options.status,403);
});

test('ordinary game does not contact lesson service or publish voice events without explicit invitation',async()=>{
 let requests=0,schedules=0;const agent=new StudentLesson({api:{request(){requests++;}},storage:memory(),snapshot:state,level:()=> 'creator',schedule:()=>{schedules++;}});
 await agent.start(null);agent.event('transcript',{text:'private phrase'});assert.equal(requests,0);assert.equal(schedules,0);assert.equal(agent.events.length,0);assert.equal(agent.enabled,false);
});

test('a duplicate tab without the browser lock makes no request and cannot take over the learner',async()=>{
 let requests=0;const roomId='a'.repeat(32),storage=memory();storage.setItem('korean-stickman.lesson.student',JSON.stringify({roomId,studentToken:'b'.repeat(64),expiresAt:Date.now()+10000}));
 const agent=new StudentLesson({api:{request(){requests++;}},storage,locks:{request:async(n,o,callback)=>callback(null)},snapshot:state,level:()=> 'creator'});
 await agent.start(null);await agent.lockTask;assert.equal(agent.status,'conflict');assert.equal(requests,0);assert.equal(agent.sharing,false);
});

test('poll timer is called without a StudentLesson receiver, as required by browser timer APIs',async()=>{
 let callback,timerId=0,requests=0,cleared=false;
 function browserSchedule(fn){if(this!==undefined)throw new TypeError('Illegal invocation');callback=fn;return ++timerId;}
 function browserUnschedule(id){if(this!==undefined)throw new TypeError('Illegal invocation');assert.equal(id,timerId);cleared=true;}
 const agent=new StudentLesson({api:{async request(){requests++;return {expiresAt:Date.now()+10000,commands:[]};}},storage:memory(),snapshot:state,level:()=> 'creator',schedule:browserSchedule,unschedule:browserUnschedule});
 agent.credentials={roomId:'a'.repeat(32),studentToken:'b'.repeat(64)};agent.hasLock=true;agent.enabled=true;agent.leaseId=crypto.randomUUID();
 await agent.tick();assert.equal(requests,1);assert.equal(agent.connected,true);assert.equal(typeof callback,'function');
 await callback();assert.equal(requests,2);assert.equal(timerId,2);agent.finish();assert.equal(cleared,true);
});

test('automatic browser-style polling keeps state live and receives/acknowledges an engine command after initial join',async t=>{
 const {api}=await fixture(t),created=await api.request(''),world=new WorldState(memory());let finish,engineCalls=0;
 const controller=new ActionController(world,{wake:async()=>true,setProfile(){},reset(){finish?.(false);},equip:()=>{engineCalls++;return new Promise(r=>finish=r);}});
 function browserSchedule(fn,ms){if(this!==undefined)throw new TypeError('Illegal invocation');return setTimeout(fn,ms);}
 function browserUnschedule(id){if(this!==undefined)throw new TypeError('Illegal invocation');clearTimeout(id);}
 const agent=new StudentLesson({api,storage:memory(),locks:{request:async(n,o,cb)=>cb({name:n})},pollMs:20,schedule:browserSchedule,unschedule:browserUnschedule,level:()=> 'creator',execute:c=>controller.run(c),snapshot:()=>({...state(),profile:{...profile(),country:world.profile.country,awake:world.profile.awake}})});t.after(()=>agent.finish());
 const until=async predicate=>{for(let n=0;n<150;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('automatic polling did not deliver state/command');};
 await agent.start({roomId:created.roomId,inviteToken:created.inviteToken});await until(()=>agent.connected);
 await api.request('/'+created.roomId+'/commands',command(),created.teacherToken);await until(()=>Boolean(finish));
 let view=await api.request('/'+created.roomId+'/teacher-sync',{},created.teacherToken);assert.equal(view.commands[0].status,'received');assert.equal(world.profile.country,null);finish(true);
 await until(async()=>{view=await api.request('/'+created.roomId+'/teacher-sync',{},created.teacherToken);return view.state.profile.country==='russia'&&view.commands[0].status==='executed';});
 agent.event('transcript',{attemptId:crypto.randomUUID(),text:'저는 러시아 사람이에요'});
 await until(async()=>{view=await api.request('/'+created.roomId+'/teacher-sync',{},created.teacherToken);return view.events.some(e=>e.type==='transcript');});
 assert.equal(view.online,true);assert.equal(engineCalls,1);await agent.disconnect();
});


test('schema rejection explains the server restart instead of pretending it is a network failure',()=>{
 const error=new LessonError('invalid-data',400),message=lessonMessage(error);assert.match(message,/отклонил данные/u);assert.match(message,/teacher:server/u);assert.match(message,/новый урок/u);assert.doesNotMatch(message,/Нет связи/u);
});
