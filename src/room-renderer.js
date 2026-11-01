import {ROOM_ITEMS,isFurniture,furnitureCenter} from './room-catalog.js';
import {furnitureArt} from './room-furniture.js';
import {restPose} from './room-postures.js';
import {POSES,mixPose,ease,lerp,flagAnchor} from './geometry.js';
import {TABLE,FLOOR_SLOTS,project,itemLocation,heroScale,facingSign,facingDirection,landingPoint} from './room-space.js';
import {routeLength,travelProgress,routeDirection,NAV} from './room-navigation.js';
import {clonePose,floorPose,wristWorld,reachPose,carryPose,useTarget,walkingBlend,poseInFacing,worldPoint} from './room-motion.js';
import {roomArt,deskArt,itemArt} from './room-art.js';
import {flag} from './assets.js';
import {surfaceFallPoint} from './room-surfaces.js';
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
  synchronize(){this.restingSupport=null;this.previewItems=null;this.previewLocations=null;this.effects={};this.pose=this.state?.held?carryPose():(this.state?restPose(this.state):clonePose(POSES.stand));this.poseFacing=this.state?.hero.facing||'right';this.carry={angle:0,open:0};this.turn=null;this.interactionSurface=this.state?.held?this.state.objects[this.state.held].returnTo?.surface:null;this.question=false;this.phase('idle','Герой готов к следующей фразе.');this.draw();}
  cancel(){this.generation++;this.route=[];this.navigation=null;this.heading=null;this.synchronize();this.phase('idle','Герой готов к следующей фразе.');}
  setPlacement(plan){this.placement=plan;this.navigation=null;this.draw();}
  setDebug(value){this.debug=value;this.draw();}
  tween(duration,update){const generation=this.generation;duration=this.reduced?Math.min(duration,180):duration;return new Promise(resolve=>{const start=performance.now();const tick=now=>{if(generation!==this.generation){resolve(false);return;}const t=Math.min(1,(now-start)/duration);update(t);this.draw();if(t<1)requestAnimationFrame(tick);else resolve(true);};requestAnimationFrame(tick);});}
  poseTo(target,duration=650){const from=clonePose(this.pose);return this.tween(duration,t=>{this.pose=mixPose(from,target,ease(t));});}
  async turnTo(facing){
    if(facing===this.facing)return true;const from=this.poseFacing||this.facing,source=clonePose(this.pose),target=this.state.held?carryPose():clonePose(POSES.stand),converted=poseInFacing(source,from,facing);
    for(const key of ['lk','la','lf','rk','ra','rf'])target[key]=[...converted[key]];
    const targetInFrom=poseInFacing(target,facing,from);this.phase('turn','Герой поворачивается к цели.');this.turn={from,to:facing,t:0};
    if(!await this.tween(220,t=>{this.turn.t=ease(t);this.pose=mixPose(source,targetInFrom,ease(t));this.poseFacing=from;}))return false;
    this.state.moveHero(this.position,facing);this.pose=target;this.poseFacing=facing;this.turn=null;this.draw();return true;
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
    this.route=context.route;
    const total=routeLength(this.route),duration=Math.max(220,total/105*1000);
    if(total>.1||!this.navigation)this.navigation={start:[...this.position],end:[...context.position],raw:context.rawRoute||this.route,optimized:context.optimizedRoute||this.route,points:this.route,candidates:context.candidates||[]};
    if(total>.1){
      this.interactionSurface=null;
      if(!await this.turnTo(facingDirection(routeDirection(this.route,0),this.facing)))return false;
      const initial=clonePose(this.pose),initialFacing=this.poseFacing;this.phase('walk','Герой идёт к цели по короткому безопасному пути.');
      if(!await this.tween(duration,t=>{
        const at=travelProgress(t)*total,elapsed=t*duration,direction=routeDirection(this.route,at),desired=facingDirection(direction,this.turn?.to||this.facing);this.heading=direction;
        if(this.turn?.walking){const p=Math.min(1,(elapsed-this.turn.started)/190);this.turn.t=ease(p);if(p>=1){this.state.moveHero(this.position,this.turn.to);this.turn=null;}}
        if(!this.turn&&desired!==this.facing)this.turn={from:this.facing,to:desired,t:0,started:elapsed,walking:true};
        const frame=walkingBlend(this.route,at,this.turn?.from||this.facing,this.turn?.to||this.facing,this.turn?.t||0,Boolean(this.state.held));
        this.state.moveHero(frame.position);this.poseFacing=frame.poseFacing;this.pose=at<10?mixPose(poseInFacing(initial,initialFacing,frame.poseFacing),frame.pose,ease(at/10)):frame.pose;this.contacts=frame.contacts;
      }))return false;
      if(this.turn){const start=this.turn.t,to=this.turn.to;if(!await this.tween(140,t=>{this.turn.t=lerp(start,1,ease(t));}))return false;this.pose=poseInFacing(this.pose,this.poseFacing,to);this.poseFacing=to;this.state.moveHero(this.position,to);this.turn=null;}
      this.state.moveHero(context.position);if(!await this.turnTo(context.facing)||!await this.settle())return false;
    }else if(!await this.turnTo(context.facing))return false;
    this.heading=null;this.phase('idle','Герой у цели.');this.draw();return true;
  }
  async run(plan){
    const id=plan.item;this.previewItems={...plan.before};this.previewLocations=plan.action==='create'?plan.locations:null;this.effects={};
    if(plan.action==='create'){
      this.previewItems={...plan.next};const loc=plan.locations?.[id];const final=isFurniture(id)?project(furnitureCenter(id)):(loc?project(loc.uv,loc.height):itemLocation(id,plan.next[id]).point);
      this.phase('appear','Предмет появляется в выбранном месте.');
      return this.tween(650,t=>{this.effects[id]={opacity:ease(t),scale:id==='desk'?.94+.06*ease(t):1,point:landingPoint(final,t)};});
    }
    this.phase('remove','Убираем предмет. Остальные остаются в комнате.');
    if(!await this.tween(400,t=>{this.effects[id]={opacity:1-ease(t)};}))return false;
    this.previewItems[id]=null;delete this.effects[id];
    const falling=plan.falls||[];
    if(falling.length&&!await this.tween(650,t=>{for(const fall of falling)this.effects[fall.id]={point:surfaceFallPoint(fall,t),depth:project(fall.to.uv)[1]};}))return false;
    this.previewItems={...plan.next};return true;
  }
  async perform(operation,context,{contact}){
    const {action,item:id}=operation;this.scene.dataset.operation=action;this.scene.dataset.item=id;
    if(action==='move_to')return this.moveTo(context);
    if(action==='receive'){
      this.carry={angle:0,open:0,opacity:0};contact();this.phase('receive','Новый предмет появляется в руке героя.');
      const from=clonePose(this.pose),target=carryPose();
      const done=await this.tween(550,t=>{this.pose=mixPose(from,target,ease(t));this.carry.opacity=ease(t);this.carry.sparkle=Math.sin(t*Math.PI);});
      if(!done)return false;this.carry={angle:0,open:0};this.draw();return true;
    }
    if(['sit','lie_down','sleep','stand_up'].includes(action)){
      if(action!=='stand_up'&&!await this.turnTo('right'))return false;
      const posture={sit:'sitting',lie_down:'lying',sleep:'sleeping',stand_up:'standing'}[action];
      this.phase(action,action==='stand_up'?'Герой встаёт рядом с мебелью.':'Герой устраивается удобнее.');
      this.restingSupport=action==='stand_up'?this.state.hero.support:id;
      if(!await this.poseTo(restPose(this.state,posture,action==='stand_up'?null:id),1100))return false;
      contact();this.restingSupport=null;this.poseFacing='right';this.phase('idle',posture==='sleeping'?'Тихий час. Zzz…':posture==='sitting'?'Герой сидит.':posture==='lying'?'Герой лежит.':'Герой встал.');this.draw();return true;
    }
    if(action==='toggle'){
      const pose=reachPose(this.position,context.grip,POSES.stand,this.facing);
      this.phase('switch','Герой нажимает выключатель.');if(!await this.poseTo(pose,650))return false;contact();this.draw();if(!await this.tween(180,()=>{}))return false;
      const done=await this.poseTo(POSES.stand,500);this.phase('idle','Свет переключён.');return done;
    }
    if(action==='take'||action==='put'){
      if(!await this.turnTo(context.facing))return false;
      this.interactionSurface=context.location.surface;
      const base=context.location.height<85?floorPose():POSES.stand,reach=reachPose(this.position,context.grip,base,this.facing);
      this.phase('reach',action==='take'?'Кисть приближается к предмету.':'Возвращаем предмет к его опоре.');
      if(!await this.poseTo(reach,800))return false;
      contact();this.carry={angle:0,open:0};this.phase('contact',action==='take'?'Контакт: предмет теперь в руке.':'Контакт: предмет снова на поверхности.');this.draw();
      if(!await this.tween(140,()=>{}))return false;
      if(!await this.poseTo(action==='take'?carryPose():POSES.stand,650))return false;
      if(action==='put')this.interactionSurface=null;
      this.phase('idle',action==='take'?'Предмет в руке. Его можно использовать или положить.':'Предмет на месте.');this.draw();return true;
    }
    if(action==='use')return this.useHeld(id);
    if(this.extensionHandlers.has(action))return this.extensionHandlers.get(action)(operation,context,{contact,state:this.state,renderer:this});
    throw Error('unsupported-operation');
  }
  async useHeld(id){
    if(!['left','right'].includes(this.facing)&&!await this.turnTo('right'))return false;
    const object=this.state.objects[id],kind=object.use,point=useTarget(id,this.position,this.facing),use=reachPose(this.position,point,POSES.stand,this.facing);
    use.angle=id==='book'?10:0;use.eye=kind==='drink'?.12:1;object.state.using=true;
    this.phase('lift','Герой поднимает удерживаемый предмет.');if(!await this.poseTo(use,700))return false;
    if(id==='book'){
      this.phase('open-book','Книга раскрывается.');if(!await this.tween(450,t=>{this.carry.open=ease(t);object.state.open=this.carry.open;}))return false;
      this.phase('read','책을 읽어요 — герой читает книгу.');if(!await this.tween(1500,t=>{this.pose=clonePose(use);this.pose.angle+=Math.sin(t*Math.PI*2)*1.5;}))return false;
      this.phase('close-book','Книга закрывается.');if(!await this.tween(450,t=>{this.carry.open=1-ease(t);object.state.open=this.carry.open;}))return false;
    }else if(kind==='screen'){
      this.phase('phone','Герой смотрит на экран.');this.carry.lit=true;
      if(!await this.tween(1600,t=>{this.pose=clonePose(use);this.pose.rw[1]+=Math.sin(t*Math.PI*6)*3;}))return false;
      this.carry.lit=false;
    }else if(kind==='eat'){
      this.phase('eat','Герой ест яблоко.');
      if(!await this.tween(1800,t=>{this.pose=clonePose(use);this.pose.h[1]+=Math.sin(t*Math.PI*6)*2;this.carry.remaining=1-Math.floor(t*3)/3;}))return false;
    }else{
      this.phase('tilt','Бутылка наклоняется к губам.');if(!await this.tween(450,t=>{this.carry.angle=-65*ease(t);}))return false;
      this.phase('drink',id==='milk'?'우유를 마셔요 — герой пьёт молоко.':'물을 마셔요 — несколько глотков воды.');if(!await this.tween(1500,t=>{this.pose=clonePose(use);this.pose.angle=Math.sin(t*Math.PI*6)*.8;this.carry.angle=-65-Math.sin(t*Math.PI*6)*1.5;}))return false;
      this.phase('lower','Герой опускает бутылку.');const angle=this.carry.angle;if(!await this.tween(450,t=>{this.carry.angle=angle*(1-ease(t));}))return false;
    }
    if(!await this.poseTo(carryPose(),650))return false;object.state={open:0,using:false};this.carry={angle:0,open:0,...(kind==='eat'?{remaining:0}:{})};this.phase('idle','Предмет остаётся в руке.');this.draw();return true;
  }
  heroFrame(facing,opacity=1,part='all'){
    const p=project(this.position),scale=heroScale(this.position),sign=facingSign(facing),held=this.state.held;
    const backBlend=this.turn?lerp(this.turn.from==='back'?1:0,this.turn.to==='back'?1:0,this.turn.t):(facing==='back'?1:0);
    if(!this.frameLayers.has(facing))this.frameLayers.set(facing,this.hero.roomLayers(poseInFacing(this.pose,this.poseFacing||this.facing,facing),{using:Boolean(held),question:this.question,facing,hideFlag:true,backBlend}));
    const layers=this.frameLayers.get(facing),markup=part==='all'?layers.body+layers.arm:layers[part];
    return `<g opacity="${opacity}"><g transform="translate(${p.join(' ')}) scale(${scale*sign} ${scale}) translate(-370 -675)">${markup}</g></g>`;
  }
  flagMarkup(){
    const code=this.hero.look.flag;if(!code)return '';
    const at=facing=>{const p=poseInFacing(this.pose,this.poseFacing||this.facing,facing),a=flagAnchor(p);return worldPoint(this.position,[a.x,a.y],facing);};
    let point=at(this.facing),sign=facingSign(this.facing);if(this.turn){const a=at(this.turn.from),b=at(this.turn.to);point=a.map((v,i)=>lerp(v,b[i],this.turn.t));sign=lerp(facingSign(this.turn.from),facingSign(this.turn.to),this.turn.t);}
    const scale=heroScale(this.position)*.69;return `<g data-slot="flag" data-flag="${code}" transform="translate(${point.join(' ')}) scale(${scale*sign} ${scale})">${flag(code)}</g>`;
  }
  heldMarkup(){
    const id=this.state.held;if(!id)return '';const wrist=wristWorld(this.position,this.pose,this.poseFacing||this.facing);let sign=facingSign(this.facing);
    if(this.turn)sign=lerp(facingSign(this.turn.from),facingSign(this.turn.to),this.turn.t);
    const grip=this.state.objects[id].grip;
    return `<g data-held="${id}" opacity="${this.carry.opacity??1}" transform="translate(${wrist.join(' ')}) scale(${sign} 1) rotate(${this.carry.angle}) translate(${-grip[0]} ${-grip[1]})">${itemArt(id,{open:this.carry.open,held:true,lit:this.carry.lit,remaining:this.carry.remaining??1})}${this.carry.sparkle?`<path d="M-28-48l-7-10M27-42l9-8M0-63v-9" fill="none" stroke="#efbd53" stroke-width="3" opacity="${this.carry.sparkle}"/>`:''}</g>`;
  }
  draw(){
    if(!this.layer||!this.visible||!this.state)return;const entries=[],items=this.previewItems||this.state.items;this.frameLayers=new Map();
    const tableDepth=project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2])[1];
    if(items.desk){const e=this.effects.desk||{},c=project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2]);entries.push({id:'desk',depth:tableDepth,html:`<g opacity="${e.opacity??1}" transform="translate(${c.join(' ')}) scale(${e.scale??1}) translate(${-c[0]} ${-c[1]})">${deskArt()}</g>`});}
    for(const id of Object.keys(ROOM_ITEMS).filter(id=>id!=='desk'))if(items[id]&&items[id]!=='hand'){
      const object=this.state.objects[id],e=this.effects[id]||{},placement=items[id],location=this.previewLocations?.[id]||object.location;
      if(isFurniture(id)){const depth=project(furnitureCenter(id))[1];entries.push({id,depth,html:`<g opacity="${e.opacity??1}">${furnitureArt(id,object.state)}</g>`});continue;}
      const point=e.point||project(location.uv,location.height);
      entries.push({id,depth:e.depth??(location.height>0?project(furnitureCenter(location.surface))[1]+1:project(location.uv)[1]),html:`<g data-placement="${placement}" transform="translate(${point.join(' ')})" opacity="${e.opacity??1}">${itemArt(id)}</g>`});
    }
    const support=this.restingSupport||this.state.hero.support,heroDepth=support?project(furnitureCenter(support))[1]+1:project(this.position)[1],activeSurface=this.state.objects[this.interactionSurface],surfaceDepth=activeSurface?.surface?project(furnitureCenter(activeSurface.id))[1]:tableDepth,overTable=Boolean(activeSurface?.surface&&items[activeSurface.id]&&heroDepth<surfaceDepth+1);
    const frames=part=>this.turn?this.heroFrame(this.turn.from,1-this.turn.t,part)+this.heroFrame(this.turn.to,this.turn.t,part):this.heroFrame(this.facing,1,part);
    entries.push({id:'hero',depth:heroDepth,html:frames(overTable?'body':'all')+this.flagMarkup()+(overTable?'':this.heldMarkup())});
    if(overTable)entries.push({id:'hero-arm',depth:surfaceDepth+2,html:frames('arm')+this.heldMarkup()});
    entries.sort((a,b)=>a.depth-b.depth);this.layer.innerHTML=entries.map(({id,depth,html})=>`<g data-room-object="${id}" data-depth="${depth.toFixed(1)}">${html}</g>`).join('');
    this.scene.dataset.position=this.position.map(v=>v.toFixed(3)).join(',');this.scene.dataset.facing=this.facing;this.scene.dataset.view=this.turn?.to||this.facing;this.scene.dataset.held=this.state.held||'';this.scene.dataset.posture=this.state.hero.posture;this.scene.dataset.heading=(this.heading||[0,0]).map(v=>v.toFixed(2)).join(',');
    if(this.navigation){this.scene.dataset.routeLength=routeLength(this.navigation.points).toFixed(1);this.scene.dataset.rawWaypoints=String(this.navigation.raw.length);}
    this.scene.setAttribute('aria-label',`Комната. ${Object.keys(ROOM_ITEMS).filter(id=>items[id]).map(id=>ROOM_ITEMS[id]).join(', ')||'Пока пусто'}. ${this.state.held?'Предмет в руке. ':''}Герой из первого уровня.`);
    this.overlay.innerHTML=this.debug?this.debugArt(entries):'';
  }
  debugArt(entries){
    const poly=b=>line([[b.u,b.v],[b.u+b.w,b.v],[b.u+b.w,b.v+b.d],[b.u,b.v+b.d]].map(p=>project(p)));
    const dot=(p,label,color='#c54d68')=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}"/><text x="${p[0]+7}" y="${p[1]-7}">${label}</text>`;
    const targets=Object.keys(this.state.objects).filter(id=>this.state.objects[id].type==='portable').map(id=>{const t=this.state.target(id,{returning:this.state.held===id});return t?dot(project(t.position),id+': approach','#4b9173')+dot(t.grip,id+': grip'):'';}).join('');
    const zones='';
    const bounds=entries.filter(e=>['hero','book','water'].includes(e.id)).map(e=>{const p=e.id==='hero'?project(this.position):this.state.point(e.id);if(!p)return '';const scale=e.id==='hero'?heroScale(this.position):1,w=e.id==='hero'?220*scale:e.id==='book'?90:38,h=e.id==='hero'?410*scale:e.id==='book'?50:70;return `<rect x="${p[0]-w/2}" y="${p[1]-h}" width="${w}" height="${h+6}" fill="none" stroke="#a490bc" stroke-dasharray="2 4"/>`;}).join('');
    const placement=this.placement,loc=placement?.location;
    const planned=loc?dot(project(loc.uv,loc.height),'put: '+loc.surface,'#1f8b88'):'';
    const zonesPlan=placement?.zone?`<polygon points="${poly(placement.zone)}" fill="#eab13e18" stroke="#d89629" stroke-width="3" stroke-dasharray="8 4"/>${(placement.blockers||[]).map(id=>{const p=this.state.point(id);return p?dot(p,'move: '+id,'#db713e'):'';}).join('')}`:'';
    const occupied=Object.values(this.state.objects).filter(o=>o.type==='portable'&&['floor','table','surface'].includes(o.location.kind)).map(o=>{const p=this.state.point(o.id);return `<rect x="${p[0]-o.visual.w/2}" y="${p[1]-o.visual.h}" width="${o.visual.w}" height="${o.visual.h+8}" fill="#b4719420" stroke="#b47194" stroke-dasharray="3 3"/>`;}).join('');
    const surfaces=Object.values(this.state.objects).filter(o=>o.surface&&this.state.items[o.id]).map(o=>`<polygon points="${line([[o.footprint.u,o.footprint.v],[o.footprint.u+o.footprint.w,o.footprint.v],[o.footprint.u+o.footprint.w,o.footprint.v+o.footprint.d],[o.footprint.u,o.footprint.v+o.footprint.d]].map(p=>project(p,o.surface.height)))}" fill="#4baf9510" stroke="#459c86" stroke-dasharray="3 3"/>`).join('');
    const wrist=wristWorld(this.position,this.pose,this.poseFacing||this.facing);
    const n=this.navigation,origin=project(this.position),heading=this.heading||[0,0],headingLength=Math.hypot(...heading)||1,arrow=[origin[0]+heading[0]/headingLength*32,origin[1]+heading[1]/headingLength*32];
    return `<g font-size="11" font-family="monospace" fill="#60416c" stroke-width="1.4">${this.state.obstacles.map(b=>`<polygon points="${poly(b)}" fill="#d97c9728" stroke="#c54d68" stroke-dasharray="6 4"/>`).join('')}
      ${this.state.obstacles.map(b=>`<polygon points="${poly({u:b.u-NAV.radius,v:b.v-NAV.radius,w:b.w+NAV.radius*2,d:b.d+NAV.radius*2})}" fill="none" stroke="#d48351" stroke-dasharray="3 3"/>`).join('')}
      <polygon points="${poly({u:NAV.min,v:NAV.min,w:NAV.max-NAV.min,d:NAV.max-NAV.min})}" fill="none" stroke="#b5b6b2" stroke-dasharray="2 5"/>
      <polygon points="${line([[TABLE.u,TABLE.v],[TABLE.u+TABLE.w,TABLE.v],[TABLE.u+TABLE.w,TABLE.v+TABLE.d],[TABLE.u,TABLE.v+TABLE.d]].map(p=>project(p,TABLE.height)))}" fill="none" stroke="#a490bc" stroke-dasharray="4 4"/>${zones}${bounds}${surfaces}${occupied}${zonesPlan}${planned}
      ${n?`<polyline data-nav="raw" points="${line(n.raw.map(p=>project(p)))}" fill="none" stroke="#9997a2" stroke-width="2" stroke-dasharray="3 4"/><polyline data-nav="optimized" points="${line(n.points.map(p=>project(p)))}" fill="none" stroke="#328767" stroke-width="3"/>${n.candidates.map(c=>`<circle cx="${project(c.position)[0]}" cy="${project(c.position)[1]}" r="2.6" fill="#aa9b86"/>`).join('')}${dot(project(n.start),'S','#4c86b6')}${dot(project(n.end),'E','#d08c32')}`:''}${targets}
      ${this.heading?`<path data-nav="heading" d="M${origin.join(' ')}L${arrow.join(' ')}" fill="none" stroke="#dc8b2e" stroke-width="4"/><circle cx="${arrow[0]}" cy="${arrow[1]}" r="4" fill="#dc8b2e"/>`:''}
      <text x="90" y="615">S start · E goal · gray A* / green safe path</text>
      ${entries.map((entry,i)=>`<text x="90" y="${635+i*16}">${i+1}. ${entry.id} · depth ${entry.depth.toFixed(1)}</text>`).join('')}
      <text x="420" y="695">hero (${this.position.map(v=>v.toFixed(3)).join(', ')}) ${this.facing}</text>
      <text x="420" y="712">${this.scene.dataset.operation||'idle'} ${this.scene.dataset.item||''} · held: ${this.state.held||'none'}</text>
      ${this.state.held?`<text x="420" y="729">hand (${wrist.map(v=>v.toFixed(1)).join(', ')}) · return: ${this.state.objects[this.state.held].returnTo.surface}</text>`:''}
      ${dot(wrist,'wrist','#e17937')}</g>`;
  }
}
