import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomState,RoomController,parseRoom,ROOM_STORAGE_KEY} from '../src/room-state.js';
import {TABLE,START,project,unproject,heroScale,landingPoint,distance,approach} from '../src/room-space.js';
import {planRoute,clearSegment,walkable,routeLength} from '../src/room-navigation.js';
import {walkingFrame,worldPoint,gripWorld,wristWorld,reachPose,floorPose,useTarget} from '../src/room-motion.js';
import {RoomRenderer} from '../src/room-renderer.js';
import {POSES,bodyFrame,mixPose} from '../src/geometry.js';
import {itemArt} from '../src/room-art.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
function create(state,...ids){for(const item of ids){const p=state.plan({action:'create',item});assert.equal(p.ok,true,p.message);state.commit(p);}}
function fakeRenderer(state,events=[]){return {connect(){},cancel(){},async confused(){},synchronize(){},async run(plan){events.push(plan.action+':'+plan.item);await new Promise(r=>setImmediate(r));return true;},async perform(op,context,hooks){events.push(op.action+':'+op.item);await new Promise(r=>setImmediate(r));if(op.action==='move_to')state.moveHero(context.position,context.facing);if(['take','put'].includes(op.action))hooks.contact();if(op.action==='use')assert.equal(state.held,op.item);return true;}};}
const step=text=>parseRoom(text,{debug:true});
test('A* handles several obstacles, all current interaction points and unreachable destinations',()=>{
  const blocks=[TABLE,{id:'future-test-obstacle',u:.28,v:.32,w:.13,d:.18}];
  const points=[START,[.12,.12],[.94,.12],[.93,.93],approach('book','table'),approach('water','floor')];
  for(const a of points)for(const b of points){const route=planRoute(a,b,blocks);assert.equal(route.ok,true,`${a} -> ${b}`);assert.deepEqual(route.points[0],a);assert.deepEqual(route.points.at(-1),b);for(let i=1;i<route.points.length;i++)assert.ok(clearSegment(route.points[i-1],route.points[i],blocks));}
  assert.equal(planRoute(START,[.7,.4],blocks).ok,false);
  assert.equal(planRoute([.1,.4],[.9,.4],[{u:.4,v:0,w:.1,d:1}]).ok,false,'no crossing a complete wall');
});
test('projected depth controls scale; planted feet stay fixed through diagonal steps without stretching bones',()=>{
  assert.ok(heroScale([.2,.2])<heroScale([.8,.8]));assert.ok(distance(unproject(project([.4,.7])),[.4,.7])<1e-10);
  const route=[[.1,.15],[.4,.3],[.4,.8]],length=routeLength(route);let planted=0;
  for(const facing of ['right','left','front','back'])for(let at=10;at<length-2;at+=1.5){
    const a=walkingFrame(route,at,facing),b=walkingFrame(route,at+1,facing),frame=bodyFrame(a.pose);
    for(const [side,hip] of [['l',frame.hipLeft],['r',frame.hipRight]]){
      const knee=a.pose[side+'k'],ankle=a.pose[side+'a'];assert.ok(Math.abs(distance(hip,knee)-76)<.03);assert.ok(Math.abs(distance(knee,ankle)-77)<.03);
      const label=side==='l'?'left':'right';if(a.contacts[label].planted&&b.contacts[label].planted){const first=worldPoint(a.position,a.pose[side+'f'],facing),next=worldPoint(b.position,b.pose[side+'f'],facing);assert.ok(distance(first,next)<.01,'grounded foot does not slide');planted++;}
    }
  }assert.ok(planted>100);
});
test('step operations enforce proximity, ownership, capabilities and complete exactly the requested action',async()=>{
  const state=new RoomState(memory()),events=[];create(state,'desk','book','water');const queue=new RoomController(state,fakeRenderer(state,events));
  assert.equal((await queue.run(step('/take book'))).type,'error');assert.equal(state.held,null);
  await queue.run(step('/move_to desk'));const here=[...state.hero.position];assert.notDeepEqual(here,START);assert.equal(state.held,null);
  await queue.run(step('/take book'));assert.equal(state.items.book,'hand');assert.equal(state.held,'book');assert.equal(state.objects.book.location.surface,'hero');assert.deepEqual(state.objects.book.returnTo.kind,'table');
  assert.equal((await queue.run(step('/take water'))).type,'error');
  await queue.run(step('/use book'));assert.equal(state.items.book,'hand','use does not put automatically in step mode');
  await queue.run(step('/put book'));assert.equal(state.items.book,'table');assert.equal(state.held,null);assert.deepEqual(state.hero.position,here);
  const snapshot=JSON.stringify(state.items);assert.equal((await queue.run(step('/open desk'))).type,'error');assert.equal((await queue.run(step('/close book'))).type,'error');assert.equal(JSON.stringify(state.items),snapshot);
  assert.ok(queue.history.some(op=>op.status==='waiting'));assert.ok(queue.history.some(op=>op.status==='running'));assert.ok(queue.history.some(op=>op.status==='completed'));assert.ok(queue.history.some(op=>op.status==='error'));
  assert.equal(parseRoom('/take book').ok,false,'debug language is unavailable in normal or speech mode');
});
test('automatic book and water use compose the same operations, retaining actual position for next command',async()=>{
  const state=new RoomState(memory()),events=[];create(state,'desk','book','water');const queue=new RoomController(state,fakeRenderer(state,events));
  const reading=queue.run(parseRoom('책을 읽어요')),drinking=queue.run(parseRoom('물을 마셔요'));await Promise.all([reading,drinking]);
  assert.deepEqual(events,['move_to:book','take:book','use:book','move_to:book','put:book','move_to:water','take:water','use:water','move_to:water','put:water']);
  assert.deepEqual(state.items,{desk:'floor',book:'table',water:'table',chair:null,bed:null,apple:null,phone:null,milk:null,lamp:null});assert.ok(state.canInteract('water',state.contextAt('water',state.hero.position)));assert.notDeepEqual(state.hero.position,START);assert.equal(queue.busy,false);
});
test('contact transfers ownership only after the wrist reaches floor or tabletop grip, then restores exact anchor',async()=>{
  for(const surface of ['floor','table'])for(const id of ['book','water']){
    const state=new RoomState(memory());if(surface==='table')create(state,'desk');create(state,id);state.moveHero(approach(id,surface),'right');
    const renderer=Object.create(RoomRenderer.prototype);Object.assign(renderer,{state,pose:structuredClone(POSES.stand),carry:{angle:0,open:0},scene:{dataset:{}},draw(){},phase(){},async tween(ms,fn){fn(1);return true;},async poseTo(p){this.pose=p;return true;}});
    let contacts=0;await renderer.perform({action:'take',item:id},state.prepare({action:'take',item:id}),{contact(){assert.equal(state.items[id],surface);assert.ok(distance(wristWorld(state.hero.position,renderer.pose),gripWorld(id,surface))<.001);state.contact({action:'take',item:id});contacts++;}});
    assert.equal(contacts,1);assert.equal(state.items[id],'hand');assert.equal(state.describe(id).held,true);
    await renderer.perform({action:'put',item:id},state.prepare({action:'put',item:id}),{contact(){assert.equal(state.items[id],'hand');assert.ok(distance(wristWorld(state.hero.position,renderer.pose),gripWorld(id,surface))<.001);state.contact({action:'put',item:id});}});
    assert.equal(state.items[id],surface);assert.equal(state.objects[id].returnTo,null);
  }
});
test('landings keep the selected horizontal coordinate and no post-commit shift; book openness is continuous',()=>{
  for(const point of [[222,480],[625,432]]){for(let n=0;n<=60;n++)assert.equal(landingPoint(point,n/60)[0],point[0]);assert.deepEqual(landingPoint(point,1),point);}
  assert.match(itemArt('book',{open:.5,held:true}),/data-open="0.500"/);assert.match(itemArt('book',{open:1,held:true}),/data-open="1.000"/);
});
test('held state and position survive reload; removing support preserves ownership and redirects put to floor',async()=>{
  const storage=memory(),state=new RoomState(storage);create(state,'desk','book');state.moveHero(approach('book','table'));state.contact({action:'take',item:'book'});
  const restored=new RoomState(storage);assert.equal(restored.held,'book');assert.equal(restored.items.book,'hand');assert.deepEqual(restored.hero.position,state.hero.position);
  restored.commit(restored.plan({action:'remove',item:'desk'}));assert.equal(restored.items.book,'hand');assert.equal(restored.objects.book.returnTo.kind,'floor');
  const queue=new RoomController(restored,fakeRenderer(restored));await queue.run(parseRoom('책을 읽어요'));assert.equal(restored.items.book,'floor');assert.ok(restored.canInteract('book',restored.contextAt('book',restored.hero.position)));
  const final=new RoomState(storage);assert.deepEqual(final.items,restored.items);assert.deepEqual(final.hero,restored.hero);
});
test('old saves migrate; malformed ownership cannot restore two held props or ghost tabletop items',()=>{
  const storage=memory();storage.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:1,items:{desk:'floor',book:'table',water:'floor',chair:null,bed:null,apple:null,phone:null,milk:null,lamp:null}}));const state=new RoomState(storage);assert.deepEqual(state.items,{desk:'floor',book:'table',water:'floor',chair:null,bed:null,apple:null,phone:null,milk:null,lamp:null});
  const duplicate={version:2,hero:{position:[.7,.4]},objects:{desk:{location:{kind:'floor'}},book:{location:{kind:'hand'},returnTo:{kind:'table'}},water:{location:{kind:'hand'}}}};
  storage.setItem(ROOM_STORAGE_KEY,JSON.stringify(duplicate));const repaired=new RoomState(storage);assert.equal(Object.values(repaired.items).filter(kind=>kind==='hand').length,1);assert.ok(walkable(repaired.hero.position,repaired.obstacles));
});
test('cancelling an in-flight move keeps its actual position and completed take keeps a single held owner',async()=>{
  const state=new RoomState(memory());create(state,'book');let finish;
  const renderer=fakeRenderer(state);renderer.perform=async(op,context,hooks)=>{if(op.action==='move_to'){state.moveHero([.2,.8]);return new Promise(r=>{finish=r;});}hooks.contact();return true;};
  const queue=new RoomController(state,renderer),current=queue.run(step('/move_to book')),pending=queue.run(step('/take book'));queue.cancel();finish(false);
  assert.equal((await current).cancelled,true);assert.equal((await pending).cancelled,true);assert.deepEqual(state.hero.position,[.2,.8]);assert.equal(state.items.book,'floor');
});
