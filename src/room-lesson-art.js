import {POSES,ease} from './geometry.js';
import {clonePose,localPoint,worldPoint,reachPose,carryPose,useTarget} from './room-motion.js';
import {walkable} from './room-navigation.js';
import {project,unproject,distance,facingSign} from './room-space.js';
export function lessonSeat(position,facing='right'){
 const p=project(position),s=facingSign(facing),pose=clonePose(POSES.stand);
 for(const [key,x,y] of [['h',-5,-162],['n',-4,-124],['p',0,-60],['lw',22,-67],['rw',38,-65],['lk',31,-40],['rk',45,-35],['la',32,-3],['ra',46,0],['lf',47,0],['rf',61,3]])pose[key]=localPoint(position,[p[0]+x*s,p[1]+y],facing);
 pose.angle=-2;return pose;
}
export function friendArt(progress=0,wave=0){if(progress<=0)return '';return `<g data-visitor="friend" transform="translate(0 ${58*(1-progress)-36})" opacity="${progress}" stroke="#303237" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M87-12L83 34M87-6L64 7" fill="none"/><path d="M91-8L112-24L${119+5*Math.sin(wave)} ${-49-7*Math.cos(wave)}" fill="none"/><circle cx="86" cy="-37" r="24" fill="#fffdf8"/><circle cx="79" cy="-39" r="1.7" fill="#303237"/><circle cx="94" cy="-39" r="1.7" fill="#303237"/><path d="M80-30Q87-23 94-30" fill="none"/></g>`;}
export function lessonProps(visual,result){
 let props='';if(visual?.seated){const [x,y]=project(visual.position);props+=`<g data-lesson-prop="stool" stroke="#6b513d" stroke-width="2.5"><path d="M${x-12} ${y-57}v55M${x+13} ${y-54}v57"/><ellipse cx="${x}" cy="${y-59}" rx="24" ry="8" fill="#e3b97c"/></g>`;}
 const p=visual?.point;if(p&&['study','learn'].includes(visual.kind)){
  const [x,y]=p;
  props+=visual.kind==='study'?`<g data-lesson-prop="study-material" transform="translate(${x} ${y})" stroke="#7e8f72" stroke-width="1.6"><path d="M-31 0L-31-29Q-13-36 0-22Q13-36 31-29V0Q13-8 0 2Q-13-8-31 0Z" fill="#fff8df"/><path d="M0-22V2M-24-23L-8-16M-24-16L-8-9M8-16L24-23M8-9L24-16" fill="none"/><path d="M${8+visual.t*12}-22l8 3" stroke="#e9b449" stroke-width="3"/></g>`:`<g data-lesson-prop="learning-card" transform="translate(${x} ${y-26})"><rect x="-26" y="-54" width="52" height="60" rx="5" fill="#d8eef0" stroke="#6b999b" stroke-width="2"/><text x="0" y="-15" text-anchor="middle" fill="#385f68" font-size="23" font-family="sans-serif">한</text></g>`;
 }
 if(visual?.kind==='learn'&&visual.t>.35){const [x,y]=project(visual.position);props+=`<g data-lesson-prop="understanding" transform="translate(${x+30} ${y-225})" opacity="${Math.min(1,(visual.t-.35)*4)}" stroke="#dca437" stroke-width="2.4" fill="#ffe593"><path d="M-6 4C-25-19 24-24 7 4L5 12H-4Z"/><path d="M-3 16H4M0-25V-32M-17-19L-23-24M18-18L24-24" fill="none"/></g>`;}
 if(result?.kind==='bag'){const [x,y]=result.point;props+=`<g data-lesson-prop="shopping-bag" transform="translate(${x} ${y})" stroke="#9a7646" stroke-width="2.2"><path d="M-17-32H17L21 1H-21Z" fill="#ebc98d"/><path d="M-8-31V-40Q0-50 8-40V-31" fill="none"/><path d="M-11-21L-5-26L0-23L5-26L11-21L7-15L4-17V-5H-4V-17L-7-15Z" fill="#df8d7b"/><path d="M12-45l5 5 9-12" fill="none" stroke="#6c9e70" stroke-width="3"/></g>`;}
 return props;
}
export function purchasePoint(state){
 const p=project(state.hero.position),candidates=[];
 for(const radius of [65,85,105,125])for(const angle of [Math.PI/2,Math.PI/3,Math.PI*2/3,Math.PI/6,Math.PI*5/6,0,Math.PI]){
  const q=[p[0]+Math.cos(angle)*radius,p[1]+Math.sin(angle)*radius*.75];
  const safe=[[-22,-9],[22,-9],[-22,9],[22,9]].every(([x,y])=>walkable(unproject([q[0]+x,q[1]+y]),state.obstacles,.02));
  if(safe&&Object.values(state.objects).filter(o=>o.type==='portable'&&o.location.kind==='floor').every(o=>distance(q,project(o.location.uv))>o.floorFootprint.rx+24))candidates.push(q);
 }
 return candidates[0]||[p[0]-40,p[1]+48];
}
export async function animateLesson(renderer,kind,target){
 const r=renderer,position=[...r.position],held=r.state.held,seated=['study','homework','work'].includes(kind),point=target?.point||null;
 r.lessonResult=null;r.lessonVisual={kind,position,point,seated,t:0};r.interactionSurface=point?'desk':null;
 const face=kind==='shop'?r.facing:target.facing;if(!await r.turnTo(face))return false;
 const base=seated?lessonSeat(position,r.facing):clonePose(POSES.stand);r.phase('lesson-'+kind,({study:'공부해요 — занимаемся за столом.',learn:'한국어를 배워요 — новое слово!',homework:'숙제를 해요 — пишем ручкой.',work:'일해요 — работаем за компьютером.',exercise:'운동해요 — делаем зарядку.',meet:'친구를 만나요 — привет, друг!',movie:'영화를 봐요 — смотрим фильм.',shop:'옷을 사요 — выбираем одежду.'})[kind]);
 if(!await r.poseTo(base,550))return false;
 let active=clonePose(base);
 if(point){
  let wrist=kind==='homework'?[point[0],point[1]-35]:[point[0]+9,point[1]-8];
  if(kind==='learn')wrist=[point[0],point[1]-35];
  active=reachPose(position,wrist,base,r.facing);
  if(['study','work'].includes(kind))active.lw=localPoint(position,[point[0]-14,point[1]-6],r.facing);
 }
 if(kind==='shop'){active=reachPose(position,useTarget('phone',position,r.facing),base,r.facing);r.carry={angle:0,open:0,lit:true,screen:'shop'};}
 if(!await r.poseTo(active,500))return false;
 const deliveryPoint=kind==='shop'?purchasePoint(r.state):null;
 const done=await r.tween(kind==='exercise'?2600:2800,t=>{
  r.lessonVisual.t=t;r.pose=clonePose(active);const cycle=Math.sin(t*Math.PI*8);
  if(kind==='study'){r.pose.angle=2*Math.sin(t*Math.PI*2);r.pose.h[1]+=Math.sin(t*Math.PI*4)*2;}
  if(kind==='learn'){r.pose.angle=t>.35?Math.sin(t*Math.PI*6)*3:0;r.pose.eye=t>.35?1:.8;}
  if(kind==='homework'){r.pose.rw=localPoint(position,[point[0]+Math.sin(t*Math.PI*10)*9,point[1]-35+Math.cos(t*Math.PI*10)*2],r.facing);}
  if(kind==='work'){r.pose.rw[1]+=cycle*3;r.pose.lw[1]-=cycle*3;}
  if(kind==='exercise'){
   const spread=(1-Math.cos(t*Math.PI*8))/2,jump=Math.sin(t*Math.PI*8)**2;
   r.pose.rw=[422+55*spread,543-225*spread];r.pose.lw=[335-62*spread,548-225*spread];
   for(const key of ['h','n','p'])r.pose[key][1]-=jump*18;
   for(const [key,d] of [['la',-1],['lf',-1],['ra',1],['rf',1]]){r.pose[key][0]+=d*42*spread;r.pose[key][1]-=jump*9;}
   r.pose.lk[0]-=22*spread;r.pose.rk[0]+=22*spread;
  }
  if(kind==='meet'){r.visitor={visible:1,wave:t*Math.PI*8};r.pose.rw=[432,396+cycle*19];}
  if(kind==='movie'){r.pose.angle=Math.sin(t*Math.PI*2);}
  if(kind==='shop'&&t>.55)r.lessonResult={kind:'bag',point:deliveryPoint};
 });
 if(!done)return false;
 if(kind==='meet'){if(!await r.tween(550,t=>{r.visitor={visible:1-ease(t),wave:0};}))return false;}
 r.visitor=null;r.carry={angle:0,open:0};
 if(!await r.poseTo(held?carryPose():POSES.stand,600))return false;
 r.lessonVisual=null;r.interactionSurface=null;r.draw();return true;
}
