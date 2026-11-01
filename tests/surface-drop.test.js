import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomState,RoomController,parseRoom,ROOM_STORAGE_KEY} from '../src/room-state.js';
import {FLOOR_SLOTS,project,approach,distance} from '../src/room-space.js';
import {releaseSurface,surfaceFallPoint,MAX_DROP_SHIFT} from '../src/room-surfaces.js';
import {RoomRenderer} from '../src/room-renderer.js';
import {Renderer} from '../src/renderer.js';
import {POSES} from '../src/geometry.js';
import {appearance} from '../src/catalog.js';
import {wristWorld,clonePose} from '../src/room-motion.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
function make(...ids){const storage=memory(),state=new RoomState(storage);for(const item of ids)state.commit(state.plan({action:'create',item}));return {state,storage};}
test('deleting a support drops actual locations straight down and persists them, never using floor creation slots',()=>{
  const {state,storage}=make('desk','book','water');state.objects.book.location.uv=[.66,.49];state.objects.book.location.height=138;
  const original=structuredClone({book:state.objects.book.location,water:state.objects.water.location}),plan=state.plan({action:'remove',item:'desk'});
  assert.equal(plan.ok,true);assert.equal(plan.falls.length,2);
  for(const fall of plan.falls){assert.deepEqual(fall.fromPoint,project(original[fall.id].uv,original[fall.id].height));assert.deepEqual(fall.to.uv,original[fall.id].uv);assert.equal(fall.to.height,0);assert.equal(fall.to.surface,'floor');assert.notDeepEqual(fall.to.uv,FLOOR_SLOTS[fall.id]);assert.equal(fall.toPoint[0],fall.fromPoint[0]);assert.equal(fall.toPoint[1]-fall.fromPoint[1],original[fall.id].height);}
  state.commit(plan);const restored=new RoomState(storage);
  for(const id of ['book','water']){assert.equal(restored.items[id],'floor');assert.deepEqual(restored.objects[id].location.uv,original[id].uv);assert.deepEqual(restored.point(id),plan.falls.find(f=>f.id===id).toPoint);}
});
test('removal animation starts at the rendered anchor, finishes at committed coordinates and has no lateral drift',async()=>{
  const {state}=make('desk','book','water');state.objects.book.location.uv=[.65,.50];const plan=state.plan({action:'remove',item:'desk'}),frames=[];
  const renderer=Object.create(RoomRenderer.prototype);Object.assign(renderer,{state,phase(){},draw(){},async tween(ms,update){for(let n=0;n<=40;n++){update(n/40);if(this.effects.book?.point)frames.push([...this.effects.book.point]);}return true;}});
  assert.equal(await renderer.run(plan),true);const fall=plan.falls.find(f=>f.id==='book');assert.deepEqual(frames[0],fall.fromPoint);assert.deepEqual(frames.at(-1),fall.toPoint);for(const frame of frames)assert.equal(frame[0],fall.fromPoint[0]);
  state.commit(plan);renderer.synchronize();assert.deepEqual(state.point('book'),frames.at(-1));
  assert.deepEqual(surfaceFallPoint(fall,0),fall.fromPoint);assert.deepEqual(surfaceFallPoint(fall,1),fall.toPoint);
});
test('overlapping drops use a bounded separation and remain settled after the first floor contact',()=>{
  const {state}=make('desk','book','water');state.objects.water.location.uv=[...state.objects.book.location.uv];
  const plan=state.plan({action:'remove',item:'desk'});assert.equal(plan.ok,true);
  const [book,water]=plan.falls;assert.deepEqual(book.to.uv,book.from.uv);const offset=distance(water.toPoint,project(water.from.uv));assert.ok(offset>0&&offset<=MAX_DROP_SHIFT+1e-6);
  const a=state.objects.book.floorFootprint,b=state.objects.water.floorFootprint,dx=book.toPoint[0]-water.toPoint[0],dy=book.toPoint[1]-water.toPoint[1];assert.ok((dx/(a.rx+b.rx+3))**2+(dy/(a.ry+b.ry+3))**2>=1-1e-8);
  for(let n=80;n<=100;n++)assert.equal(surfaceFallPoint(water,n/100)[0],water.toPoint[0]);
  state.commit(plan);assert.deepEqual(state.point('water'),water.toPoint);assert.deepEqual(new RoomState(state.storage).point('water'),water.toPoint);
});
test('support release is generic for surface ids, object ids and heights and does not mutate input',()=>{
  const source={id:'cup',type:'portable',location:{kind:'table',surface:'platform',uv:[.45,.55],height:157},floorFootprint:{rx:16,ry:9},returnTo:null};
  const objects={cup:source,coin:{id:'coin',type:'portable',location:{kind:'floor',surface:'floor',uv:[.2,.3],height:0}}},before=structuredClone(objects);
  const release=releaseSurface(objects,'platform',[{id:'platform',u:.35,v:.45,w:.2,d:.2}]);assert.equal(release.ok,true);assert.deepEqual(release.falls.map(f=>f.id),['cup']);assert.deepEqual(release.locations.cup.uv,source.location.uv);assert.equal(release.falls[0].toPoint[1]-release.falls[0].fromPoint[1],157);assert.deepEqual(objects,before);assert.equal(release.locations.coin,undefined);
});
test('held item stays in hand and its future put location drops under the old surface',async()=>{
  const {state}=make('desk','book','water');state.moveHero(approach('book','table'),'right');state.contact({action:'take',item:'book'});const source=structuredClone(state.objects.book.returnTo),plan=state.plan({action:'remove',item:'desk'});
  assert.deepEqual(plan.falls.map(f=>f.id),['water']);assert.deepEqual(plan.returnLocations.book.uv,source.uv);state.commit(plan);assert.equal(state.held,'book');assert.equal(state.items.book,'hand');
  const renderer={connect(){},cancel(){},async confused(){},async perform(op,context,hooks){if(op.action==='move_to')state.moveHero(context.position,context.facing);if(['take','put'].includes(op.action))hooks.contact();return true;}};
  const queue=new RoomController(state,renderer);assert.equal((await queue.run(parseRoom('책을 읽어요'))).type,'success');assert.equal(state.items.book,'floor');assert.deepEqual(state.objects.book.location.uv,source.uv);
});
test('existing floor objects stay put and missing-support saves recover below their actual coordinates',()=>{
  const {state,storage}=make('book','desk','water'),floor=structuredClone(state.objects.book.location),water=structuredClone(state.objects.water.location);state.commit(state.plan({action:'remove',item:'desk'}));assert.deepEqual(state.objects.book.location,floor);assert.deepEqual(state.objects.water.location.uv,water.uv);
  const saved={version:2,hero:state.hero,objects:structuredClone(state.objects)};saved.objects.book.location={kind:'table',surface:'desk',uv:[.64,.51],height:102};storage.setItem(ROOM_STORAGE_KEY,JSON.stringify(saved));const repaired=new RoomState(storage);assert.equal(repaired.items.book,'floor');assert.deepEqual(repaired.objects.book.location.uv,[.64,.51]);
});
test('navigation and shared take/use/put find the new floor coordinates for book and bottle',async()=>{
  const {state}=make('desk','book','water');state.commit(state.plan({action:'remove',item:'desk'}));
  for(const id of ['book','water']){
    const original=structuredClone(state.objects[id].location),move=state.prepare({action:'move_to',item:id});assert.equal(move.ok,true);state.moveHero(move.position,move.facing);
    const renderer=Object.create(RoomRenderer.prototype);Object.assign(renderer,{state,pose:clonePose(POSES.stand),poseFacing:state.hero.facing,carry:{angle:0,open:0},scene:{dataset:{}},phase(){},draw(){},async tween(ms,fn){fn(1);return true;},async poseTo(p){this.pose=p;return true;}});
    for(const action of ['take','use','put']){const op={action,item:id},context=state.prepare(op);assert.equal(context.ok,true,context.message);await renderer.perform(op,context,{contact(){assert.ok(distance(wristWorld(state.hero.position,renderer.pose,renderer.poseFacing),context.grip)<.001);state.contact(op);}});}
    assert.deepEqual(state.objects[id].location,original);assert.equal(state.held,null);
  }
});
test('crowded floor rejects removal instead of teleporting props to a remote fallback',()=>{
  const {state}=make('desk','book'),before=structuredClone(state.objects);const release=releaseSurface(state.objects,'desk',[{id:'blocked',u:0,v:0,w:1,d:1}]);assert.equal(release.ok,false);assert.deepEqual(state.objects,before);
});
test('both eyes remain visible in front and side views while the back hides the face',()=>{
  const hero=Object.create(Renderer.prototype);Object.assign(hero,{actor:{dataset:{},innerHTML:''},arm:{innerHTML:''},look:appearance({country:'russia',profession:'student',gender:'male'}),asleep:false,animating:false});
  for(const facing of ['left','right','front']){const body=hero.roomLayers(POSES.stand,{facing}).body;assert.ok(body.includes(`<ellipse cx="${facing==='front'?-18:-6}"`));assert.ok(body.includes(`<ellipse cx="${facing==='front'?18:27}"`));const closed=hero.roomLayers({...structuredClone(POSES.stand),eye:.1},{facing}).body;assert.ok(closed.includes('M-16 7Q-8 17 0 7M20 5Q28 15 36 5'));}
  const back=hero.roomLayers(POSES.stand,{facing:'back'}).body;assert.ok(!back.includes('<ellipse cx="-6"'));assert.ok(!back.includes('<ellipse cx="27"'));
});
