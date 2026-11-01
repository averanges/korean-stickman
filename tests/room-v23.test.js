import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomState} from '../src/room-state.js';
import {TABLE,START,project,distance,facingDirection} from '../src/room-space.js';
import {NAV,planRoute,clearSegment,walkable,routeLength,sampleRoute,smoothRoute} from '../src/room-navigation.js';
import {walkingFrame,walkingBlend,poseInFacing,worldPoint,wristWorld,clonePose} from '../src/room-motion.js';
import {POSES} from '../src/geometry.js';
import {RoomRenderer} from '../src/room-renderer.js';
import {Renderer} from '../src/renderer.js';
import {appearance} from '../src/catalog.js';
const roomWith=(...ids)=>{const room=new RoomState(undefined);for(const item of ids){room.commit(room.plan({action:'create',item}));if(['book','water'].includes(item))room.objects[item].location.uv=item==='book'?[.61,.54]:[.80,.53];}return room;};
const sorted=points=>points.map(p=>p.map(v=>Math.round(v*1e6)/1e6)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
test('left-side regression selects a short reachable approach rather than the fixed front-of-desk target',()=>{
  const room=roomWith('desk','book','water');
  for(const [from,oldLength] of [[[.25,.4],137.67571116247328],[[.35,.25],196.5087842680989]]){
    room.moveHero(from);const context=room.prepare({action:'move_to',item:'book'});assert.equal(context.ok,true);assert.ok(routeLength(context.route)<oldLength*.65);assert.ok(context.position[0]<TABLE.u);assert.equal(context.route.length,2,'clear side approach is direct');
    assert.ok(room.canInteract('book',context));assert.ok(clearSegment(...context.route,room.obstacles));
  }
});
test('desk and portable approaches minimize safe projected route length from all sides',()=>{
  const room=roomWith('desk','book','water');
  for(const from of [[.22,.72],[.25,.4],[.95,.4],[.95,.85],[.35,.15],[.2,.94]])for(const id of ['desk','book','water']){
    room.moveHero(from);const context=room.prepare({action:'move_to',item:id});assert.equal(context.ok,true,`${id} from ${from}`);
    const available=room.targets(id).map(c=>planRoute(from,c.position,room.obstacles)).filter(r=>r.ok),best=Math.min(...available.map(r=>routeLength(r.points)));
    assert.ok(routeLength(context.route)<=best+1e-5);assert.deepEqual(context.route[0],from);assert.deepEqual(context.route.at(-1),context.position);
    for(let i=1;i<context.route.length;i++)assert.ok(clearSegment(context.route[i-1],context.route[i],room.obstacles));
  }
  room.moveHero([.95,.85]);assert.equal(room.canInteract('book',room.contextAt('book',room.hero.position)),false,'screen overlap alone is not physical reach');
});
test('right boundary strip is covered by A* and smoothing never crosses expanded furniture or floor bounds',()=>{
  const route=planRoute([.95,.4],[.6,.72],[TABLE]);assert.equal(route.ok,true);assert.ok(route.rawPoints.length>2);assert.ok(route.optimizedPoints.length<route.rawPoints.length);
  for(let i=1;i<route.points.length;i++)assert.ok(clearSegment(route.points[i-1],route.points[i],[TABLE]));
  for(let at=0;at<=routeLength(route.points);at+=.8)assert.ok(walkable(sampleRoute(route.points,at),[TABLE]));
  const curved=smoothRoute([[.1,.1],[.1,.8],[.8,.8]],[TABLE]);assert.ok(curved.length>3);for(let i=1;i<curved.length;i++)assert.ok(clearSegment(curved[i-1],curved[i],[TABLE]));
  assert.equal(planRoute([.1,.4],[.9,.4],[{u:.4,v:0,w:.1,d:1}]).ok,false);
});
test('whole-route animation accelerates once and settles only at the final point',async()=>{
  const state=roomWith('desk','book'),context=state.prepare({action:'move_to',item:'book'});state.moveHero([.93,.15]);const selected=state.prepare({action:'move_to',item:'book'});
  assert.ok(selected.route.length>2);let settles=0,walkCalls=0;const samples=[];
  const renderer=Object.create(RoomRenderer.prototype);Object.assign(renderer,{state,pose:clonePose(POSES.stand),poseFacing:'right',carry:{angle:0,open:0},scene:{dataset:{}},draw(){},phase(phase){this.testPhase=phase;},async turnTo(facing){state.moveHero(state.hero.position,facing);this.poseFacing=facing;return true;},async settle(){settles++;return true;},async tween(ms,update){if(this.testPhase==='walk')walkCalls++;for(let n=0;n<=200;n++){update(n/200);samples.push([...state.hero.position]);}return true;}});
  await renderer.moveTo(selected);assert.equal(walkCalls,1);assert.equal(settles,1);assert.deepEqual(state.hero.position,selected.position);assert.equal(state.held,null);
  const travel=samples.slice(0,201);for(let n=20;n<180;n++)assert.ok(distance(travel[n],travel[n-1])>1e-6,'no internal stop');
});
test('direction selection uses front/back for depth and diagonals, with hysteresis near view thresholds',()=>{
  for(const [direction,view] of [[[1,0],'right'],[[-1,0],'left'],[[0,-1],'back'],[[0,1],'front'],[[1,-1],'back'],[[-1,1],'front'],[[1,.3],'right'],[[-1,-.3],'left']])assert.equal(facingDirection(direction),view);
  assert.equal(facingDirection([1,.75],'front'),'front');assert.equal(facingDirection([1,.75],'right'),'right');
});
test('view conversion and moving turns keep world head, feet and wrist attached without mirrored jumps',()=>{
  const route=[[.15,.2],[.55,.8]],position=sampleRoute(route,70),views=['right','left','front','back'];
  for(const from of views)for(const to of views){const a=walkingFrame(route,70,from),converted=poseInFacing(a.pose,from,to);
    assert.ok(distance(worldPoint(position,a.pose.h,from),worldPoint(position,converted.h,to))<1e-6);
    assert.ok(distance(wristWorld(position,a.pose,from),wristWorld(position,converted,to))<1e-6);
    const feet=sorted([worldPoint(position,a.pose.lf,from),worldPoint(position,a.pose.rf,from)]);assert.deepEqual(sorted([worldPoint(position,converted.lf,to),worldPoint(position,converted.rf,to)]),feet);
    let previous;for(let n=0;n<=20;n++){const b=walkingBlend(route,70,from,to,n/20,true),wrist=wristWorld(position,b.pose,b.poseFacing);if(previous)assert.ok(distance(previous,wrist)<5);previous=wrist;assert.deepEqual(sorted([worldPoint(position,b.pose.lf,b.poseFacing),worldPoint(position,b.pose.rf,b.poseFacing)]),feet);}
  }
});
test('back view hides the face and places the backpack above the torso; visible profile keeps two eyes',()=>{
  const hero=Object.create(Renderer.prototype);Object.assign(hero,{actor:{dataset:{},innerHTML:''},arm:{innerHTML:''},look:appearance({country:'russia',profession:'student',gender:'male'}),asleep:false,animating:false});
  const back=hero.roomLayers(POSES.stand,{facing:'back',hideFlag:true}),side=hero.roomLayers(POSES.stand,{facing:'right',hideFlag:true});
  assert.ok(back.body.indexOf('data-slot="back"')>back.body.indexOf('data-part="torso"'));assert.ok(!back.body.includes('<ellipse cx="27"'));assert.ok(!back.body.includes('<ellipse cx="-18"'));assert.ok(back.body.includes('data-asset="ushanka"'));
  assert.ok(side.body.includes('<ellipse cx="27"'));assert.ok(side.body.includes('<ellipse cx="-6"'));
});
test('selected side approaches preserve take/use/put and exact ownership on both surfaces',async()=>{
  for(const id of ['book','water'])for(const surface of ['floor','table'])for(const start of [[.25,.4],[.95,.85]]){
    const state=surface==='table'?roomWith('desk',id):roomWith(id);state.moveHero(start);const context=state.prepare({action:'move_to',item:id});assert.equal(context.ok,true);state.moveHero(context.position,context.facing);
    const renderer=Object.create(RoomRenderer.prototype);Object.assign(renderer,{state,pose:clonePose(POSES.stand),poseFacing:state.hero.facing,carry:{angle:0,open:0},scene:{dataset:{}},draw(){},phase(){},async tween(ms,fn){fn(1);return true;},async poseTo(p){this.pose=p;return true;}});
    const origin=structuredClone(state.objects[id].location),position=[...state.hero.position];
    for(const action of ['take','use','put']){const op={action,item:id},prepared=state.prepare(op);assert.equal(prepared.ok,true,prepared.message);await renderer.perform(op,prepared,{contact(){assert.ok(distance(wristWorld(state.hero.position,renderer.pose,renderer.poseFacing),prepared.grip)<.001);state.contact(op);}});if(action!=='put')assert.equal(state.held,id);}
    assert.deepEqual(state.objects[id].location,origin);assert.deepEqual(state.hero.position,position);assert.equal(state.held,null);
  }
});
