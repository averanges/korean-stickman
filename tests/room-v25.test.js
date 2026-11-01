import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomState,RoomController,parseRoom,ROOM_STORAGE_KEY,ROOM_ITEMS} from '../src/room-state.js';
import {findPlacement,furnitureBlockers} from '../src/room-placement.js';
import {project,distance} from '../src/room-space.js';
import {RoomRenderer} from '../src/room-renderer.js';
import {POSES,articulate} from '../src/geometry.js';
import {wristWorld} from '../src/room-motion.js';
import {walkable,routeLength,clearSegment} from '../src/room-navigation.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
function setup(){
 const storage=memory(),state=new RoomState(storage),renderer=Object.create(RoomRenderer.prototype),frames=[],contacts=[];
 Object.assign(renderer,{state,visible:false,pose:structuredClone(POSES.stand),poseFacing:'right',carry:{angle:0,open:0},generation:0,scene:{dataset:{}},draw(){frames.push({phase:this.scene.dataset.phase,held:state.held,hero:[...state.hero.position],objects:structuredClone(state.objects)});},phase(value){this.scene.dataset.phase=value;},async tween(duration,update){for(let i=0;i<=8;i++){update(i/8);this.draw();}return true;}});
 const perform=renderer.perform.bind(renderer);renderer.perform=(op,context,hooks)=>perform(op,context,{contact:()=>{if(['take','put'].includes(op.action))assert.ok(distance(wristWorld(state.hero.position,articulate(renderer.pose),renderer.poseFacing),context.grip)<.01,'real wrist contact');hooks.contact();contacts.push({...op,held:state.held,location:structuredClone(state.objects[op.item]?.location)});}});
 const controller=new RoomController(state,renderer);return {state,storage,renderer,controller,frames,contacts};
}
const run=async(c,text)=>{const result=await c.run(parseRoom(text,{debug:true}));assert.equal(result.type,'success',text+': '+result.message);return result;};
const createFixture=(state,...ids)=>{for(const item of ids){const plan=state.plan({action:'create',item});assert.equal(plan.ok,true,item);state.commit(plan);}};
test('A: empty room receives compound items in hand and puts them nearby, sequentially without remote slots or duplicates',async()=>{
 const {state,controller,contacts,frames}=setup(),start=project(state.hero.position);await run(controller,'책하고 물이 있어요');
 assert.deepEqual(contacts.map(c=>[c.action,c.item]),[['receive','book'],['put','book'],['receive','water'],['put','water']]);
 for(const id of ['book','water']){assert.equal(state.items[id],'floor');assert.ok(distance(start,state.point(id))<=144);assert.equal(state.held,null);}
 assert.ok(distance(state.point('book'),state.point('water'))>35);assert.deepEqual(state.hero.position,[.22,.72]);
 for(const frame of frames){assert.ok(Object.values(frame.objects).filter(o=>o.location.kind==='hand').length<=1);if(frame.phase==='receive')assert.ok(frame.held);}
 const before=state.snapshot();assert.notEqual((await controller.run(parseRoom('책이 있어요'))).type,'error');assert.deepEqual(state.snapshot(),before);
});
test('B: blockers are carried out before furniture appears; furniture never covers hero and preflight leaves impossible moves untouched',async()=>{
 const {state,controller,contacts}=setup();createFixture(state,'milk');state.objects.milk.location={kind:'floor',surface:'floor',uv:[.65,.45],height:0};state.save();
 const before=structuredClone(state.objects.milk.location);await run(controller,'책상이 있어요');assert.equal(state.items.desk,'floor');assert.equal(furnitureBlockers(state,state.objects.desk).length,0);assert.notDeepEqual(state.objects.milk.location,before);assert.ok(contacts.some(c=>c.action==='take'&&c.item==='milk'));assert.ok(contacts.some(c=>c.action==='put'&&c.item==='milk'));assert.equal(state.transaction,null);
 const blocked=setup();createFixture(blocked.state,'milk');blocked.state.objects.milk.location={kind:'floor',surface:'floor',uv:[.70,.45],height:0};blocked.state.objects.milk.visual={w:10000,h:10000};blocked.state.objects.milk.floorFootprint={rx:10000,ry:10000};const original=blocked.state.snapshot();assert.equal((await blocked.controller.run(parseRoom('책상이 있어요'))).type,'error');assert.deepEqual(blocked.state.snapshot(),original);
 const onSpot=setup();onSpot.state.moveHero([.7,.45]);assert.equal((await onSpot.controller.run(parseRoom('책상이 있어요'))).type,'error');assert.equal(onSpot.state.items.desk,null);
});
test('C,D,E: closest reachable surface by route, capacity overflow, floor fallback and occupied bed exclusion',async()=>{
 const {state,controller,contacts}=setup();await run(controller,'책상이 있어요');await run(controller,'책이 있어요');assert.equal(state.objects.book.location.surface,'desk');assert.ok(contacts.some(c=>c.action==='receive'));assert.ok(contacts.some(c=>c.action==='put'));
 createFixture(state,'bed');state.moveHero([.38,.35]);const nearby=findPlacement(state,'apple');assert.equal(nearby.ok,true);assert.equal(nearby.location.surface,'bed');assert.equal(nearby.length,routeLength(nearby.route));
 state.objects.bed.surface.capacity=0;state.objects.desk.surface.capacity=1;const floor=findPlacement(state,'apple');assert.equal(floor.location.surface,'floor');assert.ok(distance(project(state.hero.position),project(floor.location.uv))<=144);
 state.objects.bed.surface.capacity=2;state.hero.support='bed';state.hero.posture='sleeping';assert.notEqual(findPlacement(state,'apple').location?.surface,'bed');state.hero.support=null;state.hero.posture='standing';
});
test('F: occupied hand is safely placed before receiving the next item, without losing either one',async()=>{
 const {state,controller,contacts}=setup();await run(controller,'책이 있어요');await run(controller,'/move_to book');await run(controller,'/take book');contacts.length=0;await run(controller,'사과가 있어요');assert.deepEqual(contacts.map(c=>[c.action,c.item]),[['put','book'],['receive','apple'],['put','apple']]);assert.equal(state.held,null);assert.equal(state.items.book,'floor');assert.equal(state.items.apple,'floor');
});
test('G,H: bed and desk drops retain actual coordinates, generic use remains reachable and save restores bed surface height',async()=>{
 const {state,storage,controller}=setup();await run(controller,'침대가 있어요');state.moveHero([.38,.35]);await run(controller,'책이 있어요');assert.equal(state.objects.book.location.surface,'bed');const loc=structuredClone(state.objects.book.location);assert.equal(new RoomState(storage).objects.book.location.height,61);assert.deepEqual(new RoomState(storage).objects.book.location,loc);
 await run(controller,'책을 읽어요');assert.deepEqual(state.objects.book.location,loc);const drop=state.plan({action:'remove',item:'bed'});assert.equal(drop.ok,true);assert.deepEqual(drop.falls[0].from.uv,loc.uv);assert.ok(distance(project(loc.uv),drop.falls[0].toPoint)<=36);await run(controller,'침대가 없어요');const landed=structuredClone(state.objects.book.location);await run(controller,'책을 읽어요');assert.deepEqual(state.objects.book.location,landed);assert.deepEqual(new RoomState(storage).objects.book.location,landed);
});
test('furniture clearing rolls back on cancellation, renderer error and reload during transfer',async()=>{
 for(const mode of ['cancel','throw','reload']){
  const {state,storage,controller,renderer}=setup();createFixture(state,'milk','water');state.objects.milk.location={kind:'floor',surface:'floor',uv:[.63,.45],height:0};state.objects.water.location={kind:'floor',surface:'floor',uv:[.83,.45],height:0};state.save();const before=state.snapshot(),perform=renderer.perform;
  renderer.perform=async(op,ctx,hooks)=>{const result=await perform(op,ctx,hooks);if(op.action==='take'){assert.equal(state.transaction.kind,'furniture');if(mode==='reload'){const recovered=new RoomState(storage);assert.deepEqual(recovered.snapshot(),before);}if(mode==='cancel'||mode==='reload')controller.cancel();else throw Error('simulated animation error');}return result;};
  const result=await controller.run(parseRoom('책상이 있어요'));assert.ok(result.cancelled||result.type==='error');assert.deepEqual(state.snapshot(),before,mode);assert.equal(state.transaction,null);
 }
});
test('reloading a newly received object retains one owner and a usable put destination; failed placement keeps existing state',async()=>{
 const {state,storage,controller,renderer}=setup(),perform=renderer.perform;
 renderer.perform=async(op,ctx,hooks)=>{const result=await perform(op,ctx,hooks);if(op.action==='receive')controller.cancel();return result;};
 assert.equal((await controller.run(parseRoom('사과가 있어요'))).cancelled,true);const restored=new RoomState(storage);assert.equal(restored.held,'apple');assert.equal(restored.items.apple,'hand');assert.ok(restored.objects.apple.returnTo);assert.equal(Object.values(restored.objects).filter(o=>o.location.kind==='hand').length,1);
 const full=setup();full.state.objects.apple.floorFootprint={rx:10000,ry:10000};const before=full.state.snapshot();assert.equal((await full.controller.run(parseRoom('사과가 있어요'))).type,'error');assert.deepEqual(full.state.snapshot(),before);
});
test('all nine remain navigable after sequential creation and do not overlap on each support',async()=>{
 const {state,controller}=setup();for(const text of ['책상이 있어요','의자가 있어요','침대가 있어요','전등이 있어요','책이 있어요','물이 있어요','우유가 있어요','휴대폰이 있어요','사과가 있어요'])await run(controller,text);
 assert.equal(Object.values(state.items).filter(Boolean).length,9);for(const id of Object.keys(ROOM_ITEMS)){const p=state.prepare({action:'move_to',item:id});assert.equal(p.ok,true,id);for(let i=1;i<p.route.length;i++)assert.ok(clearSegment(p.route[i-1],p.route[i],state.obstacles));}
 const portable=Object.values(state.objects).filter(o=>o.type==='portable');for(let i=0;i<portable.length;i++)for(let j=i+1;j<portable.length;j++){const a=portable[i],b=portable[j];if(a.location.surface!==b.location.surface)continue;const p=state.point(a.id),q=state.point(b.id);assert.ok(Math.abs(p[0]-q[0])>=(a.visual.w+b.visual.w)/2+5||p[1]<q[1]-b.visual.h-5||p[1]-a.visual.h>q[1]+5);}
});
test('clearing applies to all four fixed furniture zones, and duplicate creation preserves rest or an occupied hand',async()=>{
 for(const [id,text,uv] of [['desk','책상이 있어요',[.65,.45]],['bed','침대가 있어요',[.18,.30]],['chair','의자가 있어요',[.44,.75]],['lamp','전등이 있어요',[.4175,.0925]]]){
  const {state,controller,contacts}=setup();createFixture(state,'milk');state.objects.milk.location={kind:'floor',surface:'floor',uv,height:0};await run(controller,text);assert.equal(state.items[id],'floor',id);assert.equal(furnitureBlockers(state,state.objects[id]).length,0);assert.ok(contacts.some(c=>c.action==='take'));
 }
 const {state,controller}=setup();createFixture(state,'bed');await run(controller,'침대에서 자요');const resting=state.snapshot();await controller.run(parseRoom('침대가 있어요'));assert.deepEqual(state.snapshot(),resting);
 await run(controller,'일어나요');await run(controller,'책이 있어요');await run(controller,'/move_to book');await run(controller,'/take book');const held=state.snapshot();await controller.run(parseRoom('책이 있어요'));assert.deepEqual(state.snapshot(),held);
});
test('surface selection minimizes complete route length across supports and skips unreachable alternatives',()=>{
 const {state}=setup();createFixture(state,'desk','bed');state.moveHero([.43,.57]);
 const deskOnly=state.fork(),bedOnly=state.fork();deskOnly.objects.bed.surface.capacity=0;bedOnly.objects.desk.surface.capacity=0;
 const all=findPlacement(state,'apple'),desk=findPlacement(deskOnly,'apple'),bed=findPlacement(bedOnly,'apple');assert.equal(all.ok,true);assert.ok(all.length<=desk.length+1e-6);assert.ok(all.length<=bed.length+1e-6);
 const unreachable=state.fork(),targets=unreachable.targets.bind(unreachable);unreachable.targets=(id,options)=>options?.location?.surface==='bed'?[]:targets(id,options);assert.equal(findPlacement(unreachable,'apple').location.surface,'desk');
});
test('late completion of a cancelled furniture command cannot roll back a newer transfer',async()=>{
 const {state,controller,renderer}=setup();createFixture(state,'milk','water');state.objects.milk.location={kind:'floor',surface:'floor',uv:[.65,.45],height:0};state.objects.water.location={kind:'floor',surface:'floor',uv:[.18,.3],height:0};
 let readyDesk,readyBed,finishDesk,finishBed;const deskReady=new Promise(r=>readyDesk=r),bedReady=new Promise(r=>readyBed=r),deskFinish=new Promise(r=>finishDesk=r),bedFinish=new Promise(r=>finishBed=r);
 renderer.run=async plan=>{if(plan.item==='desk'){readyDesk();await deskFinish;}else{readyBed();await bedFinish;}return true;};
 const first=controller.run(parseRoom('책상이 있어요'));await deskReady;controller.cancel();const second=controller.run(parseRoom('침대가 있어요'));await bedReady;const active=state.transaction,mid=state.snapshot();assert.ok(active);finishDesk();assert.equal((await first).cancelled,true);assert.equal(state.transaction,active);assert.deepEqual(state.snapshot(),mid);finishBed();assert.equal((await second).type,'success');assert.equal(state.items.bed,'floor');assert.equal(state.items.desk,null);
});
test('sleep preserves its meaning by carrying bed items elsewhere first through the same transfer operations',async()=>{
 const {state,controller,contacts}=setup();createFixture(state,'bed');state.moveHero([.38,.35]);await run(controller,'책이 있어요');assert.equal(state.objects.book.location.surface,'bed');contacts.length=0;await run(controller,'침대에서 자요');assert.equal(state.hero.posture,'sleeping');assert.notEqual(state.objects.book.location.surface,'bed');assert.ok(contacts.some(c=>c.action==='take'&&c.item==='book'));assert.ok(contacts.some(c=>c.action==='put'&&c.item==='book'));assert.equal(state.transaction,null);await run(controller,'책을 읽어요');assert.equal(state.hero.posture,'standing');assert.equal(state.held,null);
});
test('cancelling before the first asynchronous boundary never starts a stale furniture animation',async()=>{
 const {state,controller,renderer}=setup();let animations=0;renderer.run=async()=>{animations++;return true;};const before=state.snapshot(),task=controller.run(parseRoom('책상이 있어요'));controller.cancel();assert.equal((await task).cancelled,true);assert.equal(animations,0);assert.deepEqual(state.snapshot(),before);
});
