import {lessonSeat} from './room-lesson-art.js';
import {bodyFrame} from './geometry.js';
import {localPoint} from './room-motion.js';
import {OBJECT_TYPES,KOREAN} from './room-catalog.js';
import {findPlacement} from './room-placement.js';
import {project,unproject,distance,facingDirection} from './room-space.js';
import {chooseRoute,walkable,NAV} from './room-navigation.js';
export const LESSONS={
 study:{commands:['공부해요','공부를해요'],requires:['desk'],label:'공부해요 — занимаемся за столом.'},
 learn:{commands:['배워요','한국어를배워요'],requires:['desk'],label:'한국어를 배워요 — учим новое слово.'},
 homework:{commands:['숙제를해요','숙제해요'],requires:['desk','notebook','pen'],label:'숙제를 해요 — пишем в тетради.'},
 work:{commands:['일해요'],requires:['desk','computer'],label:'일해요 — работаем за компьютером.'},
 exercise:{commands:['운동해요'],requires:[],label:'운동해요 — делаем зарядку.'},
 meet:{commands:['친구를만나요'],requires:[],label:'친구를 만나요 — встречаем друга у окна.'},
 movie:{commands:['영화를봐요'],requires:['television'],label:'영화를 봐요 — смотрим фильм.'},
 shop:{commands:['옷을사요'],requires:['phone'],label:'옷을 사요 — покупаем одежду по телефону.'}
};
const failed=message=>({type:'error',message});
const stopped=result=>result?.cancelled||result?.type==='error';
const location=uv=>({kind:'floor',surface:'floor',height:0,uv});
function nearbyRoute(state,positions,facing){
 const targets=positions.filter(p=>walkable(p,state.obstacles)).map(position=>({position,facing,location:location(position)}));
 const result=chooseRoute(state.hero.position,targets,state.obstacles);return result.ok?{...result.target,route:result.route.points,rawRoute:result.route.rawPoints,optimizedRoute:result.route.optimizedPoints,candidates:result.candidates}:null;
}
export function lessonTarget(state,kind){
 if(kind==='exercise'){
  const points=[state.hero.position];for(let u=.15;u<.96;u+=.14)for(let v=.15;v<.96;v+=.14)points.push([u,v]);
  const clear=points.filter(uv=>{
   const p=project(uv);for(let i=0;i<12;i++){const q=unproject([p[0]+Math.cos(i*Math.PI/6)*43,p[1]+Math.sin(i*Math.PI/6)*22]);if(!walkable(q,state.obstacles,NAV.radius))return false;}
   return Object.values(state.objects).filter(o=>o.type==='portable'&&o.location.kind==='floor').every(o=>distance(p,project(o.location.uv))>o.floorFootprint.rx+42);
  });return nearbyRoute(state,clear,'front');
 }
 if(kind==='meet')return nearbyRoute(state,[[.08,.60],[.10,.65],[.12,.70],[.17,.65]],'back');
 if(kind==='movie')return state.prepare({action:'move_to',item:'television'});
 const f=OBJECT_TYPES.desk.footprint,pad=NAV.radius+.025,positions=[];
 // Seated scenes use a temporary stool on a reachable edge of the existing desk.
 for(const t of [.2,.4,.6,.8]){positions.push([f.u-pad,f.v+f.d*t],[f.u+f.w+pad,f.v+f.d*t],[f.u+f.w*t,f.v-pad],[f.u+f.w*t,f.v+f.d+pad]);}
 let targets=positions.filter(p=>walkable(p,state.obstacles)).map(position=>{
  const uv=[Math.min(f.u+f.w-.045,Math.max(f.u+.045,position[0])),Math.min(f.v+f.d-.045,Math.max(f.v+.045,position[1]))],point=project(uv,102),origin=project(position);
  return {position,point,uv,facing:point[0]<origin[0]?'left':'right',location:location(position)};
 });
 if(['work','homework'].includes(kind)){
  const id=kind==='work'?'computer':'notebook',point=state.point(id);
  targets=state.targets(id).map(t=>({...t,point})).filter(t=>{
   const pose=lessonSeat(t.position,t.facing),shoulder=bodyFrame(pose).shoulderRight,wrist=localPoint(t.position,[point[0]+(kind==='work'?9:0),point[1]-(kind==='work'?8:35)],t.facing);
   return distance(shoulder,wrist)<140;
  });
 }else targets=targets.filter(t=>Object.values(state.objects).filter(o=>o.type==='portable'&&o.location.surface==='desk').every(o=>{const q=state.point(o.id);return Math.abs(q[0]-t.point[0])>(o.visual.w+64)/2+5||Math.abs(q[1]-t.point[1])>o.visual.h+32;}));

 const result=chooseRoute(state.hero.position,targets,state.obstacles);return result.ok?{...result.target,route:result.route.points,rawRoute:result.route.rawPoints,optimizedRoute:result.route.optimizedPoints,candidates:result.candidates}:null;
}
async function stow(controller,epoch){
 const held=controller.state.held;if(!held)return {type:'success'};
 const placement=findPlacement(controller.state,held);return placement.ok?controller.putAt(held,placement,epoch):failed(placement.message);
}
async function onDesk(controller,id,epoch){
 const state=controller.state;if(state.objects[id].location.surface==='desk')return {type:'success'};
 const plan=findPlacement(state,id,{excludeSurfaces:Object.keys(state.objects).filter(key=>key!=='desk')});
 if(!plan.ok||plan.location.surface!=='desk')return failed('На столе нет доступного места. Освободи немного места для '+KOREAN[id]+'.');
 for(const op of [{action:'move_to',item:id},{action:'take',item:id}]){const result=await controller.operate(op,epoch);if(stopped(result))return result;}
 return controller.putAt(id,plan,epoch);
}
export async function runLesson(controller,kind,epoch){
 const definition=LESSONS[kind],{state,renderer}=controller;if(!definition)return failed('Неизвестное действие.');
 const missing=definition.requires.filter(id=>!state.items[id]);if(missing.length)return failed(missing.map(id=>KOREAN[id]).join('하고 ')+((KOREAN[missing.at(-1)].at(-1).charCodeAt(0)-0xac00)%28?'이':'가')+' 필요해요. Нужны: '+missing.map(id=>({desk:'стол',notebook:'тетрадь',pen:'ручка',computer:'компьютер',television:'телевизор',phone:'телефон'})[id]).join(', ')+'.');
 let result;
 if(state.hero.posture!=='standing'){result=await controller.operate({action:'stand_up',item:state.hero.support},epoch);if(stopped(result))return result;}
 result=await stow(controller,epoch);if(stopped(result))return result;
 if(['homework','work'].includes(kind)){result=await onDesk(controller,kind==='work'?'computer':'notebook',epoch);if(stopped(result))return result;}
 if(['shop','homework'].includes(kind)){
  const id=kind==='shop'?'phone':'pen';for(const op of [{action:'move_to',item:id},{action:'take',item:id}]){result=await controller.operate(op,epoch);if(stopped(result))return result;}
 }
 const target=kind==='shop'?null:lessonTarget(state,kind);if(kind!=='shop'&&(!target||target.ok===false)){
  if(state.held)await stow(controller,epoch);return failed('Нет свободного доступного места для действия. Освободи немного места в комнате.');
 }
 controller.status('lesson',kind,'running');
 try{
  if(kind==='meet'&&!await renderer.friendEnter())return {cancelled:true};
  if(target&&!await renderer.moveTo(target))return {cancelled:true};
  if(epoch!==controller.epoch)return {cancelled:true};
  if(!await renderer.lesson(kind,target))return {cancelled:true};
  if(epoch!==controller.epoch)return {cancelled:true};
  if(state.held){const id=state.held;result=await controller.operate({action:'move_to',item:id,returning:true},epoch);if(stopped(result))return result;result=await controller.operate({action:'put',item:id},epoch);if(stopped(result))return result;}
  state.save();controller.status('lesson',kind,'completed');return {type:'success',message:definition.label};
 }finally{if(epoch===controller.epoch)renderer.finishLesson?.();}
}
