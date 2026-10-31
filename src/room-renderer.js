import {POSES,mixPose,ease,lerp} from './geometry.js';
import {TABLE,FLOOR_SLOTS,project,itemLocation,heroScale,facingSign,facingFor,landingPoint} from './room-space.js';
import {routeLength,travelProgress} from './room-navigation.js';
import {clonePose,floorPose,wristWorld,reachPose,carryPose,useTarget,walkingFrame} from './room-motion.js';
import {roomArt,deskArt,itemArt} from './room-art.js';
export {floorPose,wristWorld,reachPose,gripWorld} from './room-motion.js';
const line=points=>points.map(p=>p.join(',')).join(' ');
export class RoomRenderer{
  constructor(hero,{onPhase=()=>{}}={}){
    this.hero=hero;this.scene=document.querySelector('#home-scene');this.onPhase=onPhase;this.generation=0;this.visible=false;this.debug=false;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.extensionHandlers=new Map();
    this.scene.innerHTML=roomArt()+'<g id="home-objects"></g><g id="home-debug" pointer-events="none"></g>';
    this.layer=this.scene.querySelector('#home-objects');this.overlay=this.scene.querySelector('#home-debug');this.cancel();
  }
  connect(state){this.state=state;this.synchronize();}
  registerAnimation(action,handler){if(!['open','close'].includes(action)||typeof handler!=='function')throw Error('invalid-animation-extension');this.extensionHandlers.set(action,handler);}
  get position(){return this.state.hero.position;}
  get facing(){return this.state.hero.facing;}
  phase(value,message){this.scene.dataset.phase=value;this.onPhase(message);}
  synchronize(){this.previewItems=null;this.effects={};this.pose=this.state?.held?carryPose():clonePose(POSES.stand);this.carry={angle:0,open:0};this.turn=null;this.question=false;this.phase('idle','Герой готов к следующей фразе.');this.draw();}
  cancel(){this.generation++;this.route=[];this.synchronize();this.phase('idle','Герой готов к следующей фразе.');}
  setDebug(value){this.debug=value;this.draw();}
  tween(duration,update){const generation=this.generation;duration=this.reduced?Math.min(duration,180):duration;return new Promise(resolve=>{const start=performance.now();const tick=now=>{if(generation!==this.generation){resolve(false);return;}const t=Math.min(1,(now-start)/duration);update(t);this.draw();if(t<1)requestAnimationFrame(tick);else resolve(true);};requestAnimationFrame(tick);});}
  poseTo(target,duration=650){const from=clonePose(this.pose);return this.tween(duration,t=>{this.pose=mixPose(from,target,ease(t));});}
  async turnTo(facing){
    if(facing===this.facing)return true;const from=this.facing;this.phase('turn','Герой поворачивается к цели.');this.turn={from,to:facing,t:0};
    if(!await this.tween(220,t=>{this.turn.t=ease(t);}))return false;this.state.moveHero(this.position,facing);this.turn=null;this.draw();return true;
  }
  async settle(){
    const target=this.state.held?carryPose():clonePose(POSES.stand);
    for(const side of ['l','r']){const from=clonePose(this.pose);
      if(!await this.tween(170,t=>{
        const p=mixPose(from,target,ease(t));for(const key of side==='l'?['rk','ra','rf']:['lk','la','lf'])p[key]=[...from[key]];
        p[side+'a'][1]-=Math.sin(t*Math.PI)*6;p[side+'f'][1]-=Math.sin(t*Math.PI)*6;this.pose=p;
      }))return false;
    }this.pose=target;this.draw();return true;
  }
  async confused(){this.question=true;this.phase('missing','Не получилось. Проверь предмет и доступность места.');const ok=await this.tween(650,()=>{});if(ok){this.question=false;this.draw();}return ok;}
  async moveTo(context){
    this.route=context.route;let traveled=0;const total=routeLength(this.route),initial=clonePose(this.pose);
    for(let i=1;i<this.route.length;i++){
      const pair=[this.route[i-1],this.route[i]],length=routeLength(pair);if(length<.01)continue;
      if(!await this.turnTo(facingFor(...pair)))return false;this.phase('walk','Герой обходит препятствия и идёт к цели.');
      if(!await this.tween(Math.max(180,length/105*1000),t=>{
        const at=traveled+travelProgress(t)*length,frame=walkingFrame(this.route,at,this.facing);
        this.state.moveHero(frame.position);this.pose=at<10?mixPose(initial,frame.pose,ease(at/10)):frame.pose;
        if(this.state.held)this.pose.rw=[432,495];this.contacts=frame.contacts;
      }))return false;
      traveled+=length;this.state.moveHero(pair[1]);if(!await this.settle())return false;
    }
    this.state.moveHero(context.position);if(total<.01)this.pose=this.state.held?carryPose():clonePose(POSES.stand);
    if(!await this.turnTo(context.facing))return false;this.phase('idle','Герой у цели.');this.draw();return true;
  }
  async run(plan){
    const id=plan.item;this.previewItems={...plan.before};this.effects={};
    if(plan.action==='create'){
      this.previewItems={...plan.next};const final=id==='desk'?project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2]):itemLocation(id,plan.next[id]).point;
      this.phase('appear','Предмет появляется в выбранном месте.');
      return this.tween(650,t=>{this.effects[id]={opacity:ease(t),scale:id==='desk'?.94+.06*ease(t):1,point:landingPoint(final,t)};});
    }
    this.phase('remove','Убираем предмет. Остальные остаются в комнате.');
    if(!await this.tween(400,t=>{this.effects[id]={opacity:1-ease(t)};}))return false;
    this.previewItems[id]=null;delete this.effects[id];
    const falling=['book','water'].filter(small=>plan.before[small]==='table'&&plan.next[small]==='floor');
    if(falling.length&&!await this.tween(750,t=>{for(const small of falling){const a=itemLocation(small,'table').point,b=itemLocation(small,'floor').point;this.effects[small]={point:a.map((v,i)=>lerp(v,b[i],ease(t)))};}}))return false;
    this.previewItems={...plan.next};return true;
  }
  async perform(operation,context,{contact}){
    const {action,item:id}=operation;this.scene.dataset.operation=action;this.scene.dataset.item=id;
    if(action==='move_to')return this.moveTo(context);
    if(action==='take'||action==='put'){
      if(!await this.turnTo(context.facing))return false;
      const base=context.location.kind==='floor'?floorPose():POSES.stand,reach=reachPose(this.position,context.grip,base,this.facing);
      this.phase('reach',action==='take'?'Кисть приближается к предмету.':'Возвращаем предмет к его опоре.');
      if(!await this.poseTo(reach,800))return false;
      contact();this.carry={angle:0,open:0};this.phase('contact',action==='take'?'Контакт: предмет теперь в руке.':'Контакт: предмет снова на поверхности.');this.draw();
      if(!await this.tween(140,()=>{}))return false;
      if(!await this.poseTo(action==='take'?carryPose():POSES.stand,650))return false;
      this.phase('idle',action==='take'?'Предмет в руке. Его можно использовать или положить.':'Предмет на месте.');this.draw();return true;
    }
    if(action==='use')return this.useHeld(id);
    if(this.extensionHandlers.has(action))return this.extensionHandlers.get(action)(operation,context,{contact,state:this.state,renderer:this});
    throw Error('unsupported-operation');
  }
  async useHeld(id){
    if(!['left','right'].includes(this.facing)&&!await this.turnTo('right'))return false;
    const object=this.state.objects[id],point=useTarget(id,this.position,this.facing),use=reachPose(this.position,point,POSES.stand,this.facing);
    use.angle=id==='book'?10:0;use.eye=id==='water'?.12:1;object.state.using=true;
    this.phase('lift','Герой поднимает удерживаемый предмет.');if(!await this.poseTo(use,700))return false;
    if(id==='book'){
      this.phase('open-book','Книга раскрывается.');if(!await this.tween(450,t=>{this.carry.open=ease(t);object.state.open=this.carry.open;}))return false;
      this.phase('read','책을 읽어요 — герой читает книгу.');if(!await this.tween(1500,t=>{this.pose=clonePose(use);this.pose.angle+=Math.sin(t*Math.PI*2)*1.5;}))return false;
      this.phase('close-book','Книга закрывается.');if(!await this.tween(450,t=>{this.carry.open=1-ease(t);object.state.open=this.carry.open;}))return false;
    }else{
      this.phase('tilt','Бутылка наклоняется к губам.');if(!await this.tween(450,t=>{this.carry.angle=-65*ease(t);}))return false;
      this.phase('drink','물을 마셔요 — несколько глотков воды.');if(!await this.tween(1500,t=>{this.pose=clonePose(use);this.pose.angle=Math.sin(t*Math.PI*6)*.8;this.carry.angle=-65-Math.sin(t*Math.PI*6)*1.5;}))return false;
      this.phase('lower','Герой опускает бутылку.');const angle=this.carry.angle;if(!await this.tween(450,t=>{this.carry.angle=angle*(1-ease(t));}))return false;
    }
    if(!await this.poseTo(carryPose(),650))return false;object.state={open:0,using:false};this.carry={angle:0,open:0};this.phase('idle','Предмет остаётся в руке.');this.draw();return true;
  }
  heroFrame(facing,opacity=1){
    const p=project(this.position),scale=heroScale(this.position),sign=facingSign(facing),held=this.state.held;
    return `<g opacity="${opacity}"><g transform="translate(${p.join(' ')}) scale(${scale*sign} ${scale}) translate(-370 -675)">${this.hero.roomMarkup(this.pose,{using:Boolean(held),question:this.question,facing})}</g></g>`;
  }
  heldMarkup(){
    const id=this.state.held;if(!id)return '';let wrist=wristWorld(this.position,this.pose,this.facing),sign=facingSign(this.facing);
    if(this.turn){const a=wristWorld(this.position,this.pose,this.turn.from),b=wristWorld(this.position,this.pose,this.turn.to);wrist=a.map((v,i)=>lerp(v,b[i],this.turn.t));sign=lerp(facingSign(this.turn.from),facingSign(this.turn.to),this.turn.t);}
    const grip=this.state.objects[id].grip;
    return `<g data-held="${id}" transform="translate(${wrist.join(' ')}) scale(${sign} 1) rotate(${this.carry.angle}) translate(${-grip[0]} ${-grip[1]})">${itemArt(id,{open:this.carry.open,held:true})}</g>`;
  }
  draw(){
    if(!this.layer||!this.visible||!this.state)return;const entries=[],items=this.previewItems||this.state.items;
    const tableDepth=project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2])[1];
    if(items.desk){const e=this.effects.desk||{},c=project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2]);entries.push({id:'desk',depth:tableDepth,html:`<g opacity="${e.opacity??1}" transform="translate(${c.join(' ')}) scale(${e.scale??1}) translate(${-c[0]} ${-c[1]})">${deskArt()}</g>`});}
    for(const id of ['book','water'])if(items[id]&&items[id]!=='hand'){
      const placement=items[id],e=this.effects[id]||{},same=placement===this.state.items[id],location=this.state.objects[id].location,point=e.point||(same?this.state.point(id):itemLocation(id,placement).point);
      entries.push({id,depth:placement==='table'?tableDepth+1:project(same?location.uv:FLOOR_SLOTS[id])[1],html:`<g data-placement="${placement}" transform="translate(${point.join(' ')})" opacity="${e.opacity??1}">${itemArt(id)}</g>`});
    }
    entries.push({id:'hero',depth:project(this.position)[1],html:(this.turn?this.heroFrame(this.turn.from,1-this.turn.t)+this.heroFrame(this.turn.to,this.turn.t):this.heroFrame(this.facing))+this.heldMarkup()});
    entries.sort((a,b)=>a.depth-b.depth);this.layer.innerHTML=entries.map(({id,depth,html})=>`<g data-room-object="${id}" data-depth="${depth.toFixed(1)}">${html}</g>`).join('');
    this.scene.dataset.position=this.position.map(v=>v.toFixed(3)).join(',');this.scene.dataset.facing=this.facing;this.scene.dataset.held=this.state.held||'';
    this.scene.setAttribute('aria-label',`Комната. ${['desk','book','water'].filter(id=>items[id]).map(id=>({desk:'Стол',book:'Книга',water:'Вода'})[id]).join(', ')||'Пока пусто'}. ${this.state.held?'Предмет в руке. ':''}Герой из первого уровня.`);
    this.overlay.innerHTML=this.debug?this.debugArt(entries):'';
  }
  debugArt(entries){
    const poly=b=>line([[b.u,b.v],[b.u+b.w,b.v],[b.u+b.w,b.v+b.d],[b.u,b.v+b.d]].map(p=>project(p)));
    const dot=(p,label,color='#c54d68')=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}"/><text x="${p[0]+7}" y="${p[1]-7}">${label}</text>`;
    const targets=['book','water'].map(id=>{const t=this.state.target(id,{returning:this.state.held===id});return t?dot(project(t.position),id+': approach','#4b9173')+dot(t.grip,id+': grip'):'';}).join('');
    const zones=['book','water'].map(id=>['floor','table'].map(place=>{const p=itemLocation(id,place).point;return `<ellipse cx="${p[0]}" cy="${p[1]}" rx="${id==='book'?44:18}" ry="12" fill="#6ca7c215" stroke="#77a0b6" stroke-dasharray="3 3"/>`;}).join('')).join('');
    const bounds=entries.filter(e=>e.id!=='desk').map(e=>{const p=e.id==='hero'?project(this.position):this.state.point(e.id);if(!p)return '';const scale=e.id==='hero'?heroScale(this.position):1,w=e.id==='hero'?220*scale:e.id==='book'?90:38,h=e.id==='hero'?410*scale:e.id==='book'?50:70;return `<rect x="${p[0]-w/2}" y="${p[1]-h}" width="${w}" height="${h+6}" fill="none" stroke="#a490bc" stroke-dasharray="2 4"/>`;}).join('');
    const wrist=wristWorld(this.position,this.pose,this.facing);
    return `<g font-size="11" font-family="monospace" fill="#60416c" stroke-width="1.4">${this.state.obstacles.map(b=>`<polygon points="${poly(b)}" fill="#d97c9728" stroke="#c54d68" stroke-dasharray="6 4"/>`).join('')}
      <polygon points="${line([[TABLE.u,TABLE.v],[TABLE.u+TABLE.w,TABLE.v],[TABLE.u+TABLE.w,TABLE.v+TABLE.d],[TABLE.u,TABLE.v+TABLE.d]].map(p=>project(p,TABLE.height)))}" fill="none" stroke="#a490bc" stroke-dasharray="4 4"/>${zones}${bounds}
      ${this.route?.length?`<polyline points="${line(this.route.map(p=>project(p)))}" fill="none" stroke="#498d74" stroke-width="3"/>${this.route.map(p=>dot(project(p),'','#498d74')).join('')}`:''}${targets}
      ${entries.map((entry,i)=>`<text x="90" y="${635+i*16}">${i+1}. ${entry.id} · depth ${entry.depth.toFixed(1)}</text>`).join('')}
      <text x="420" y="695">hero (${this.position.map(v=>v.toFixed(3)).join(', ')}) ${this.facing}</text>
      <text x="420" y="712">${this.scene.dataset.operation||'idle'} ${this.scene.dataset.item||''} · held: ${this.state.held||'none'}</text>
      ${this.state.held?`<text x="420" y="729">hand (${wrist.map(v=>v.toFixed(1)).join(', ')}) · return: ${this.state.objects[this.state.held].returnTo.surface}</text>`:''}
      ${dot(wrist,'wrist','#e17937')}</g>`;
  }
}
