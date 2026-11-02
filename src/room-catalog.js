import {findPlacement,furnitureLocation} from './room-placement.js';
import {TABLE,GRIPS} from './room-space.js';
export const ROOM_ITEMS={desk:'Стол',book:'Книга',water:'Вода',chair:'Стул',bed:'Кровать',apple:'Яблоко',phone:'Телефон',milk:'Молоко',lamp:'Лампа',notebook:'Тетрадь',pen:'Ручка',computer:'Компьютер',television:'Телевизор'};
export const KOREAN={desk:'책상',book:'책',water:'물',chair:'의자',bed:'침대',apple:'사과',phone:'휴대폰',milk:'우유',lamp:'전등',notebook:'공책',pen:'펜',computer:'컴퓨터',television:'텔레비전'};
const lessonPortable=(grip,use,rx,ry,height)=>({...portable(grip,use,rx,ry,height),actions:['move_to','take','put']});
const portable=(grip,use,rx,ry,height)=>({type:'portable',actions:['move_to','take','put','use'],grip,use,floorFootprint:{rx,ry},visual:{w:rx*2,h:height}});
export const OBJECT_TYPES={
 desk:{type:'furniture',actions:['move_to'],footprint:TABLE,surface:{capacity:5,height:102,padding:.035,maxWidth:92,maxHeight:75}},
 book:portable(GRIPS.book,'read',44,12,50),water:portable(GRIPS.water,'drink',18,10,66),
 chair:{type:'furniture',actions:['move_to','sit'],footprint:{u:.38,v:.69,w:.13,d:.13,height:60},approach:[.59,.755]},
 bed:{type:'furniture',actions:['move_to','lie_down','sleep'],footprint:{u:.055,v:.045,w:.25,d:.46,height:55},approach:[.39,.32],surface:{capacity:2,height:61,padding:.035,maxWidth:92,maxHeight:75,area:{u:.055,v:.20,w:.25,d:.305}}},
 apple:portable([0,-15],'eat',18,10,37),phone:portable([0,-20],'screen',17,10,48),milk:portable([0,-25],'drink',19,11,67),
 notebook:lessonPortable([0,-8],'write',29,10,35),pen:lessonPortable([0,-15],'pen',8,5,35),computer:lessonPortable([0,-26],'computer',39,13,70),
 television:{type:'furniture',actions:['move_to'],footprint:{u:.64,v:.035,w:.19,d:.11,height:112},approach:[.75,.215]},
 lamp:{type:'furniture',actions:['move_to','toggle'],footprint:{u:.38,v:.055,w:.075,d:.075,height:140},approach:[.45,.19],grip:[0,-72]}
};
export const isFurniture=id=>OBJECT_TYPES[id]?.type==='furniture';
export const furnitureCenter=id=>{const f=OBJECT_TYPES[id].footprint;return [f.u+f.w/2,f.v+f.d/2];};
export function placementFor(state,id){return isFurniture(id)?furnitureLocation(state,id):(findPlacement(state,id).location||null);}
