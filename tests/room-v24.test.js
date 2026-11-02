import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomState,RoomController,parseRoom,ROOM_ITEMS,ROOM_STORAGE_KEY} from '../src/room-state.js';
import {KOREAN,OBJECT_TYPES,furnitureCenter} from '../src/room-catalog.js';
import {project,distance,heroScale} from '../src/room-space.js';
import {clearSegment,walkable} from '../src/room-navigation.js';
import {RoomRenderer} from '../src/room-renderer.js';
import {restPose} from '../src/room-postures.js';
import {worldPoint,wristWorld,useTarget,reachPose} from '../src/room-motion.js';
import {POSES,articulate} from '../src/geometry.js';
import {furnitureArt} from '../src/room-furniture.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
function populated(){const storage=memory(),state=new RoomState(storage);for(const id of Object.keys(ROOM_ITEMS).filter(id=>!['notebook','pen','computer','television'].includes(id))){const plan=state.plan({action:'create',item:id});assert.equal(plan.ok,true,id);state.commit(plan);if(state.objects[id].location.surface==='bed'){state.objects[id].location={kind:'floor',surface:'floor',uv:({apple:[.40,.87],phone:[.68,.84],milk:[.84,.78]})[id]||[.20,.54],height:0};}}return {state,storage};}
function rendererFor(state){
 const renderer=Object.create(RoomRenderer.prototype),frames=[];
 Object.assign(renderer,{state,pose:structuredClone(POSES.stand),poseFacing:'right',carry:{angle:0,open:0},generation:0,scene:{dataset:{}},draw(){},phase(value){this.scene.dataset.phase=value;},async tween(duration,update){for(let i=0;i<=12;i++){update(i/12);frames.push({phase:this.scene.dataset.phase,pose:structuredClone(this.pose),carry:{...this.carry},posture:state.hero.posture});}return true;}});
 const perform=renderer.perform.bind(renderer);renderer.perform=(operation,context,hooks)=>perform(operation,context,{contact:()=>{if(['take','put','toggle'].includes(operation.action))assert.ok(distance(wristWorld(state.hero.position,articulate(renderer.pose),renderer.poseFacing),context.grip)<.01,operation.action+' reaches real grip');hooks.contact();}});
 renderer.synchronize();return {renderer,frames};
}
test('V2.4 creation, removal, particle-free and interaction commands remain explicit',()=>{
 for(const [id,ko] of Object.entries(KOREAN))for(const [ending,action] of [['이 있어요','create'],['가 없어요','remove'],[' 있어요','create']])assert.deepEqual(parseRoom(ko+ending).commands,[{action,item:id}]);
 for(const [text,action,item] of [['의자에 앉아요','sit','chair'],['침대에 누워요','lie_down','bed'],['침대에서 자요','sleep','bed'],['사과를 먹어요','use','apple'],['휴대폰을 봐요','use','phone'],['휴대폰 사용해요','use','phone'],['우유 마셔요','use','milk'],['사과 집어요','take','apple'],['사과 놓아요','put','apple'],['일어나요','stand_up',null]])assert.deepEqual(parseRoom(text).commands,[{action,item}]);
 assert.equal(parseRoom('전등을 켜요').commands[0].value,true);assert.equal(parseRoom('전등 꺼요').commands[0].value,false);
 for(const text of ['휴대폰으로 전화해요','사과를 안 먹어요','전등을 켜요?','침대에서 책을 읽어요'])assert.equal(parseRoom(text).ok,false,text);
});
test('all nine coexist with nonintersecting furniture, clear doorway and reachable targets',()=>{
 const {state}=populated();assert.equal(Object.values(state.items).filter(Boolean).length,9);
 const blocks=state.obstacles;for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){const a=blocks[i],b=blocks[j];assert.ok(a.u+a.w<b.u||b.u+b.w<a.u||a.v+a.d<b.v||b.v+b.d<a.v);}
 assert.equal(walkable([.88,.09],blocks),true,'door approach stays free');
 for(const id of Object.keys(ROOM_ITEMS).filter(id=>!['notebook','pen','computer','television'].includes(id))){const result=state.prepare({action:'move_to',item:id});assert.equal(result.ok,true,id);for(let i=1;i<result.route.length;i++)assert.ok(clearSegment(result.route[i-1],result.route[i],blocks));}
 const occupied=state.plan({action:'create',item:'chair'});assert.equal(occupied.reason,'duplicate');
 state.objects.chair.location.kind='absent';state.moveHero([.44,.75]);assert.equal(state.plan({action:'create',item:'chair'}).reason,'occupied');
});
test('portable placement avoids visual overlap, supports table overflow and general surface drops',()=>{
 const {state,storage}=populated(),portable=Object.values(state.objects).filter(o=>o.type==='portable'&&state.items[o.id]);
 for(let i=0;i<portable.length;i++)for(let j=i+1;j<portable.length;j++){const a=portable[i],b=portable[j];if(a.location.kind!==b.location.kind)continue;const pa=state.point(a.id),pb=state.point(b.id);assert.ok(Math.abs(pa[0]-pb[0])>=(a.visual.w+b.visual.w)/2+5||pa[1]<pb[1]-b.visual.h-5||pa[1]-a.visual.h>pb[1]+5);}
 assert.ok(portable.some(o=>o.location.kind==='table'));assert.ok(portable.some(o=>o.location.kind==='floor'));
 const plan=state.plan({action:'remove',item:'desk'});assert.equal(plan.ok,true);for(const fall of plan.falls)assert.ok(distance(fall.fromPoint,[fall.toPoint[0],fall.toPoint[1]-fall.from.height])<=36);
 state.commit(plan);const reloaded=new RoomState(storage);for(const o of portable)assert.deepEqual(reloaded.objects[o.id].location,state.objects[o.id].location);
 for(const id of ['chair','bed','lamp']){const p=state.plan({action:'remove',item:id});assert.equal(p.ok,true);state.commit(p);assert.equal(state.items[id],null);}
});
test('real shared renderer performs sit, stand, lie and sleep; posture persists and movement stands first',async()=>{
 const {state,storage}=populated(),{renderer,frames}=rendererFor(state),controller=new RoomController(state,renderer);
 for(const [text,posture,support] of [['의자에 앉아요','sitting','chair'],['침대에 누워요','lying','bed'],['침대에서 자요','sleeping','bed']]){
  const result=await controller.run(parseRoom(text));assert.equal(result.type,'success',result.message);assert.equal(state.hero.posture,posture);assert.equal(state.hero.support,support);
  const restored=new RoomState(storage);assert.equal(restored.hero.posture,posture);assert.equal(restored.hero.support,support);
  const pose=restPose(state),f=OBJECT_TYPES[support].footprint;
  if(posture==='sitting'){assert.deepEqual(worldPoint(state.hero.position,pose.p),project(furnitureCenter('chair'),f.height+3));assert.ok(Math.abs(pose.lk[0]-pose.p[0])>40,'knees truly bent');}
  else{const head=worldPoint(state.hero.position,pose.h),ankle=worldPoint(state.hero.position,pose.la);assert.ok(Math.abs(head[0]-ankle[0])>100);assert.ok(Math.abs(head[1]-ankle[1])>40,'lies along bed perspective');assert.equal(pose.eye,posture==='sleeping'?0:1);}
 }
 const start=frames.length,result=await controller.run(parseRoom('휴대폰을 봐요'));assert.equal(result.type,'success');assert.equal(state.hero.posture,'standing');assert.equal(frames[start].phase,'stand_up');
 assert.equal((await controller.run(parseRoom('일어나요'))).type,'error');
});
test('food consumes only apple; phone and drinks reuse exact take/use/put with accurate grip and return',async()=>{
 const {state}=populated(),{renderer,frames}=rendererFor(state),controller=new RoomController(state,renderer);
 for(const [id,text] of [['phone','휴대폰을 사용해요'],['milk','우유를 마셔요'],['book','책을 읽어요'],['water','물을 마셔요'],['apple','사과를 먹어요']]){
  const original=structuredClone(state.objects[id].location),result=await controller.run(parseRoom(text));assert.equal(result.type,'success',id+': '+result.message);
  assert.equal(state.held,null);if(id==='apple')assert.equal(state.items.apple,null);else assert.deepEqual(state.objects[id].location,original);
 }
 assert.ok(frames.some(f=>f.phase==='phone'&&f.carry.lit));assert.ok(frames.some(f=>f.phase==='eat'&&f.carry.remaining===0));
 assert.equal((await controller.run(parseRoom('사과를 먹어요'))).type,'error');
 for(const id of ['milk','water']){const point=useTarget(id,state.hero.position,'right'),grip=state.objects[id].grip,a=-65*Math.PI/180,offset=id==='milk'?[9,-30]:[0,-40];const cap=[point[0]+offset[0]*Math.cos(a)-offset[1]*Math.sin(a),point[1]+offset[0]*Math.sin(a)+offset[1]*Math.cos(a)];assert.ok(distance(cap,worldPoint(state.hero.position,[379,392]))<1e-8);}
});
test('lamp switches at contact, persists, ignores repeats and supports safe deletion of resting furniture',async()=>{
 const {state,storage}=populated(),{renderer}=rendererFor(state),controller=new RoomController(state,renderer);
 assert.equal((await controller.run(parseRoom('전등을 켜요'))).type,'success');assert.equal(state.objects.lamp.state.on,true);assert.equal(new RoomState(storage).objects.lamp.state.on,true);assert.match(furnitureArt('lamp',state.objects.lamp.state),/data-lamp="on"/u);
 assert.equal((await controller.run(parseRoom('전등을 켜요'))).type,'error');assert.equal((await controller.run(parseRoom('전등을 꺼요'))).type,'success');assert.equal(state.objects.lamp.state.on,false);
 await controller.run(parseRoom('의자에 앉아요'));assert.equal((await controller.run(parseRoom('의자가 없어요'))).type,'success');assert.equal(state.hero.posture,'standing');assert.equal(state.items.chair,null);
});
test('step mode and cancellation keep single ownership and stable resting posture',async()=>{
 const {state}=populated(),{renderer}=rendererFor(state),controller=new RoomController(state,renderer);
 const step=text=>parseRoom(text,{debug:true});await controller.run(step('/move_to apple'));await controller.run(step('/take apple'));assert.equal(state.held,'apple');assert.equal((await controller.run(parseRoom('의자에 앉아요'))).type,'error');await controller.run(step('/put apple'));assert.equal(state.held,null);
 await controller.run(parseRoom('침대에서 자요'));const before=structuredClone(state.hero);renderer.tween=async(ms,update)=>{update(.5);controller.cancel();return false;};assert.equal((await controller.run(parseRoom('일어나요'))).cancelled,true);assert.deepEqual(state.hero,before);assert.equal(renderer.pose.eye,0);assert.equal(renderer.restingSupport,null);
});
test('expanded SVG keeps tabletop anchors throughout surface fade and never jumps at drop commit',async()=>{
 const {state}=populated(),renderer=Object.create(RoomRenderer.prototype),anchors=[];
 Object.assign(renderer,{state,hero:{look:{},roomLayers:()=>({body:'',arm:''})},visible:true,debug:false,layer:{innerHTML:''},overlay:{innerHTML:''},scene:{dataset:{},setAttribute(){}},phase(){},async tween(duration,update){for(let i=0;i<=10;i++){update(i/10);this.draw();anchors.push({duration,point:this.layer.innerHTML.match(/data-room-object="book"[^>]*><g data-placement="[^"]*" transform="translate\(([^)]+)\)"/u)?.[1]});}return true;}});
 renderer.synchronize();const from=state.point('book').join(' '),plan=state.plan({action:'remove',item:'desk'}),to=plan.falls.find(f=>f.id==='book').toPoint.join(' ');
 await renderer.run(plan);for(const frame of anchors.filter(f=>f.duration===400))assert.equal(frame.point,from,'tabletop anchor during fade');assert.equal(anchors.filter(f=>f.duration===650)[0].point,from);assert.equal(anchors.at(-1).point,to);state.commit(plan);renderer.synchronize();assert.ok(renderer.layer.innerHTML.includes(`transform="translate(${to})"`));
});
test('new portable items also work from floor; eaten food can be recreated and every new item can be removed',async()=>{
 const state=new RoomState(memory());for(const item of ['apple','phone','milk'])state.commit(state.plan({action:'create',item}));
 const {renderer}=rendererFor(state),controller=new RoomController(state,renderer);
 for(const text of ['휴대폰을 봐요','우유를 마셔요','사과를 먹어요'])assert.equal((await controller.run(parseRoom(text))).type,'success');
 for(const id of ['apple','phone','milk','chair','bed','lamp']){state.moveHero([.6,.9]);if(!state.items[id]){const created=state.plan({action:'create',item:id});assert.equal(created.ok,true,id);state.commit(created);}const removed=state.plan({action:'remove',item:id});assert.equal(removed.ok,true,id);state.commit(removed);assert.equal(state.items[id],null);}
});
