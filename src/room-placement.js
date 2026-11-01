import {project,unproject,distance} from './room-space.js';
import {walkable,chooseRoute,routeLength} from './room-navigation.js';
const placed=location=>location&&['floor','table','surface'].includes(location.kind);
export const placementError=()=>({ok:false,reason:'no-placement',message:'Рядом нет свободного доступного места. Освободи поверхность или немного пола.'});
const occupied=(state,id)=>Object.values(state.objects).filter(o=>o.id!==id&&o.type==='portable').map(o=>({...o,location:o.location.kind==='hand'?o.returnTo:o.location})).filter(o=>placed(o.location));
function footprint(uv,object){const p=project(uv),{rx,ry}=object.floorFootprint;return Array.from({length:16},(_,i)=>unproject([p[0]+Math.cos(i*Math.PI/8)*rx,p[1]+Math.sin(i*Math.PI/8)*ry]));}
function overlaps(a,loc,b){
 const p=project(loc.uv,loc.height),q=project(b.location.uv,b.location.height);
 return Math.abs(p[0]-q[0])<(a.visual.w+b.visual.w)/2+6&&p[1]+9>q[1]-b.visual.h-5&&p[1]-a.visual.h-5<q[1]+9;
}
export function furnitureBlockers(state,definition){
 const f=definition.footprint;
 return occupied(state,null).filter(o=>o.location.kind==='floor'&&( !walkable(o.location.uv,[f],.015)||footprint(o.location.uv,o).some(p=>!walkable(p,[f],.008)))).map(o=>o.id);
}
export function furnitureLocation(state,id){
 const f=state.objects[id].footprint,obstacles=[...state.obstacles,{id,...f}];
 if(state.obstacles.some(b=>f.u<b.u+b.w+.025&&f.u+f.w+.025>b.u&&f.v<b.v+b.d+.025&&f.v+f.d+.025>b.v)||!walkable(state.hero.position,obstacles))return null;
 const approaches=Object.values(state.objects).filter(o=>o.type==='furniture'&&(o.location.kind!=='absent'||o.id===id)).flatMap(o=>o.approach?[o.approach]:[]);
 if(approaches.some(position=>!chooseRoute(state.hero.position,[{position}],obstacles).ok))return null;
 return {kind:'floor',surface:'floor',uv:[f.u,f.v],height:0};
}
export function findPlacement(state,id,{avoid=[],floorOnly=false,excludeSurfaces=[]}={}){
 const object=state.objects[id],others=occupied(state,id),obstacles=[...state.obstacles,...avoid],origin=project(state.hero.position),candidates=[];
 const fits=loc=>!others.some(other=>other.location.surface===loc.surface&&overlaps(object,loc,other));
 if(!floorOnly)for(const surface of Object.values(state.objects)){
  const config=surface.surface;if(!config||surface.location.kind==='absent'||state.hero.support===surface.id||excludeSurfaces.includes(surface.id))continue;
  if(object.visual.w>config.maxWidth||object.visual.h>config.maxHeight||others.filter(o=>o.location.surface===surface.id).length>=config.capacity)continue;
  const f=surface.footprint,area=config.area||f,pad=config.padding;
  for(let x=0;x<=5;x++)for(let y=0;y<=5;y++){
   const uv=[area.u+pad+(area.w-2*pad)*x/5,area.v+pad+(area.d-2*pad)*y/5];
   if(!footprint(uv,object).every(p=>p[0]>=area.u+.008&&p[0]<=area.u+area.w-.008&&p[1]>=area.v+.008&&p[1]<=area.v+area.d-.008))continue;
   const location={kind:surface.id==='desk'?'table':'surface',surface:surface.id,uv,height:config.height};if(fits(location))candidates.push({location});
  }
 }
 const choose=list=>{
  let best=null;
  const prepared=list.map(candidate=>{const targets=state.targets(id,{location:candidate.location}).filter(t=>walkable(t.position,obstacles));return {...candidate,targets,lower:Math.min(...targets.map(t=>distance(origin,project(t.position)))),proximity:distance(origin,project(candidate.location.uv))};}).filter(c=>c.targets.length).sort((a,b)=>a.lower-b.lower||a.proximity-b.proximity);
  for(const c of prepared){
   if(best&&c.lower>best.length+1e-6)break;
   const route=chooseRoute(state.hero.position,c.targets,state.obstacles);if(!route.ok)continue;
   const length=routeLength(route.route.points);if(!best||length<best.length-1e-6||Math.abs(length-best.length)<1e-6&&c.proximity<best.proximity)best={ok:true,location:c.location,target:route.target,route:route.route.points,length,proximity:c.proximity};
  }return best;
 };
 const surface=choose(candidates);if(surface)return surface;
 const floor=[];
 for(let radius=48;radius<=144;radius+=16)for(let i=0;i<20;i++){
  const angle=i*Math.PI/10,uv=unproject([origin[0]+Math.cos(angle)*radius,origin[1]+Math.sin(angle)*radius]);
  if(!footprint(uv,object).every(p=>walkable(p,state.obstacles,0)&&walkable(p,avoid,.02)))continue;
  if(distance(project(uv),origin)<object.floorFootprint.rx+12)continue;
  const location={kind:'floor',surface:'floor',uv,height:0};if(!fits(location))continue;
  const reserved=Object.values(state.objects).filter(o=>o.type==='furniture'&&o.location.kind==='absent').some(o=>footprint(uv,object).some(p=>!walkable(p,[o.footprint],.012)));
  floor.push({location,reserved});
 }
 // Prefer unreserved nearby floor, retaining a local fallback when those zones are full.
 return choose(floor.filter(c=>!c.reserved))||choose(floor)||placementError();
}
