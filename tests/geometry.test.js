import test from 'node:test';
import assert from 'node:assert/strict';
import { POSES, CHAIR, BOX, FIT, mixPose, bodyFrame, articulate, attachment, heldAtWrist, attachmentFlight, flagAnchor } from '../src/geometry.js';
import { boxLayers, chairArt } from '../src/assets.js';
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const routes=[['sleep','seated'],['seated','rise'],['rise','stand'],['stand','search'],['search','show'],['show','stand']];

test('seated pelvis rests on the resized seat; standing limbs clear the chair',()=>{
  assert.equal(CHAIR.scale,.72);assert.equal(BOX.scale,.9);
  const chairRight=CHAIR.x+(333-CHAIR.originX)*CHAIR.scale+2.5;
  const rawX=(POSES.seated.p[0]-CHAIR.x)/CHAIR.scale+CHAIR.originX;
  const frontSurface=CHAIR.y+(541+(332-rawX)*23/132-CHAIR.originY)*CHAIR.scale;
  assert.ok(frontSurface-(POSES.seated.p[1]+10)>=0&&frontSurface-(POSES.seated.p[1]+10)<12);
  for(const name of ['stand','search','show']){
    const p=articulate(POSES[name]);
    assert.ok(p.h[0]-65>chairRight,`${name}: head overlaps chair`);
    for(const joint of ['n','p','le','lw','re','rw','lk','la','lf','rk','ra','rf']) assert.ok(p[joint][0]-8>chairRight,`${name}: ${joint} overlaps chair`);
    assert.equal(p.lf[1],675);assert.equal(p.rf[1],675);
  }
  assert.match(chairArt(),/scale\(0.72\)/);
});
test('arm lengths and compact torso are maintained through every transition',()=>{
  for(const [from,to] of routes)for(let i=0;i<=40;i++){
    const p=articulate(mixPose(POSES[from],POSES[to],i/40)),frame=bodyFrame(p);
    assert.ok(distance(p.n,p.p)>=88&&distance(p.n,p.p)<=105);
    for(const [shoulder,elbow,wrist] of [[frame.shoulderLeft,p.le,p.lw],[frame.shoulderRight,p.re,p.rw]]){
      assert.ok(Math.abs(distance(shoulder,elbow)-72)<.02);
      assert.ok(Math.abs(distance(elbow,wrist)-70)<.02);
    }
  }
});
test('wrist enters behind the near wall; box pieces remain ordered and distinct',()=>{
  const p=POSES.search;
  const nearWallY=BOX.y+(559-BOX.originY)*BOX.scale;
  assert.ok(p.rw[0]>500&&p.rw[0]<620);assert.ok(p.rw[1]-5>nearWallY);
  const layers=boxLayers();
  assert.match(layers.back,/M457 534/);assert.doesNotMatch(layers.back,/M457 542/);
  assert.match(layers.contents,/translate\(535 533\)/);assert.doesNotMatch(layers.contents,/M457 542/);
  assert.match(layers.front,/M457 542/);
});
test('ushanka, pointer and backpack retrieval grips stay glued to the wrist',()=>{
  for(const id of ['ushanka','pointer','backpack','stethoscope'])for(let i=0;i<=40;i++){
    const pose=mixPose(POSES.search,POSES.show,i/40),held=heldAtWrist(id,pose),grip=FIT[id].grip;
    assert.ok(Math.abs(held.x+grip[0]*held.scale-pose.rw[0])<1e-8);
    assert.ok(Math.abs(held.y+grip[1]*held.scale-pose.rw[1])<1e-8);
  }
});
test('headwear shares the rotated head attachment and flags stay clear of the face',()=>{
  for(const id of ['ushanka','china','beret','chef','cowboy'])for(const angle of [-16,0,13]){
    const pose={...POSES.stand,angle},a=attachment('hat',pose,{hat:id}),fit=FIT[id],r=angle*Math.PI/180;
    assert.equal(a.scale,fit.scale);assert.equal(a.rotation,angle);
    assert.ok(Math.abs(a.x-(pose.h[0]+(fit.x||0)*Math.cos(r)-fit.y*Math.sin(r)))<1e-9);
    assert.ok(Math.abs(a.y-(pose.h[1]+(fit.x||0)*Math.sin(r)+fit.y*Math.cos(r)))<1e-9);
  }
  const flag=flagAnchor(POSES.stand);assert.ok(flag.x-5*flag.scale>POSES.stand.h[0]+65);
});
test('retrieval, flight and mounted item share identical boundary transforms',()=>{
  for(const [id,slot] of [['ushanka','hat'],['pointer','hand'],['backpack','back'],['stethoscope','body']]){
    const start=heldAtWrist(id,POSES.show),end=attachment(slot,POSES.stand,{[slot]:id});
    const first=attachmentFlight(start,end,0),last=attachmentFlight(start,end,1);
    for(const key of ['x','y','scale','rotation']){assert.ok(Math.abs(first[key]-start[key])<1e-9);assert.ok(Math.abs(last[key]-end[key])<1e-9);}
    let previous=first;
    for(let i=1;i<=100;i++){const current=attachmentFlight(start,end,i/100);assert.ok(distance([current.x,current.y],[previous.x,previous.y])<6);previous=current;}
  }
  for(const slot of ['body','back']){
    const id=slot==='body'?'stethoscope':'backpack',standing=attachment(slot,POSES.stand,{[slot]:id}),leaning=attachment(slot,POSES.search,{[slot]:id});
    const localRadius=Math.hypot(standing.x-POSES.stand.n[0],standing.y-POSES.stand.n[1]);
    assert.ok(Math.abs(Math.hypot(leaning.x-POSES.search.n[0],leaning.y-POSES.search.n[1])-localRadius)<1e-9);
    assert.ok(leaning.x<POSES.search.n[0]);
  }
});
