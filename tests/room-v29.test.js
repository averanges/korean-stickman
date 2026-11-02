import test from 'node:test';import assert from 'node:assert/strict';
import {RoomState,RoomController,parseRoom,ROOM_ITEMS,ROOM_STORAGE_KEY} from '../src/room-state.js';
import {RoomRenderer} from '../src/room-renderer.js';import {LESSONS,lessonTarget} from '../src/room-lessons.js';
import {lessonProps,friendArt} from '../src/room-lesson-art.js';import {OBJECT_TYPES,KOREAN} from '../src/room-catalog.js';
import {POSES,articulate} from '../src/geometry.js';import {wristWorld} from '../src/room-motion.js';
import {walkable,clearSegment} from '../src/room-navigation.js';import {distance,project} from '../src/room-space.js';
import {itemArt,roomArt} from '../src/room-art.js';import {furnitureArt} from '../src/room-furniture.js';import {interpretRussian} from '../src/russian-test.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
function setup(){const storage=memory(),state=new RoomState(storage),renderer=Object.create(RoomRenderer.prototype),frames=[];Object.assign(renderer,{state,visible:false,pose:structuredClone(POSES.stand),poseFacing:'right',carry:{angle:0,open:0},generation:0,scene:{dataset:{}},draw(){frames.push({phase:this.scene.dataset.phase,lesson:this.lessonVisual?structuredClone(this.lessonVisual):null,pose:structuredClone(this.pose),facing:this.poseFacing,position:[...state.hero.position],carry:{...this.carry},visitor:this.visitor?{...this.visitor}:null,held:state.held});},phase(value){this.scene.dataset.phase=value;},async tween(duration,update){const generation=this.generation;for(let i=0;i<=10;i++){if(generation!==this.generation)return false;update(i/10);this.draw();}return true;}});const controller=new RoomController(state,renderer);return {state,storage,renderer,controller,frames};}
async function run(c,text){const parsed=parseRoom(text);assert.equal(parsed.ok,true,text);const r=await c.run(parsed);assert.notEqual(r.type,'error',text+': '+r.message);assert.ok(!r.cancelled,text);return r;}
async function create(c,ids){for(const id of ids)await run(c,KOREAN[id]+' 있어요');}
test('V2.9 exact commands preserve the old verbs and reject negatives, questions and arbitrary statements',()=>{
 for(const [id,lesson] of Object.entries(LESSONS))for(const command of lesson.commands)assert.deepEqual(parseRoom(command).commands,[{action:'lesson',item:id}]);for(const id of ['notebook','pen','computer','television'])for(const ending of ['이 있어요','가 있어요',' 있어요','이 없어요','가 없어요'])assert.equal(parseRoom(KOREAN[id]+ending).commands[0].item,id);
 for(const text of ['공부 안 해요','일 안 해요','친구를 안 만나요','운동해요?','영화를 안 봐요','숙제를 해요 공부해요','옷을 팔아요'])assert.equal(parseRoom(text).ok,false,text);
 assert.deepEqual(parseRoom('자요').commands,[{action:'sleep',item:'bed'}]);for(const text of ['책을 읽어요','물을 마셔요','우유를 마셔요','사과를 먹어요','침대에서 자요'])assert.equal(parseRoom(text).ok,true);
 for(const [ru,ko] of [['учись','공부해요'],['изучай корейский','한국어를 배워요'],['работай','일해요'],['сделай домашнее задание','숙제를 해요'],['сделай зарядку','운동해요'],['встреть друга','친구를 만나요'],['посмотри фильм','영화를 봐요'],['купи одежду','옷을 사요']])assert.deepEqual(interpretRussian(ru,{home:true}).commands,parseRoom(ko).commands);
});
test('new objects use ordinary receive/take/put placement, persist and can be removed without affecting the hero',async()=>{
 const {state,controller,storage}=setup();storage.setItem('korean-stickman.hero.v2','preserved');await create(controller,['desk','notebook','pen','computer','television']);assert.equal(Object.values(state.items).filter(Boolean).length,5);
 const loaded=new RoomState(storage);for(const id of ['notebook','pen','computer','television']){assert.deepEqual(loaded.objects[id].location,state.objects[id].location);const route=state.prepare({action:'move_to',item:id});assert.equal(route.ok,true,id);await run(controller,KOREAN[id]+' 없어요');assert.equal(state.items[id],null);}assert.equal(storage.getItem('korean-stickman.hero.v2'),'preserved');
});
test('all eight lesson actions give distinct visual phases; homework uses held pen and work uses real computer',async()=>{
 for(const kind of Object.keys(LESSONS)){
  const {state,controller,frames,renderer}=setup();await create(controller,LESSONS[kind].requires);frames.length=0;const before=structuredClone(state.items);
  await run(controller,LESSONS[kind].commands[0]);const active=frames.filter(f=>f.phase==='lesson-'+kind&&f.lesson);assert.ok(active.length>10,kind+' has an animated scene');assert.ok(active.every(f=>walkable(f.position,state.obstacles)),kind+' stays on walkable floor');assert.equal(state.held,null,kind+' returns held prop');assert.equal(state.hero.posture,'standing');assert.equal(renderer.lessonVisual,null);
  if(kind==='homework'){assert.ok(active.some(f=>f.held==='pen'));assert.equal(state.objects.notebook.location.surface,'desk');assert.notDeepEqual(active[1].pose.rw,active.at(-3).pose.rw);}
  if(kind==='work')assert.equal(state.objects.computer.location.surface,'desk');
  if(kind==='meet'){assert.ok(frames.some(f=>f.visitor?.visible>0));assert.equal(renderer.visitor,null);}
  if(kind==='shop'){assert.ok(active.some(f=>f.carry.screen==='shop'));assert.equal(renderer.lessonResult.kind,'bag');assert.equal(state.items.phone,before.phone);}
  if(kind==='study')assert.ok(active.some(f=>f.lesson.seated));if(kind==='learn')assert.ok(active.every(f=>!f.lesson.seated));
 }
});
test('missing required props give specific Korean messages and preserve position, inventory and progress',async()=>{
 for(const kind of ['study','learn','homework','work','movie','shop']){const {state,controller}=setup(),before=state.snapshot();const r=await controller.run(parseRoom(LESSONS[kind].commands[0]));assert.equal(r.type,'error');assert.ok(r.message.includes('필요해요'));assert.deepEqual(state.snapshot(),before);}
});
test('thirteen objects coexist and remain reachable; television leaves the door clear and surfaces release new items locally',async()=>{
 const {state,controller,storage}=setup();await create(controller,['desk','bed','chair','lamp','television','computer','notebook','pen','book','water','apple','phone','milk']);assert.equal(Object.values(state.items).filter(Boolean).length,13);assert.equal(walkable([.88,.09],state.obstacles),true);
 for(const id of Object.keys(ROOM_ITEMS)){const route=state.prepare({action:'move_to',item:id});assert.equal(route.ok,true,id);for(let i=1;i<route.route.length;i++)assert.ok(clearSegment(route.route[i-1],route.route[i],state.obstacles));}
 const plan=state.plan({action:'remove',item:'desk'});assert.equal(plan.ok,true);for(const fall of plan.falls)assert.ok(Math.abs(fall.fromPoint[0]-fall.toPoint[0])<=36);state.commit(plan);const loaded=new RoomState(storage);for(const id of ['computer','notebook','pen'])assert.deepEqual(loaded.objects[id].location,state.objects[id].location);
});
test('friend is clipped inside the window before its frame; scenes have distinct vector assets and screens',()=>{
 const art=roomArt();assert.ok(art.includes('clip-path="url(#home-window-clip)"'));assert.ok(art.indexOf('id="home-window-guest"')<art.indexOf('M70-108V24'));assert.ok(friendArt(1,2).includes('data-visitor="friend"'));
 for(const id of ['notebook','pen','computer'])assert.notEqual(itemArt(id),itemArt('water'));assert.ok(itemArt('computer',{screen:'work'}).includes('data-screen="work"'));assert.ok(itemArt('phone',{screen:'shop'}).includes('data-screen="clothes-shop"'));assert.ok(furnitureArt('television',{movie:.4}).includes('data-screen="movie"'));
 const visual={position:[.48,.5],point:[500,420],t:.8};assert.ok(lessonProps({...visual,kind:'study'},null).includes('study-material'));assert.ok(lessonProps({...visual,kind:'learn'},null).includes('understanding'));
});

test('writing wrist follows the notebook without stretched arm targets; cancelling a lesson clears transient scenery',async()=>{
 const {state,controller,renderer,frames,storage}=setup();await create(controller,['desk','notebook','pen']);await run(controller,'숙제를 해요');for(const f of frames.filter(f=>f.phase==='lesson-homework'&&f.lesson?.t>.1&&f.lesson.t<1)){const p=f.lesson.point,wrist=wristWorld(f.position,articulate(f.pose),f.facing),t=f.lesson.t;assert.ok(distance(wrist,[p[0]+Math.sin(t*Math.PI*10)*9,p[1]-35+Math.cos(t*Math.PI*10)*2])<.02,'pen grip follows actual writing target');}
 const original=renderer.tween.bind(renderer);renderer.tween=async(duration,update)=>{if(renderer.scene.dataset.phase==='lesson-homework'){controller.cancel();return false;}return original(duration,update);};const result=await controller.run(parseRoom('숙제를 해요'));assert.equal(result.cancelled,true);assert.equal(renderer.lessonVisual,null);assert.equal(renderer.visitor,null);assert.equal(controller.busy,false);const loaded=new RoomState(storage);assert.equal(Object.values(loaded.objects).filter(o=>o.location.kind==='hand').length,state.held?1:0);assert.equal(loaded.items.notebook,state.items.notebook);assert.ok(walkable(loaded.hero.position,loaded.obstacles));
});
test('new old-save fields default to absent and homework errors cannot execute as a different old use action',()=>{
 const storage=memory();storage.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:4,objects:{book:{location:{kind:'floor',surface:'floor',uv:[.25,.75],height:0}}},hero:{position:[.3,.8],facing:'left'}}));const state=new RoomState(storage);for(const id of ['notebook','pen','computer','television'])assert.equal(state.items[id],null);assert.equal(state.items.book,'floor');assert.equal(state.hero.facing,'left');
 for(const id of ['notebook','pen','computer'])assert.equal(OBJECT_TYPES[id].actions.includes('use'),false);
});

test('new spoken transcripts pass through manual MediaRecorder capture into the same lesson queue once',async()=>{
 const {BrowserSpeech}=await import('../src/speech.js');
 for(const kind of Object.keys(LESSONS)){
  const {controller}=setup();await create(controller,LESSONS[kind].requires);let tick,time=0,calls=0,applied=0,finish;const completed=new Promise(r=>finish=r);
  class Recorder{static isTypeSupported(){return true;}constructor(_,o){this.mimeType=o.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([Buffer.alloc(200)])});this.onstop?.();});}}
  class Context{resume(){}close(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {getFloatTimeDomainData:out=>out.fill(.04)};}}
  const speech=new BrowserSpeech({async onFinal(text){applied++;const result=await controller.run(parseRoom(text));assert.notEqual(result.type,'error',kind);return {ok:true};},onError:code=>assert.fail(code),onEnd:finish},{navigator:{mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){},addEventListener(){}}]};}}},Recorder,AudioContext:Context,provider:{async transcribe(blob,o){calls++;assert.equal(o.language,'ko');assert.equal(o.durationMs,5000);return {text:LESSONS[kind].commands[0]};}},now:()=>time,schedule:f=>{tick=f;return 1;},unschedule:()=>tick=null});
  await speech.start();for(let n=0;n<100;n++){time+=50;tick?.();}assert.equal(calls,0);assert.equal(speech.recording,true);speech.stop();await completed;assert.equal(calls,1);assert.equal(applied,1);assert.equal(speech.pending,null);
 }
});
