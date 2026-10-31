import {distance,project} from './room-space.js';
export const NAV={min:.045,max:.965,step:.025,radius:.045};
const inside=(p,b,r)=>p[0]>=b.u-r&&p[0]<=b.u+b.w+r&&p[1]>=b.v-r&&p[1]<=b.v+b.d+r;
export function walkable(point,obstacles=[],radius=NAV.radius){return point.every(Number.isFinite)&&point.every(v=>v>=NAV.min&&v<=NAV.max)&&!obstacles.some(b=>inside(point,b,radius));}
export function clearSegment(a,b,obstacles=[],radius=NAV.radius){
  if(!walkable(a,obstacles,radius)||!walkable(b,obstacles,radius))return false;
  return !obstacles.some(rect=>{
    let lower=0,upper=1;
    for(let i=0;i<2;i++){const min=(i?rect.v:rect.u)-radius,max=min+(i?rect.d:rect.w)+2*radius,delta=b[i]-a[i];
      if(Math.abs(delta)<1e-10){if(a[i]<min||a[i]>max)return false;}
      else{let t=(min-a[i])/delta,s=(max-a[i])/delta;if(t>s)[t,s]=[s,t];lower=Math.max(lower,t);upper=Math.min(upper,s);if(lower>upper)return false;}
    }return true;
  });
}
export function planRoute(from,to,obstacles=[]){
  const fail={ok:false,points:[],reason:'unreachable',message:'К этой точке сейчас не пройти. Предмет и герой остались на своих местах.'};
  if(!walkable(from,obstacles)||!walkable(to,obstacles))return fail;
  if(clearSegment(from,to,obstacles))return {ok:true,points:distance(from,to)<1e-6?[[...from]]:[[...from],[...to]]};
  const count=Math.floor((NAV.max-NAV.min)/NAV.step)+1,grid=new Map();
  for(let x=0;x<count;x++)for(let y=0;y<count;y++){const point=[NAV.min+x*NAV.step,NAV.min+y*NAV.step];if(walkable(point,obstacles))grid.set(`${x},${y}`,{key:`${x},${y}`,x,y,point});}
  const connect=point=>[...grid.values()].filter(n=>distance(point,n.point)<.085&&clearSegment(point,n.point,obstacles)).sort((a,b)=>distance(point,a.point)-distance(point,b.point))[0];
  const start=connect(from),end=connect(to);if(!start||!end)return fail;
  const open=[start],cost=new Map([[start.key,0]]),previous=new Map(),closed=new Set();let found=false;
  while(open.length){
    open.sort((a,b)=>(cost.get(a.key)+distance(a.point,end.point))-(cost.get(b.key)+distance(b.point,end.point)));
    const node=open.shift();if(closed.has(node.key))continue;if(node.key===end.key){found=true;break;}closed.add(node.key);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){
      const next=grid.get(`${node.x+dx},${node.y+dy}`);if(!next||closed.has(next.key)||!clearSegment(node.point,next.point,obstacles))continue;
      const value=cost.get(node.key)+distance(node.point,next.point);if(value<(cost.get(next.key)??Infinity)){cost.set(next.key,value);previous.set(next.key,node.key);open.push(next);}
    }
  }
  if(!found)return fail;
  const raw=[end.point];let key=end.key;while(key!==start.key){key=previous.get(key);if(!key)return fail;raw.unshift(grid.get(key).point);}raw.unshift([...from]);raw.push([...to]);
  const points=[raw[0]];for(let i=0;i<raw.length-1;){let far=raw.length-1;while(far>i+1&&!clearSegment(raw[i],raw[far],obstacles))far--;points.push(raw[far]);i=far;}
  return {ok:true,points:points.filter((p,i,a)=>!i||distance(p,a[i-1])>1e-6)};
}
export function routeLength(points){return points.reduce((sum,p,i)=>sum+(i?distance(project(p),project(points[i-1])):0),0);}
export function sampleRoute(points,at){
  if(points.length===1)return [...points[0]];
  for(let i=1;i<points.length;i++){const length=distance(project(points[i-1]),project(points[i]));if(at<=length||i===points.length-1){const t=Math.max(0,Math.min(1,at/(length||1)));return points[i-1].map((v,k)=>v+(points[i][k]-v)*t);}at-=length;}
  return [...points.at(-1)];
}
export function travelProgress(t,r=.16){if(t<r)return t*t/(2*r*(1-r));if(t>1-r)return 1-(1-t)**2/(2*r*(1-r));return (t-r/2)/(1-r);}
