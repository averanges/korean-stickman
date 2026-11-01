import {distance,project} from './room-space.js';
export const NAV={min:.045,max:.965,step:.025,radius:.045};
const metric=(a,b)=>distance(project(a),project(b));
const inside=(p,b,r)=>p[0]>=b.u-r&&p[0]<=b.u+b.w+r&&p[1]>=b.v-r&&p[1]<=b.v+b.d+r;
export function walkable(point,obstacles=[],radius=NAV.radius){return point.every(Number.isFinite)&&point.every(v=>v>=NAV.min&&v<=NAV.max)&&!obstacles.some(b=>inside(point,b,radius));}
export function clearSegment(a,b,obstacles=[],radius=NAV.radius){
  if(!walkable(a,obstacles,radius)||!walkable(b,obstacles,radius))return false;
  return !obstacles.some(rect=>{let lower=0,upper=1;
    for(let i=0;i<2;i++){const min=(i?rect.v:rect.u)-radius,max=min+(i?rect.d:rect.w)+2*radius,delta=b[i]-a[i];
      if(Math.abs(delta)<1e-10){if(a[i]<min||a[i]>max)return false;}
      else{let t=(min-a[i])/delta,s=(max-a[i])/delta;if(t>s)[t,s]=[s,t];lower=Math.max(lower,t);upper=Math.min(upper,s);if(lower>upper)return false;}
    }return true;
  });
}
export function optimizeRoute(raw,obstacles=[]){
  // Shortest visibility chain on the A* vertices, using the same metric as animation.
  const costs=[0],parents=[-1],hops=[0];for(let i=1;i<raw.length;i++){costs[i]=Infinity;hops[i]=Infinity;for(let j=0;j<i;j++)if(clearSegment(raw[j],raw[i],obstacles)){const cost=costs[j]+metric(raw[j],raw[i]);if(cost<costs[i]-1e-6||(Math.abs(cost-costs[i])<1e-6&&hops[j]+1<hops[i])){costs[i]=cost;hops[i]=hops[j]+1;parents[i]=j;}}}
  const result=[];for(let i=raw.length-1;i>=0;i=parents[i]){result.unshift([...raw[i]]);if(i===0)break;}return result;
}
export function smoothRoute(points,obstacles=[]){
  if(points.length<3)return points.map(p=>[...p]);const result=[[...points[0]]];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],ab=distance(a,b),bc=distance(b,c);let curve=null;
    for(let radius=Math.min(.045,ab*.28,bc*.28);radius>.002;radius*=.5){
      const start=b.map((v,k)=>v+(a[k]-v)*radius/ab),end=b.map((v,k)=>v+(c[k]-v)*radius/bc);
      const samples=Array.from({length:9},(_,n)=>{const t=n/8;return b.map((v,k)=>(1-t)**2*start[k]+2*(1-t)*t*v+t*t*end[k]);});
      const chain=[result.at(-1),...samples,c];if(chain.every(p=>walkable(p,obstacles))&&chain.slice(1).every((p,n)=>clearSegment(chain[n],p,obstacles))){curve=samples;break;}
    }
    if(curve)result.push(...curve);else result.push([...b]);
  }result.push([...points.at(-1)]);return result.filter((p,i,a)=>!i||distance(p,a[i-1])>1e-8);
}
export function planRoute(from,to,obstacles=[]){
  const fail={ok:false,points:[],rawPoints:[],optimizedPoints:[],reason:'unreachable',message:'К этой точке сейчас не пройти. Предмет и герой остались на своих местах.'};
  if(!walkable(from,obstacles)||!walkable(to,obstacles))return fail;
  if(clearSegment(from,to,obstacles)){const points=distance(from,to)<1e-6?[[...from]]:[[...from],[...to]];return {ok:true,points,rawPoints:points.map(p=>[...p]),optimizedPoints:points.map(p=>[...p])};}
  const axis=[];for(let value=NAV.min;value<NAV.max-1e-6;value+=NAV.step)axis.push(value);axis.push(NAV.max);
  const grid=new Map();for(let x=0;x<axis.length;x++)for(let y=0;y<axis.length;y++){const point=[axis[x],axis[y]];if(walkable(point,obstacles))grid.set(`${x},${y}`,{key:`${x},${y}`,x,y,point});}
  const connect=point=>[...grid.values()].filter(n=>distance(point,n.point)<.085&&clearSegment(point,n.point,obstacles)).sort((a,b)=>metric(point,a.point)-metric(point,b.point)).slice(0,8);
  const starts=connect(from),ends=new Map(connect(to).map(n=>[n.key,metric(n.point,to)]));if(!starts.length||!ends.size)return fail;
  const goal={key:'goal',point:[...to]},open=[...starts],cost=new Map(starts.map(n=>[n.key,metric(from,n.point)])),previous=new Map(starts.map(n=>[n.key,'start'])),closed=new Set();let found=false;
  while(open.length){
    open.sort((a,b)=>(cost.get(a.key)+metric(a.point,to))-(cost.get(b.key)+metric(b.point,to)));const node=open.shift();if(closed.has(node.key))continue;if(node.key==='goal'){found=true;break;}closed.add(node.key);
    const nextNodes=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){const n=grid.get(`${node.x+dx},${node.y+dy}`);if(n&&!closed.has(n.key)&&clearSegment(node.point,n.point,obstacles))nextNodes.push(n);}
    if(ends.has(node.key))nextNodes.push(goal);
    for(const next of nextNodes){const value=cost.get(node.key)+metric(node.point,next.point);if(value<(cost.get(next.key)??Infinity)){cost.set(next.key,value);previous.set(next.key,node.key);open.push(next);}}
  }
  if(!found)return fail;
  const rawPoints=[[...to]];let key=previous.get('goal');while(key&&key!=='start'){rawPoints.unshift([...grid.get(key).point]);key=previous.get(key);}rawPoints.unshift([...from]);
  const raw=rawPoints.filter((p,i,a)=>!i||distance(p,a[i-1])>1e-8),optimizedPoints=optimizeRoute(raw,obstacles),points=smoothRoute(optimizedPoints,obstacles);
  return {ok:true,rawPoints:raw,optimizedPoints,points};
}
export function chooseRoute(from,candidates,obstacles=[]){
  let best=null;
  for(const {target,lower} of candidates.map(target=>({target,lower:metric(from,target.position)})).sort((a,b)=>a.lower-b.lower)){
    // A collision-free route cannot be shorter than its straight-line lower bound.
    if(best&&lower>best.length+1e-6)continue;
    const route=planRoute(from,target.position,obstacles);if(route.ok){const length=routeLength(route.points);if(!best||length<best.length)best={target,route,length};}
  }
  return best?{ok:true,...best,candidates:candidates.map(c=>({position:[...c.position],facing:c.facing}))}:{ok:false,message:'К подходящей точке взаимодействия сейчас не пройти.',reason:'unreachable',points:[]};
}
export function routeLength(points){return points.reduce((sum,p,i)=>sum+(i?metric(p,points[i-1]):0),0);}
export function sampleRoute(points,at){
  if(points.length===1)return [...points[0]];
  for(let i=1;i<points.length;i++){const length=metric(points[i-1],points[i]);if(at<=length||i===points.length-1){const t=Math.max(0,Math.min(1,at/(length||1)));return points[i-1].map((v,k)=>v+(points[i][k]-v)*t);}at-=length;}return [...points.at(-1)];
}
export function routeDirection(points,at,look=7){const a=project(sampleRoute(points,Math.max(0,at-look))),b=project(sampleRoute(points,at+look));return [b[0]-a[0],b[1]-a[1]];}
export function travelProgress(t,r=.16){if(t<r)return t*t/(2*r*(1-r));if(t>1-r)return 1-(1-t)**2/(2*r*(1-r));return (t-r/2)/(1-r);}
