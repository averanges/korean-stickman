import {POSES,mixPose,articulate,bodyFrame,ease,lerp} from './geometry.js';
import {TABLE,FLOOR_SLOTS,TABLE_SLOTS,START,HERO_SCALE,GRIPS,project,itemLocation,approach,routeTo} from './room-state.js';
import {roomArt,deskArt,itemArt} from './room-art.js';
const clone=pose=>mixPose(pose,pose,0);
const line=points=>points.map(p=>p.join(',')).join(' ');
export function floorPose(){
  return {...clone(POSES.stand),h:[406,482],n:[390,544],p:[366,610],lw:[326,604],rw:[430,609],lk:[332,635],rk:[421,625],angle:15};
}
export function wristWorld(position,pose){const p=articulate(pose),base=project(position);return [base[0]+(p.rw[0]-370)*HERO_SCALE,base[1]+(p.rw[1]-675)*HERO_SCALE];}
export function reachPose(position,point,base=POSES.stand){const origin=project(position);return {...clone(base),rw:[370+(point[0]-origin[0])/HERO_SCALE,675+(point[1]-origin[1])/HERO_SCALE]};}
export function gripWorld(id,placement){const {point}=itemLocation(id,placement);return point.map((value,i)=>value+GRIPS[id][i]);}
export class RoomRenderer{
  constructor(hero,{onPhase=()=>{}}={}){
    this.hero=hero;this.scene=document.querySelector('#home-scene');this.onPhase=onPhase;this.generation=0;this.visible=false;this.debug=false;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene.innerHTML=roomArt()+'<g id="home-objects"></g><g id="home-debug" pointer-events="none"></g>';
    this.layer=this.scene.querySelector('#home-objects');this.overlay=this.scene.querySelector('#home-debug');this.cancel({desk:null,book:null,water:null});
  }
  phase(value,message){this.scene.dataset.phase=value;this.onPhase(message);}
  cancel(items){this.generation++;this.items={...items};this.position=[...START];this.pose=clone(POSES.stand);this.effects={};this.held=null;this.using=false;this.question=false;this.phase('idle',Object.values(items).some(Boolean)?'Ты дома. Все предметы на своих местах.':'Пустая комната ждёт твоих слов.');this.draw();}
  setDebug(value){this.debug=value;this.draw();}
  tween(duration,update){const generation=this.generation;duration=this.reduced?Math.min(duration,180):duration;return new Promise(resolve=>{const start=performance.now();const tick=now=>{if(generation!==this.generation){resolve(false);return;}const t=Math.min(1,(now-start)/duration);update(t);this.draw();if(t<1)requestAnimationFrame(tick);else resolve(true);};requestAnimationFrame(tick);});}
  poseTo(target,duration=650){const from=clone(this.pose);return this.tween(duration,t=>{this.pose=mixPose(from,target,ease(t));});}
  async confused(){this.question=true;this.phase('missing','Не получилось. Проверь, есть ли нужный предмет.');const ok=await this.tween(800,()=>{});if(ok){this.question=false;this.phase('idle','Попробуй другую короткую фразу.');this.draw();}return ok;}
  async walkTo(target){
    this.phase('walk','Герой идёт к предмету.');const route=routeTo(this.position,target);
    for(let i=1;i<route.length;i++){
      const from=[...this.position],to=route[i],a=project(from),b=project(to),distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(!await this.tween(Math.max(180,distance/110*1000),t=>{
        this.position=from.map((v,k)=>lerp(v,to[k],ease(t)));const step=Math.sin(t*distance/23*Math.PI),p=clone(POSES.stand);
        p.lk[0]+=step*13;p.rk[0]-=step*13;p.la[1]-=Math.max(0,step)*10;p.lf[1]-=Math.max(0,step)*10;p.ra[1]-=Math.max(0,-step)*10;p.rf[1]-=Math.max(0,-step)*10;
        p.lw[0]+=step*18;p.rw[0]-=step*18;p.h[1]-=Math.abs(step)*2;this.pose=p;
      }))return false;
    }
    this.position=[...target];this.pose=clone(POSES.stand);this.phase('turn','Герой поворачивается к предмету.');
    // Face and shoulders settle toward the object before the hand moves.
    return this.tween(220,t=>{this.pose.angle=Math.sin(t*Math.PI)*-5;});
  }
  async run(plan){
    this.items={...plan.before};const id=plan.item;
    if(plan.action==='create'){
      this.phase('appear',id==='desk'?'Стол появляется на полу.':'Предмет опускается на своё место.');this.items={...plan.next};
      const location=id==='desk'?project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2]):itemLocation(id,plan.next[id]).point;
      const ok=await this.tween(650,t=>{const e=ease(t);this.effects[id]={opacity:e,scale:id==='desk'?.94+.06*e:1,point:[location[0],location[1]-(1-e)*45]};});
      if(!ok)return false;this.effects={};this.phase('idle','Предмет на месте. Что добавим дальше?');this.draw();return true;
    }
    if(plan.action==='remove'){
      this.phase('remove','Убираем предмет. Остальные остаются в комнате.');
      if(!await this.tween(400,t=>{this.effects[id]={opacity:1-ease(t),scale:1};}))return false;
      this.items[id]=null;delete this.effects[id];
      const falling=['book','water'].filter(small=>plan.before[small]==='table'&&plan.next[small]==='floor');
      if(falling.length&&!await this.tween(750,t=>{for(const small of falling){const a=itemLocation(small,'table').point,b=itemLocation(small,'floor').point;this.effects[small]={point:a.map((v,i)=>lerp(v,b[i],ease(t)))};}}))return false;
      this.items={...plan.next};this.effects={};this.phase('idle','Готово. Место свободно.');this.draw();return true;
    }
    const placement=plan.before[id],target=gripWorld(id,placement);
    if(!await this.walkTo(approach(id,placement)))return false;
    this.using=true;this.phase('reach','Рука тянется к предмету.');
    const neutral=clone(POSES.stand),base=placement==='floor'?floorPose():neutral,reach=reachPose(this.position,target,base);
    if(!await this.poseTo(reach,900))return false;
    this.held={id,angle:0,open:false};this.phase('grip','Предмет в руке.');this.draw();
    if(!await this.tween(180,()=>{}))return false;
    const origin=project(this.position),usePoint=id==='book'?[origin[0]+36,origin[1]-120]:[origin[0]+43,origin[1]-154];
    const use=reachPose(this.position,usePoint);use.angle=id==='book'?12:0;use.eye=id==='water'?.1:1;
    this.phase('lift','Герой поднимает предмет.');const from=clone(this.pose);
    if(!await this.tween(900,t=>{this.pose=mixPose(from,use,ease(t));this.held.angle=id==='water'?-65*ease(t):0;}))return false;
    this.held.open=id==='book';this.phase(id==='book'?'read':'drink',id==='book'?'책을 읽어요 — герой читает книгу.':'물을 마셔요 — герой пьёт воду.');
    if(!await this.tween(1700,t=>{this.pose=clone(use);this.pose.angle+=Math.sin(t*Math.PI*2)*2;}))return false;
    this.held.open=false;this.phase('return','Возвращаем предмет на прежнее место.');const returning=clone(this.pose),angle=this.held.angle;
    if(!await this.tween(950,t=>{this.pose=mixPose(returning,reach,ease(t));this.held.angle=angle*(1-ease(t));}))return false;
    this.held=null;this.draw();if(!await this.poseTo(neutral,750))return false;
    this.using=false;this.phase('idle','Предмет на своём месте. Герой готов к следующей фразе.');this.draw();return true;
  }
  draw(){
    if(!this.layer||!this.visible)return;const entries=[];
    const tableDepth=project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2])[1];
    if(this.items.desk){const e=this.effects.desk||{},center=project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2]);entries.push({id:'desk',depth:tableDepth,html:`<g opacity="${e.opacity??1}" transform="translate(${center.join(' ')}) scale(${e.scale??1}) translate(${-center[0]} ${-center[1]})">${deskArt()}</g>`});}
    for(const id of ['book','water'])if(this.items[id]&&this.held?.id!==id){const place=this.items[id],e=this.effects[id]||{},point=e.point||itemLocation(id,place).point;entries.push({id,depth:place==='table'?tableDepth+1:project(FLOOR_SLOTS[id])[1],html:`<g data-placement="${place}" transform="translate(${point.join(' ')})" opacity="${e.opacity??1}">${itemArt(id)}</g>`});}
    const p=project(this.position),wrist=wristWorld(this.position,this.pose);
    const carry=this.held?`<g data-held="${this.held.id}" transform="translate(${wrist.join(' ')}) rotate(${this.held.angle}) translate(${-GRIPS[this.held.id][0]} ${-GRIPS[this.held.id][1]})">${itemArt(this.held.id,{open:this.held.open})}</g>`:'';
    entries.push({id:'hero',depth:p[1],html:`<g transform="translate(${p.join(' ')}) scale(${HERO_SCALE}) translate(-370 -675)">${this.hero.roomMarkup(this.pose,{using:this.using,question:this.question})}</g>${carry}`});
    entries.sort((a,b)=>a.depth-b.depth);this.layer.innerHTML=entries.map(({id,depth,html})=>`<g data-room-object="${id}" data-depth="${depth.toFixed(1)}">${html}</g>`).join('');
    this.scene.setAttribute('aria-label',`Комната. ${['desk','book','water'].filter(id=>this.items[id]).map(id=>({desk:'Стол',book:'Книга',water:'Вода'})[id]).join(', ')||'Пока пусто'}. Герой из первого уровня.`);
    this.overlay.innerHTML=this.debug?this.debugArt(entries):'';
  }
  debugArt(entries){
    const quad=([u,v,w,d],height=0)=>line([[u,v],[u+w,v],[u+w,v+d],[u,v+d]].map(p=>project(p,height)));
    const point=(p,label,color='#c54d68')=>`<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${color}"/><text x="${p[0]+8}" y="${p[1]-8}">${label}</text>`;
    return `<g font-size="12" font-family="monospace" fill="#60416c" stroke-width="1.5"><polygon points="${quad([TABLE.u,TABLE.v,TABLE.w,TABLE.d])}" fill="#ec65872b" stroke="#c54d68" stroke-dasharray="6 4"/><polygon points="${quad([TABLE.u,TABLE.v,TABLE.w,TABLE.d],TABLE.height)}" fill="#7b6af020" stroke="#8070bb"/>
      <text x="590" y="365">desk · footprint / top</text>
      ${['book','water'].map(id=>['floor','table'].map(place=>{const loc=itemLocation(id,place);return `<ellipse cx="${loc.point[0]}" cy="${loc.point[1]}" rx="40" ry="14" fill="#68afcb20" stroke="#5091aa"/>${point(gripWorld(id,place),`${id} ${place}: grip`)}${point(project(approach(id,place)),`${id}: approach`,'#47946a')}`;}).join('')).join('')}
      <polyline points="${line([project([.1,.84]),project([.95,.84])])}" fill="none" stroke="#509b80" stroke-dasharray="4 4"/>
      ${entries.map((entry,i)=>`<text x="90" y="${628+i*17}">${i+1}. ${entry.id} · depth ${entry.depth.toFixed(1)}</text>`).join('')}
      ${entries.filter(entry=>entry.id!=='desk').map(entry=>{const at=entry.id==='hero'?project(this.position):itemLocation(entry.id,this.items[entry.id]).point;const [w,h]=entry.id==='hero'?[144,250]:entry.id==='book'?[90,50]:[38,70];return `<rect x="${at[0]-w/2}" y="${at[1]-h}" width="${w}" height="${h+6}" fill="none" stroke="#9878bb" stroke-dasharray="3 4"/>`;}).join('')}
      ${point(wristWorld(this.position,this.pose),'wrist','#eb792f')}</g>`;
  }
}
