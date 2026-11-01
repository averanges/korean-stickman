import {POSES} from './geometry.js';
import {project} from './room-space.js';
import {clonePose,localPoint} from './room-motion.js';
import {OBJECT_TYPES} from './room-catalog.js';
export function restPose(state,posture=state.hero.posture,support=state.hero.support){
 const pose=clonePose(POSES.stand),position=state.hero.position;
 if(!support||posture==='standing')return pose;
 const f=OBJECT_TYPES[support].footprint,toLocal=p=>localPoint(position,p,'right'),set=(key,p)=>pose[key]=toLocal(p);
 if(posture==='sitting'){
  const uv=[f.u+f.w/2,f.v+f.d/2],seat=project(uv,f.height+3);
  for(const [key,dx,dy] of [['h',-6,-101],['n',-5,-63],['p',0,0],['lw',27,-2],['rw',40,4],['lk',42,22],['rk',54,27],['la',43,66],['ra',55,72],['lf',57,69],['rf',69,75]])set(key,[seat[0]+dx,seat[1]+dy]);
  pose.angle=-3;
 }else{
  const u=f.u+f.w*.52,v=f.v,h=f.height+8;
  for(const [key,dv,du,dh] of [['h',.075,0,0],['n',.165,0,0],['p',.29,0,0],['lw',.28,-.04,5],['rw',.29,.04,6],['lk',.38,-.02,7],['rk',.38,.025,3],['la',.435,-.02,0],['ra',.435,.025,0],['lf',.455,-.02,0],['rf',.455,.025,0]])set(key,project([u+du,v+dv],h+dh));
  pose.angle=62;pose.eye=posture==='sleeping'?0:1;
 }
 return pose;
}
