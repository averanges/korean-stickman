import {POSES,mixPose,articulate,bodyFrame,solveArm} from './geometry.js';
import {project,heroScale,facingSign,GRIPS,itemLocation} from './room-space.js';
import {sampleRoute} from './room-navigation.js';
export const clonePose=pose=>mixPose(pose,pose,0);
export function floorPose(){return {...clonePose(POSES.stand),h:[406,482],n:[390,544],p:[366,610],lw:[326,604],rw:[430,609],lk:[332,635],rk:[421,625],angle:15};}
export function localPoint(position,point,facing='right'){const origin=project(position),scale=heroScale(position);return [370+(point[0]-origin[0])/scale*facingSign(facing),675+(point[1]-origin[1])/scale];}
export function worldPoint(position,point,facing='right'){const origin=project(position),scale=heroScale(position);return [origin[0]+(point[0]-370)*scale*facingSign(facing),origin[1]+(point[1]-675)*scale];}
export function wristWorld(position,pose,facing='right'){return worldPoint(position,articulate(pose).rw,facing);}
export function reachPose(position,point,base=POSES.stand,facing='right'){return {...clonePose(base),rw:localPoint(position,point,facing)};}
export function gripWorld(id,placement){return itemLocation(id,placement).point.map((v,i)=>v+GRIPS[id][i]);}
export function reachableGrip(position,context){
  const pose=reachPose(position,context.grip,context.location.kind==='floor'?floorPose():POSES.stand,context.facing),shoulder=bodyFrame(pose).shoulderRight;
  return Math.hypot(pose.rw[0]-shoulder[0],pose.rw[1]-shoulder[1])<=141.9;
}
export function carryPose(){return {...clonePose(POSES.stand),rw:[432,495]};}
export function useTarget(id,position,facing='right'){
  if(id==='book')return worldPoint(position,[430,475],facing);
  const mouth=worldPoint(position,[379,392],facing),sign=facingSign(facing),angle=-65*sign*Math.PI/180;
  // Cap is 40 px above the item's grip. Choose wrist from the cap, not a guessed arm offset.
  return [mouth[0]-40*Math.sin(angle),mouth[1]+40*Math.cos(angle)];
}
export function walkingFrame(route,at,facing='right'){
  const position=sampleRoute(route,at),pose=clonePose(POSES.stand),stride=70;
  const anchor=(where,side)=>{
    const p=project(sampleRoute(route,where)),a=project(sampleRoute(route,Math.max(0,where-2))),b=project(sampleRoute(route,where+2));
    let dx=b[0]-a[0],dy=b[1]-a[1];if(Math.hypot(dx,dy)<.001){const start=project(route[0]),end=project(route.at(-1));dx=end[0]-start[0];dy=end[1]-start[1];}
    const length=Math.hypot(dx,dy)||1,normal=[-dy/length,dx/length];if(normal[0]*facingSign(facing)<0){normal[0]*=-1;normal[1]*=-1;}
    return [p[0]+normal[0]*side*7,p[1]+normal[1]*side*7];
  };
  const foot=(phaseShift,side)=>{
    const phaseDistance=at+phaseShift*stride,cycle=Math.floor(phaseDistance/stride),phase=phaseDistance/stride-cycle;
    const plantedDistance=cycle*stride-phaseShift*stride+stride*.22;
    const swing=phase>.56?(phase-.56)/.44:0,e=swing*swing*(3-2*swing);
    const a=anchor(plantedDistance,side),b=anchor(plantedDistance+stride,side),floor=a.map((v,i)=>v+(b[i]-v)*e);
    return {floor,screen:[floor[0],floor[1]-Math.sin(swing*Math.PI)*12],planted:phase<=.56};
  };
  const left=foot(0,-1),right=foot(.5,1),lf=localPoint(position,left.screen,facing),rf=localPoint(position,right.screen,facing);
  pose.lf=lf;pose.rf=rf;pose.la=[lf[0]-12,lf[1]-4];pose.ra=[rf[0]-12,rf[1]-4];
  // Keep planted contacts fixed and bend the body rather than stretching the two leg bones.
  for(let i=0;i<55;i++){
    const f=bodyFrame(pose),raw=Math.max(Math.hypot(f.hipLeft[0]-pose.la[0],f.hipLeft[1]-pose.la[1]),Math.hypot(f.hipRight[0]-pose.ra[0],f.hipRight[1]-pose.ra[1]));
    if(raw<=152)break;for(const key of ['h','n','p','lw','rw'])pose[key][1]+=.7;
  }
  const f=bodyFrame(pose),side=['left','right'].includes(facing);pose.lk=solveArm(f.hipLeft,pose.la,side?-1:1,76,77);pose.rk=solveArm(f.hipRight,pose.ra,-1,76,77);
  const swing=Math.sin(at/stride*Math.PI*2);pose.lw[0]+=swing*18;pose.rw[0]-=swing*18;
  return {position,pose,contacts:{left,right}};
}
