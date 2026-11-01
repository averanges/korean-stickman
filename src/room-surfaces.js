import {project,unproject,distance} from './room-space.js';
import {walkable} from './room-navigation.js';
export const MAX_DROP_SHIFT=36;
const clone=value=>structuredClone(value);
const size=object=>object.floorFootprint||{rx:22,ry:12};
const sameSpace=(a,b)=>{
  const dx=a.point[0]-b.point[0],dy=a.point[1]-b.point[1];
  return (dx/(a.size.rx+b.size.rx+3))**2+(dy/(a.size.ry+b.size.ry+3))**2<1;
};
function freeSpot(object,source,occupied,obstacles){
  const origin=project(source.uv),footprint=size(object),offsets=[[0,0]];
  for(let radius=4;radius<=MAX_DROP_SHIFT;radius+=4)for(let n=0;n<16;n++){const angle=Math.PI/2+n*Math.PI/8;offsets.push([Math.cos(angle)*radius,Math.sin(angle)*radius]);}
  for(const offset of offsets){
    const point=origin.map((v,i)=>v+offset[i]),uv=distance(offset,[0,0])<1e-8?[...source.uv]:unproject(point),spot={point,size:footprint};
    if(!walkable(uv,obstacles,0)||occupied.some(other=>sameSpace(spot,other)))continue;
    // Keep the projected footprint on the floor and clear of any remaining furniture.
    if(!Array.from({length:16},(_,n)=>{const angle=n*Math.PI/8;return unproject([point[0]+Math.cos(angle)*footprint.rx,point[1]+Math.sin(angle)*footprint.ry]);}).every(p=>p.every(v=>v>=.005&&v<=.995)&&walkable(p,obstacles,0)))continue;
    return {kind:'floor',surface:'floor',uv,height:0};
  }return null;
}
// Releasing a support depends on location.surface, not on the desk or creation slots.
export function releaseSurface(objects,surfaceId,obstacles=[]){
  const remaining=obstacles.filter(o=>o.id!==surfaceId),locations={},returnLocations={},falls=[];
  const occupied=Object.values(objects).filter(o=>o.id!==surfaceId&&o.type==='portable'&&o.location.kind==='floor').map(o=>({point:project(o.location.uv),size:size(o)}));
  const released=Object.values(objects).filter(o=>o.id!==surfaceId&&o.location.kind!=='absent'&&o.location.kind!=='hand'&&o.location.surface===surfaceId);
  const held=Object.values(objects).filter(o=>o.location.kind==='hand'&&o.returnTo?.surface===surfaceId);
  for(const object of [...released,...held]){
    const inHand=object.location.kind==='hand',from=inHand?object.returnTo:object.location,to=freeSpot(object,from,occupied,remaining);
    if(!to)return {ok:false,reason:'no-floor-space',message:'Под поверхностью слишком тесно. Сначала освободи немного места.'};
    occupied.push({point:project(to.uv),size:size(object)});
    if(inHand)returnLocations[object.id]=to;
    else{locations[object.id]=to;falls.push({id:object.id,from:clone(from),to:clone(to),fromPoint:project(from.uv,from.height),toPoint:project(to.uv)});}
  }
  return {ok:true,locations,returnLocations,falls};
}
export function surfaceFallPoint(fall,t){
  if(t<=0)return [...fall.fromPoint];if(t>=1)return [...fall.toPoint];
  if(t<.8){const p=(t/.8)**2;return fall.fromPoint.map((v,i)=>v+(fall.toPoint[i]-v)*p);}
  const bounce=(t-.8)/.2;return [fall.toPoint[0],fall.toPoint[1]-Math.sin(bounce*Math.PI)*5*(1-bounce)];
}
