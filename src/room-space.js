// Logical floor coordinates are independent of the SVG's orthographic projection.
export const TABLE={u:.55,v:.30,w:.35,d:.32,height:102,scale:1};
export const FLOOR_SLOTS={book:[.24,.84],water:[.20,.54]};
export const TABLE_SLOTS={book:[.61,.54],water:[.80,.53]};
export const START=[.22,.72],HERO_SCALE=.60,GRIPS={book:[0,-5],water:[0,-25]};
export function project([u,v],height=0){return [500+410*u-410*v,340+165*u+215*v-height];}
export function unproject([x,y]){const a=(x-500)/410,b=y-340;return [(b+215*a)/380,(b-165*a)/380];}
export function heroScale([u,v]){return HERO_SCALE*(.92+.16*Math.max(0,Math.min(1,(u+v)/2)));}
export const facingSign=facing=>facing==='left'?-1:1;
export function facingDirection([x,y],previous=null){
  if(Math.hypot(x,y)<1e-5)return previous||'right';
  const threshold=['front','back'].includes(previous)?.65:.85;
  return Math.abs(y)>Math.abs(x)*threshold?(y<0?'back':'front'):(x<0?'left':'right');
}
export function facingFor(a,b,previous=null){const p=project(a),q=project(b);return facingDirection([q[0]-p[0],q[1]-p[1]],previous);}
export function itemLocation(id,placement){const uv=(placement==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id];return {uv:[...uv],point:project(uv,placement==='table'?TABLE.height:0),placement};}
export function approach(id,placement){return placement==='table'?(id==='water'?[.81,.72]:[.60,.72]):(id==='book'?[.20,.94]:[.16,.64]);}
export const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function landingPoint(final,t){const e=t*t*(3-2*t),lift=45*(1-e);return [final[0],final[1]-lift-Math.sin(Math.max(0,t-.8)/.2*Math.PI)*2*(t>.8?1:0)];}
