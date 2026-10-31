// Scene geometry only: no profile, speech or game rules live here.
export const CHAIR = { scale: .72, x: 200, y: 680, originX: 235, originY: 680 };
export const BOX = { scale: .9, x: 608, y: 688, originX: 608, originY: 690 };
export function propTransform(prop) {
  return `translate(${prop.x} ${prop.y}) scale(${prop.scale}) translate(${-prop.originX} ${-prop.originY})`;
}
export const POSES = {
  sleep:  { h:[220,420], n:[220,484], p:[235,574], le:[254,509], lw:[275,564], re:[278,504], rw:[294,569], lk:[299,582], la:[308,670], lf:[334,675], rk:[311,590], ra:[333,670], rf:[360,675], eye:0, angle:12 },
  seated: { h:[220,412], n:[220,476], p:[235,574], le:[254,509], lw:[275,564], re:[278,504], rw:[294,569], lk:[299,582], la:[308,670], lf:[334,675], rk:[311,590], ra:[333,670], rf:[360,675], eye:1, angle:0 },
  rise:   { h:[320,369], n:[297,430], p:[292,520], le:[289,478], lw:[322,535], re:[335,467], rw:[354,535], lk:[335,594], la:[350,670], lf:[377,675], rk:[335,588], ra:[328,670], rf:[355,675], eye:1, angle:8 },
  stand:  { h:[362,362], n:[362,426], p:[364,520], le:[313,471], lw:[335,548], re:[380,489], rw:[422,543], lk:[342,593], la:[334,670], lf:[360,675], rk:[389,593], ra:[396,670], rf:[423,675], eye:1, angle:0 },
  search: { h:[484,422], n:[453,478], p:[404,553], le:[416,543], lw:[477,560], re:[504,520], rw:[548,584], lk:[350,610], la:[334,670], lf:[360,675], rk:[448,621], ra:[396,670], rf:[423,675], eye:1, angle:13 },
  show:   { h:[378,349], n:[378,413], p:[378,503], le:[329,475], lw:[335,545], re:[459,391], rw:[520,421], lk:[347,582], la:[334,670], lf:[360,675], rk:[395,582], ra:[396,670], rf:[423,675], eye:1, angle:0 },
};
export const lerp = (a,b,t) => a+(b-a)*t;
export const ease = t => t*t*(3-2*t);
export function mixPose(a,b,t) {
  const result=Object.fromEntries(Object.keys(a).map(key => [key, Array.isArray(a[key]) ? a[key].map((value,i)=>lerp(value,b[key][i],t)) : lerp(a[key],b[key],t)]));
  const length=pose=>Math.hypot(pose.p[0]-pose.n[0],pose.p[1]-pose.n[1]);
  const expected=lerp(length(a),length(b),t),actual=length(result)||1;
  result.p=result.p.map((value,index)=>result.n[index]+(value-result.n[index])*expected/actual);
  return result;
}
export function bodyFrame(pose) {
  const dx=pose.p[0]-pose.n[0],dy=pose.p[1]-pose.n[1],length=Math.hypot(dx,dy)||1;
  const side=[dy/length,-dx/length];
  const offset=(joint,distance)=>[joint[0]+side[0]*distance,joint[1]+side[1]*distance];
  return {side,shoulderLeft:offset(pose.n,-12),shoulderRight:offset(pose.n,12),hipLeft:offset(pose.p,-8),hipRight:offset(pose.p,8)};
}
// Two-bone arms retain their lengths instead of stretching between keyframes.
export function solveArm(start,end,bend,upper=72,lower=70) {
  const dx=end[0]-start[0],dy=end[1]-start[1],raw=Math.hypot(dx,dy)||.001;
  const distance=Math.min(raw,upper+lower-.001), ux=dx/raw,uy=dy/raw;
  const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
  const across=Math.sqrt(Math.max(0,upper*upper-along*along));
  return [start[0]+ux*along-uy*across*bend,start[1]+uy*along+ux*across*bend];
}
export function articulate(pose) {
  const result=mixPose(pose,pose,0),frame=bodyFrame(pose);
  result.le=solveArm(frame.shoulderLeft,pose.lw,1);
  result.re=solveArm(frame.shoulderRight,pose.rw,1);
  return result;
}
// Per-asset corrections share one system. Grip is the point held during retrieval.
export const FIT = {
  china:{scale:.87,x:0,y:-49,grip:[0,-53]}, korea:{scale:.82,x:0,y:-48,grip:[0,-61]},
  cowboy:{scale:.86,x:0,y:-48,grip:[0,-58]}, japan:{scale:.86,x:0,y:-49,grip:[0,-59]},
  alpine:{scale:.9,x:2,y:-49,grip:[0,-56]}, beret:{scale:.88,x:-2,y:-50,grip:[0,-53]},
  ushanka:{scale:.83,x:0,y:-48,grip:[0,-62]}, bowler:{scale:.88,x:0,y:-49,grip:[0,-65]},
  chef:{scale:.82,x:0,y:-49,grip:[0,-83]}, helmet:{scale:.9,x:0,y:-48,grip:[0,-63]},
  backpack:{scale:.73,grip:[0,-93]}, pointer:{scale:.72,grip:[27,-128]},
  stethoscope:{scale:.74,grip:[-28,-85]}, briefcase:{scale:.74,grip:[0,-66]},
  microphone:{scale:.73,grip:[0,-78]}, notebook:{scale:.72,grip:[-8,-78]},
};
export function flagAnchor(pose) { return {x:pose.h[0]+77,y:pose.h[1]-20,scale:.69,rotation:0}; }
export function attachment(slot,pose,look) {
  const id=look[slot],fit=FIT[id]||{scale:.8,x:0,y:-49};
  if(slot==='hat') {
    const radians=pose.angle*Math.PI/180,dx=fit.x||0,dy=fit.y;
    return {x:pose.h[0]+dx*Math.cos(radians)-dy*Math.sin(radians),y:pose.h[1]+dx*Math.sin(radians)+dy*Math.cos(radians),scale:fit.scale,rotation:pose.angle};
  }
  const spineAngle=-Math.atan2(pose.p[0]-pose.n[0],pose.p[1]-pose.n[1])*180/Math.PI;
  if(slot==='back'||slot==='body'){
    const {side}=bodyFrame(pose),across=slot==='back'?-38:0,down=slot==='back'?90:82;
    return {x:pose.n[0]+side[0]*across-side[1]*down,y:pose.n[1]+side[1]*across+side[0]*down,scale:fit.scale,rotation:spineAngle};
  }
  // Final hand grips differ from the top-of-object retrieval grip.
  const grip=id==='briefcase'?[0,-66]:id==='pointer'?[0,-12]:id==='notebook'?[-23,-35]:[0,-23];
  return {x:pose.rw[0]-grip[0]*fit.scale,y:pose.rw[1]-grip[1]*fit.scale,scale:fit.scale,rotation:0};
}
export function heldAtWrist(id,pose,flagOnly=false) {
  const scale=flagOnly?.63:.64,grip=flagOnly?[-5,28]:(FIT[id]?.grip||[0,-65]);
  return {x:pose.rw[0]-grip[0]*scale,y:pose.rw[1]-grip[1]*scale,scale,rotation:0};
}
export function attachmentFlight(start,end,t) {
  const e=ease(t);
  return {x:lerp(start.x,end.x,e),y:lerp(start.y,end.y,e)-Math.sin(t*Math.PI)*55,scale:lerp(start.scale,end.scale,e),rotation:lerp(start.rotation,end.rotation,e)};
}
export function transformAt(point) { return `translate(${point.x} ${point.y}) rotate(${point.rotation||0}) scale(${point.scale})`; }
