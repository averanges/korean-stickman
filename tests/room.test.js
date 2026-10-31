import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomState,RoomController,parseRoom,approach,routeTo,TABLE,START,project,GRIPS,HERO_SCALE,ROOM_STORAGE_KEY} from '../src/room-state.js';
import {reachPose,gripWorld,floorPose,wristWorld} from '../src/room-renderer.js';
import {POSES,bodyFrame,articulate,mixPose} from '../src/geometry.js';
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};};
function apply(state,text){const parsed=parseRoom(text);assert.equal(parsed.ok,true,text);for(const command of parsed.commands){const plan=state.plan(command);if(plan.ok)state.commit(plan);}return parsed;}
test('all home commands and unambiguous particle-free forms map to room intents only',()=>{
  for(const [text,action,item] of [['책상이 있어요.','create','desk'],['책이 있어요','create','book'],['물이 있어요','create','water'],['책상이 없어요','remove','desk'],['책이 없어요','remove','book'],['물이 없어요','remove','water'],['책을 읽어요','use','book'],['물을 마셔요','use','water'],['책 있어요','create','book'],['물 마셔요','use','water'],['책 읽어요','use','book']])assert.deepEqual(parseRoom(text).commands,[{action,item}],text);
  assert.deepEqual(parseRoom('책하고 물이 있어요.').commands,[{action:'create',item:'book'},{action:'create',item:'water'}]);
  for(const text of ['책이 있어요?','책이 안 있어요','책이 없어요 책이 있어요','책을 먹어요','저는 학생이에요','물이','책상','물하고 책상이 없어요'])assert.equal(parseRoom(text).ok,false,text);
});
test('empty room, surface selection, no auto-move when desk appears, removal relocates only tabletop objects',()=>{
  const state=new RoomState(memory());assert.deepEqual(state.items,{desk:null,book:null,water:null});
  apply(state,'책이 있어요');assert.equal(state.items.book,'floor');apply(state,'책상이 있어요');assert.equal(state.items.book,'floor');
  apply(state,'물이 있어요');assert.equal(state.items.water,'table');apply(state,'책상이 없어요');assert.deepEqual(state.items,{desk:null,book:'floor',water:'floor'});
  apply(state,'책상이 있어요');assert.equal(state.items.water,'floor');
  assert.equal(state.plan({action:'create',item:'book'}).reason,'duplicate');
  apply(state,'책이 없어요');assert.equal(state.plan({action:'use',item:'book'}).reason,'missing');
});
test('room saves independently of hero, recovers invalid table placements and leaves other storage untouched',()=>{
  const storage=memory();storage.setItem('korean-stickman.hero.v2','preserved-hero');const state=new RoomState(storage);
  apply(state,'책상이 있어요');apply(state,'책하고 물이 있어요');assert.deepEqual(new RoomState(storage).items,{desk:'floor',book:'table',water:'table'});
  state.reset();assert.equal(storage.getItem('korean-stickman.hero.v2'),'preserved-hero');
  storage.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:1,items:{desk:null,book:'table',water:'unexpected'}}));assert.deepEqual(new RoomState(storage).items,{desk:null,book:'floor',water:null});
});
test('routes keep a clearance around occupied desk footprint',()=>{
  const destinations=[START,...['book','water'].flatMap(id=>['table','floor'].map(place=>approach(id,place)))];
  for(const from of destinations)for(const to of destinations){const route=routeTo(from,to);for(let i=1;i<route.length;i++)for(let n=0;n<=100;n++){
    const uv=route[i-1].map((v,k)=>v+(route[i][k]-v)*n/100);const margin=.045;
    assert.ok(!(uv[0]>TABLE.u-margin&&uv[0]<TABLE.u+TABLE.w+margin&&uv[1]>TABLE.v-margin&&uv[1]<TABLE.v+TABLE.d+margin),`${from} -> ${to}: ${uv}`);
  }}
});
test('hands reach every grip with fixed arm lengths, and held props return to exact original anchors',()=>{
  for(const id of ['book','water'])for(const place of ['table','floor']){
    const pos=approach(id,place),target=gripWorld(id,place),reach=reachPose(pos,target,place==='floor'?floorPose():POSES.stand),p=articulate(reach),s=bodyFrame(p).shoulderRight;
    assert.ok(Math.hypot(p.rw[0]-s[0],p.rw[1]-s[1])<142,'arm target reachable');
    assert.ok(Math.abs(Math.hypot(p.re[0]-s[0],p.re[1]-s[1])-72)<.01);assert.ok(Math.abs(Math.hypot(p.rw[0]-p.re[0],p.rw[1]-p.re[1])-70)<.01);
    const wrist=wristWorld(pos,reach);assert.ok(Math.hypot(...wrist.map((v,i)=>v-target[i]))<.001);
    const usePoint=project(pos).map((v,i)=>v+(id==='book'?[36,-120]:[43,-154])[i]),use=reachPose(pos,usePoint);
    for(let n=0;n<=30;n++){const during=mixPose(reach,use,n/30),shoulder=bodyFrame(during).shoulderRight;assert.ok(Math.hypot(during.rw[0]-shoulder[0],during.rw[1]-shoulder[1])<142,'no stretched intermediate arm');}
    if(id==='water'){const r=-65*Math.PI/180,cap=[usePoint[0]+40*Math.sin(r),usePoint[1]-40*Math.cos(r)],origin=project(pos),mouth=[origin[0]+(362+17-370)*HERO_SCALE,origin[1]+(362+30-675)*HERO_SCALE];assert.ok(Math.hypot(cap[0]-mouth[0],cap[1]-mouth[1])<4,'bottle cap reaches mouth');}
  }
});
test('serial room queue commits only completed animations and compound creation respects desk order',async()=>{
  const state=new RoomState(memory()),events=[];let active=0,peak=0;
  const renderer={async run(plan){active++;peak=Math.max(peak,active);events.push([plan.item,plan.next[plan.item]]);await new Promise(resolve=>setImmediate(resolve));active--;return true;},async perform(op,context,hooks){active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));if(op.action==='move_to')state.moveHero(context.position,context.facing);if(['take','put'].includes(op.action))hooks.contact();active--;return true;},async confused(){},cancel(){}};
  const queue=new RoomController(state,renderer);const first=queue.run(parseRoom('책상이 있어요')),second=queue.run(parseRoom('책하고 물이 있어요'));
  assert.equal(state.items.desk,null);await Promise.all([first,second]);assert.equal(peak,1);assert.deepEqual(events,[['desk','floor'],['book','table'],['water','table']]);
  assert.equal((await queue.run(parseRoom('책을 읽어요'))).type,'success');assert.equal(state.items.book,'table');assert.equal(queue.busy,false);assert.equal(peak,1);
});
test('leaving room cancels current and queued commands without phantom items',async()=>{
  const state=new RoomState(memory());let finish;const renderer={run:()=>new Promise(resolve=>{finish=resolve;}),cancel(){},async confused(){}};
  const queue=new RoomController(state,renderer),current=queue.run(parseRoom('책상이 있어요')),pending=queue.run(parseRoom('책이 있어요'));
  queue.cancel();finish(true);assert.equal((await current).cancelled,true);assert.equal((await pending).cancelled,true);assert.deepEqual(state.items,{desk:null,book:null,water:null});
});
