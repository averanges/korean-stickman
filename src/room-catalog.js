import {TABLE,GRIPS,project} from './room-space.js';
import {walkable,planRoute} from './room-navigation.js';
export const ROOM_ITEMS={desk:'Стол',book:'Книга',water:'Вода',chair:'Стул',bed:'Кровать',apple:'Яблоко',phone:'Телефон',milk:'Молоко',lamp:'Лампа'};
export const KOREAN={desk:'책상',book:'책',water:'물',chair:'의자',bed:'침대',apple:'사과',phone:'휴대폰',milk:'우유',lamp:'전등'};
const portable=(grip,use,rx,ry,height)=>({type:'portable',actions:['move_to','take','put','use'],grip,use,floorFootprint:{rx,ry},visual:{w:rx*2,h:height}});
export const OBJECT_TYPES={
 desk:{type:'furniture',actions:['move_to'],footprint:TABLE},
 book:portable(GRIPS.book,'read',44,12,50),water:portable(GRIPS.water,'drink',18,10,66),
 chair:{type:'furniture',actions:['move_to','sit'],footprint:{u:.38,v:.69,w:.13,d:.13,height:60},approach:[.59,.755]},
 bed:{type:'furniture',actions:['move_to','lie_down','sleep'],footprint:{u:.055,v:.045,w:.25,d:.46,height:55},approach:[.39,.32]},
 apple:portable([0,-15],'eat',18,10,37),phone:portable([0,-20],'screen',17,10,48),milk:portable([0,-25],'drink',19,11,67),
 lamp:{type:'furniture',actions:['move_to','toggle'],footprint:{u:.38,v:.055,w:.075,d:.075,height:140},approach:[.45,.19],grip:[0,-72]}
};
export const isFurniture=id=>OBJECT_TYPES[id]?.type==='furniture';
export const furnitureCenter=id=>{const f=OBJECT_TYPES[id].footprint;return [f.u+f.w/2,f.v+f.d/2];};
const clearRects=(a,b)=>Math.abs(a.x-b.x)>=(a.w+b.w)/2+5||a.y<b.y-b.h-5||a.y-a.h>b.y+5;
export function placementFor(state,id){
 const object=state.objects[id],f=object.footprint;
 if(f){
  const overlap=state.obstacles.some(b=>f.u<b.u+b.w+.025&&f.u+f.w+.025>b.u&&f.v<b.v+b.d+.025&&f.v+f.d+.025>b.v);
  const obstacles=[...state.obstacles,{id,...f}];
  const coversItem=Object.values(state.objects).some(o=>o.type==='portable'&&o.location.kind==='floor'&&!walkable(o.location.uv,[f],.02));
  if(overlap||coversItem||!walkable(state.hero.position,obstacles))return null;
  const approaches=Object.values(state.objects).filter(o=>o.type==='furniture'&&(o.location.kind!=='absent'||o.id===id)).map(o=>o.approach).filter(Boolean);
  if(approaches.some(p=>!planRoute(state.hero.position,p,obstacles).ok))return null;
  return {kind:'floor',surface:'floor',uv:[f.u,f.v],height:0};
 }
 // A held object's return position remains reserved until it is put down or consumed.
 const existing=Object.values(state.objects).map(o=>({...o,location:o.location.kind==='hand'?o.returnTo:o.location})).filter(o=>o.type==='portable'&&['floor','table'].includes(o.location?.kind));
 const fits=(uv,kind)=>{
  const point=project(uv,kind==='table'?TABLE.height:0),rect={x:point[0],y:point[1]+8,w:object.visual.w,h:object.visual.h+8};
  if(!existing.filter(o=>o.location.kind===kind).every(o=>{const p=project(o.location.uv,o.location.height);return clearRects(rect,{x:p[0],y:p[1]+8,w:o.visual.w,h:o.visual.h+8});}))return false;
  return kind==='table'||walkable(uv,state.obstacles,.025);
 };
 const preferred={book:[.61,.54],water:[.80,.53],apple:[.61,.34],phone:[.77,.35],milk:[.87,.39]};
 if(state.items.desk){const candidates=[preferred[id]];for(let u=.59;u<=.88;u+=.035)for(let v=.34;v<=.59;v+=.035)candidates.push([u,v]);
  for(const uv of candidates)if(fits(uv,'table'))return {kind:'table',surface:'desk',uv,height:TABLE.height};}
 const initial={book:[.24,.84],water:[.20,.54],apple:[.40,.87],phone:[.68,.84],milk:[.84,.78]};
 const candidates=[initial[id]];for(let u=.13;u<.94;u+=.09)for(let v=.15;v<.94;v+=.09)candidates.push([u,v]);
 for(const uv of candidates)if(fits(uv,'floor')&&planRoute(state.hero.position,uv,state.obstacles).ok)return {kind:'floor',surface:'floor',uv,height:0};
 return null;
}

