import {findPlacement,furnitureBlockers,furnitureLocation,placementError} from './room-placement.js';
import {TABLE,FLOOR_SLOTS,TABLE_SLOTS,START,GRIPS,project,approach,distance,facingFor} from './room-space.js';
import {planRoute,walkable,chooseRoute,NAV} from './room-navigation.js';
import {reachableGrip,gripExtension} from './room-motion.js';
import {releaseSurface} from './room-surfaces.js';
import {LESSONS,runLesson} from './room-lessons.js';
export * from './room-space.js';
export const ROOM_STORAGE_KEY='korean-stickman.room.v1';
import {ROOM_ITEMS,KOREAN,OBJECT_TYPES,placementFor,isFurniture,furnitureCenter} from './room-catalog.js';
export {ROOM_ITEMS,OBJECT_TYPES};
export const OPERATIONS=['move_to','take','put','use','open','close','sit','lie_down','sleep','stand_up','toggle','receive'];
const copy=value=>structuredClone(value);
const fail=(message,reason='impossible')=>({ok:false,message,reason});
const missing=id=>`${ROOM_ITEMS[id]}: пока нет в комнате. Сначала скажи «${KOREAN[id]} 있어요».`;
export function routeTo(from,to){return planRoute(from,to,[TABLE]).points;}
export function parseRoom(raw,{debug=false}={}){
  const heard=String(raw||'').normalize('NFKC').trim(),text=heard.replace(/[\s.!?。！？,，]/gu,'').replace(/^안녕하세요/u,'');
  const rejected={ok:false,heard,commands:[],reason:'unknown-room-intent',message:'Попробуй короткую фразу: 책이 있어요, 책을 읽어요 или 물을 마셔요.'};
  const names=Object.fromEntries(Object.entries(KOREAN).map(([id,name])=>[name,id]));
  const result=(action,item,extra={})=>({ok:true,heard,commands:[{action,item,...extra}],reason:action});
  if(debug){const m=heard.match(/^\/(move_to|take|put|use|open|close|sit|lie_down|sleep|stand_up|toggle)\s+(\w+)$/u);if(m&&ROOM_ITEMS[m[2]])return {...result(m[1],m[2]),mode:'step'};}
  if(/[?？]/u.test(heard))return rejected;
  if(/^(책하고물|책과물|책이랑물)(이|가)?(있어요|있습니다)$/u.test(text))return {ok:true,heard,commands:[{action:'create',item:'book'},{action:'create',item:'water'}],reason:'two-items'};
  const m=text.match(/^(책상|책|물|의자|침대|사과|휴대폰|우유|전등|공책|펜|컴퓨터|텔레비전)(?:이|가)?(있어요|없어요|있습니다|없습니다)$/u);
  if(m)return result(m[2].startsWith('있')?'create':'remove',names[m[1]]);
  for(const [id,lesson] of Object.entries(LESSONS))if(lesson.commands.includes(text))return result('lesson',id);
  if(text==='자요')return result('sleep','bed');
  if(/^(일어나요|일어납니다)$/u.test(text))return result('stand_up',null);
  for(const [name,id] of Object.entries(names)){
    const tail=text.startsWith(name)?text.slice(name.length).replace(/^(에서|에|을|를)/u,''):null;if(tail===null)continue;
    const verbs={book:/^(읽어요|읽습니다)$/u,water:/^(마셔요|마십니다)$/u,milk:/^(마셔요|마십니다)$/u,apple:/^(먹어요|먹습니다)$/u,phone:/^(봐요|봅니다|사용해요|사용합니다)$/u};
    if(verbs[id]?.test(tail))return result('use',id);
    if(id==='chair'&&/^(앉아요|앉습니다)$/u.test(tail))return result('sit',id);
    if(id==='bed'&&/^(누워요|눕습니다|자요|잡니다)$/u.test(tail))return result(/^(자요|잡니다)$/u.test(tail)?'sleep':'lie_down',id);
    if(id==='lamp'&&/^(켜요|켭니다|꺼요|끕니다)$/u.test(tail))return result('toggle',id,{value:/^(켜요|켭니다)$/u.test(tail)});
    if(OBJECT_TYPES[id].type==='portable'&&/^(집어요|집습니다|놓아요|놓습니다)$/u.test(tail))return result(tail.startsWith('집')?'take':'put',id);
  }
  return rejected;
}
function locationFor(id,kind){
  if(kind==='absent'||!kind)return {kind:'absent',surface:null,uv:null,height:0};
  if(kind==='hand')return {kind,surface:'hero',uv:null,height:0};
  return {kind,surface:kind==='table'?'desk':'floor',uv:copy(isFurniture(id)?[OBJECT_TYPES[id].footprint.u,OBJECT_TYPES[id].footprint.v]:((kind==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id]||[.5,.8])),height:kind==='table'?TABLE.height:0};
}
function restoredLocation(id,data){const result=locationFor(id,data?.kind);if(data?.kind==='surface'){const support=OBJECT_TYPES[data.surface]?.surface;result.kind=support?(data.surface==='desk'?'table':'surface'):'floor';result.surface=support?data.surface:'floor';result.height=support?.height||0;}if(!isFurniture(id)&&['floor','table','surface'].includes(result.kind)&&Array.isArray(data.uv)&&data.uv.length===2&&data.uv.every(v=>Number.isFinite(v)&&v>=0&&v<=1))result.uv=[...data.uv];return result;}
export class RoomState{
  constructor(storage){
    if(arguments.length===0){try{storage=globalThis.localStorage;}catch{}}
    this.storage=storage;this.storageAvailable=Boolean(storage);this.initialize();
    try{let saved=JSON.parse(storage?.getItem(ROOM_STORAGE_KEY)||'null');
      if(saved?.transaction?.kind==='furniture'&&saved.transaction.snapshot)saved={version:4,...saved.transaction.snapshot};
      if(saved?.version===1)for(const id of Object.keys(ROOM_ITEMS)){const k=saved.items?.[id];this.objects[id].location=locationFor(id,(isFurniture(id)?k==='floor':['floor','table'].includes(k))?k:'absent');}
      if([2,3,4].includes(saved?.version)){let occupied=false;
        for(const id of Object.keys(ROOM_ITEMS)){const data=saved.objects?.[id],k=data?.location?.kind,valid=isFurniture(id)?k==='floor':['floor','table','surface','hand'].includes(k);
          this.objects[id].location=valid&&!(k==='hand'&&occupied)?restoredLocation(id,data.location):locationFor(id,'absent');
          if(id==='lamp')this.objects[id].state.on=data?.state?.on===true;
          if(k==='hand'&&valid&&!occupied){occupied=true;this.objects[id].returnTo=restoredLocation(id,['floor','table','surface'].includes(data.returnTo?.kind)?data.returnTo:{kind:'floor'});}
        }
        const p=saved.hero?.position;if(Array.isArray(p)&&p.length===2&&walkable(p,this.obstacles))this.hero.position=[...p];
        if(['front','back','left','right'].includes(saved.hero?.facing))this.hero.facing=saved.hero.facing;
        const posture=saved.hero?.posture,support=saved.hero?.support;if(['sitting','lying','sleeping'].includes(posture)&&this.items[support]&&((posture==='sitting'&&support==='chair')||(posture!=='sitting'&&support==='bed'))){this.hero.posture=posture;this.hero.support=support;this.hero.position=[...this.objects[support].approach];this.hero.facing='right';}
      }this.repairSupports();
    }catch{this.storageAvailable=false;}
  }
  initialize(){this.transaction=null;this.hero={position:[...START],facing:'right',posture:'standing',support:null};this.objects=Object.fromEntries(Object.entries(OBJECT_TYPES).map(([id,definition])=>[id,{id,...copy(definition),location:locationFor(id,'absent'),returnTo:null,state:{open:0,using:false,on:false}}]));}
  get items(){return Object.fromEntries(Object.entries(this.objects).map(([id,o])=>[id,o.location.kind==='absent'?null:o.location.kind]));}
  get held(){return Object.values(this.objects).find(o=>o.location.kind==='hand')?.id||null;}
  get obstacles(){return Object.values(this.objects).filter(o=>o.type==='furniture'&&o.location.kind==='floor').map(o=>({id:o.id,...o.footprint}));}
  save(){try{this.storage?.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:4,hero:this.hero,objects:this.objects,transaction:this.transaction}));this.storageAvailable=Boolean(this.storage);}catch{this.storageAvailable=false;}}
  snapshot(){return copy({hero:this.hero,objects:this.objects});}
  fork(){const state=Object.create(RoomState.prototype);Object.assign(state,this.snapshot(),{storage:null,transaction:null});return state;}
  rollback(){if(!this.transaction)return;const snapshot=this.transaction.snapshot;this.transaction=null;this.hero=copy(snapshot.hero);this.objects=copy(snapshot.objects);this.save();}
  reset(){this.initialize();this.save();}
  repairSupports(){
    const missing=new Set();for(const object of Object.values(this.objects))for(const loc of [object.location,object.returnTo])if(loc?.surface&&!['floor','hero'].includes(loc.surface)&&(!this.objects[loc.surface]||this.objects[loc.surface].location.kind==='absent'))missing.add(loc.surface);
    for(const id of missing){const release=releaseSurface(this.objects,id,this.obstacles);if(release.ok)this.applyLocations(release);}
  }
  applyLocations({locations={},returnLocations={}}){for(const [id,loc] of Object.entries(locations))this.objects[id].location=copy(loc);for(const [id,loc] of Object.entries(returnLocations))this.objects[id].returnTo=copy(loc);}
  moveHero(position,facing=this.hero.facing){this.hero.position=[...position];this.hero.facing=facing;}
  point(id,{returning=false,location}={}){const o=this.objects[id],loc=location||(returning?o.returnTo:o.location);return loc&&['floor','table','surface'].includes(loc.kind)?project(loc.uv,loc.height):null;}
  contextAt(id,position,{returning=false,location}={}){
    const o=this.objects[id],loc=location||(returning?o.returnTo:o.location);if(!loc||!['floor','table','surface'].includes(loc.kind))return null;
    const point=isFurniture(id)?project(furnitureCenter(id),o.footprint.height):project(loc.uv,loc.height);
    return {position:[...position],point,grip:isFurniture(id)?(id==='lamp'?project(furnitureCenter(id),72):null):point.map((v,i)=>v+o.grip[i]),facing:isFurniture(id)?(id==='lamp'&&point[0]<project(position)[0]?'left':'right'):point[0]<project(position)[0]?'left':'right',location:copy(loc)};
  }
  canInteract(id,context){
    if(!context||!walkable(context.position,this.obstacles))return false;
    if(isFurniture(id))return false;
    if(distance(context.position,context.location.uv)>(context.location.height>0?.24:.18))return false;
    if(context.location.kind==='floor'&&(!walkable(context.location.uv,this.obstacles,0)||distance(project(context.position),project(context.location.uv))<(id==='book'?45:27)))return false;
    return reachableGrip(context.position,context);
  }
  targets(id,options={}){
    const o=this.objects[id],loc=options.location||(options.returning?o.returnTo:o.location);if(!loc||!['floor','table','surface'].includes(loc.kind))return [];
    if(isFurniture(id)&&id!=='desk'){const position=o.approach;return walkable(position,this.obstacles)?[this.contextAt(id,position,options)]:[];}
    const positions=[],slot=(loc.kind==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id]||loc.uv;
    if(id==='desk'||loc.height>0){
      const support=this.objects[loc.surface]?.footprint||TABLE,pad=NAV.radius+.012;
      for(const t of [0,.15,.3,.45,.6,.75,.9,1]){
        const u=support.u+support.w*t,v=support.v+support.d*t;
        positions.push([support.u-pad,v],[support.u+support.w+pad,v],[u,support.v-pad],[u,support.v+support.d+pad]);
      }
    }else for(const radius of [.12,.16])for(let n=0;n<24;n++)positions.push([loc.uv[0]+Math.cos(n*Math.PI/12)*radius,loc.uv[1]+Math.sin(n*Math.PI/12)*radius]);
    // Keep old calibrated points valid for saves and ongoing step-by-step sequences.
    positions.push(id==='desk'?approach('book','table'):approach(id,loc.kind).map((v,i)=>v+(loc.uv[i]-slot[i])));
    const current=this.contextAt(id,this.hero.position,options);
    if(id==='desk'?positions.some(p=>distance(p,this.hero.position)<.025):this.canInteract(id,current))positions.unshift([...this.hero.position]);
    let targets=positions.filter((p,i,a)=>walkable(p,this.obstacles)&&a.findIndex(q=>distance(p,q)<.001)===i).map(p=>this.contextAt(id,p,options)).filter(c=>id==='desk'||(this.canInteract(id,c)&&(distance(c.position,this.hero.position)<.001||gripExtension(c.position,c)>=35)));
    if(id==='desk'){
      const onTop=Object.keys(this.objects).filter(child=>this.items[child]==='table'),comfortable=targets.filter(t=>onTop.some(child=>{const context=this.contextAt(child,t.position);return this.canInteract(child,context)&&gripExtension(t.position,context)>=35;}));
      if(comfortable.length)targets=comfortable;
    }return targets;
  }
  target(id,options={}){
    return this.targets(id,options).sort((a,b)=>distance(project(this.hero.position),project(a.position))-distance(project(this.hero.position),project(b.position)))[0]||null;
  }
  describe(id){const o=this.objects[id];return {...copy(o),held:o.location.kind==='hand',interaction:this.target(id,{returning:o.location.kind==='hand'})};}
  plan(command){
    const next={...this.items},id=command.item,name=ROOM_ITEMS[id];if(!name||!['create','remove','use'].includes(command.action)||(command.action==='use'&&isFurniture(id)))return fail('Не удалось понять команду.');
    let release={locations:{},returnLocations:{},falls:[]};
    if(command.action==='create'){
      if(next[id])return fail(`${name} уже есть в комнате.`,'duplicate');const location=placementFor(this,id);if(!location)return fail('Для предмета нет свободного доступного места. Освободи немного места.','occupied');next[id]=location.kind;release.locations[id]=location;
      if(id==='desk'&&!walkable(this.hero.position,[...this.obstacles,TABLE]))return fail('Герой стоит на месте будущего стола. Сначала отойди к другому предмету.','occupied');
    }else if(!next[id])return fail(missing(id),'missing');
    else if(command.action==='use'&&this.held&&this.held!==id)return fail('Рука занята. Сначала положи удерживаемый предмет.','held');
    else if(command.action==='remove'){
      if(next[id]==='hand')return fail('Сначала положи предмет из руки.','held');
      release=releaseSurface(this.objects,id,this.obstacles);if(!release.ok)return release;
      next[id]=null;for(const child of Object.keys(release.locations))next[child]='floor';
    }
    const created={desk:'Стол появился.',book:'Книга появилась.',water:'Вода появилась.'},removed={desk:'Стол убран.',book:'Книга убрана.',water:'Вода убрана.'};
    return {ok:true,...command,blockers:command.action==='create'&&isFurniture(id)?furnitureBlockers(this,this.objects[id]):[],before:{...this.items},next,...release,message:command.action==='use'?({book:'Герой прочитал книгу.',water:'Герой попил воды.',milk:'Герой выпил молоко.',phone:'Герой посмотрел телефон.',apple:'Герой съел яблоко.'}[id]):command.action==='create'?(created[id]||`${name}: появился в комнате.`):(removed[id]||`${name}: убран.`)};
  }
  commit(plan){for(const [id,k] of Object.entries(plan.next))if(k!==this.items[id]&&!plan.locations?.[id])this.objects[id].location=locationFor(id,k||'absent');this.applyLocations(plan);this.repairSupports();this.save();}
  prepare(operation){
    const {action,item:id}=operation,o=this.objects[id];
    if(action==='receive')return o?.type==='portable'&&o.location.kind==='absent'&&!this.held&&operation.destination?{ok:true}:fail('Рука занята или предмет уже существует.','held');
    if(action==='stand_up')return this.hero.posture!=='standing'?{ok:true,support:this.hero.support}:{ok:false,reason:'already-standing',message:'Герой уже стоит.'};
    if(!OPERATIONS.includes(action)||!o)return fail('Неизвестная операция.','unsupported');
    if(o.location.kind==='absent')return fail(missing(id),'missing');if(!o.actions.includes(action))return fail('Этот объект не поддерживает такую операцию.','unsupported');
    if(['sit','lie_down','sleep','toggle'].includes(action)){
      if(this.held)return fail('Сначала положи удерживаемый предмет.','held');
      if(['lie_down','sleep'].includes(action)&&Object.values(this.objects).some(child=>child.location.surface==='bed'||child.returnTo?.surface==='bed'))return fail('На кровати лежат вещи. Сначала убери их, чтобы лечь.','surface-occupied');
      if(distance(this.hero.position,o.approach)>.025)return fail('Сначала подойди к предмету.','too-far');
      if(action==='toggle'&&o.state.on===operation.value)return fail(operation.value?'Лампа уже включена.':'Лампа уже выключена.','already');
      return {ok:true,...this.contextAt(id,this.hero.position)};
    }
    if(action==='open'||action==='close'){
      const target=this.target(id);if(!target||distance(this.hero.position,target.position)>.025)return fail('Сначала подойди к объекту.','too-far');
      if(Boolean(o.state.open)===(action==='open'))return fail(action==='open'?'Объект уже открыт.':'Объект уже закрыт.','already');return {ok:true,...target};
    }
    if(action==='move_to'){
      if(o.location.kind==='hand'&&!operation.returning)return fail('Предмет уже в руке. Укажи предмет в комнате.','held');
      const candidates=operation.position?[this.contextAt(id,operation.position,{returning:operation.returning})].filter(c=>this.canInteract(id,c)):this.targets(id,{returning:operation.returning}),chosen=chooseRoute(this.hero.position,candidates,this.obstacles);
      return chosen.ok?{ok:true,...chosen.target,route:chosen.route.points,rawRoute:chosen.route.rawPoints,optimizedRoute:chosen.route.optimizedPoints,candidates:chosen.candidates}:chosen;
    }
    if(action==='take'){
      if(this.held)return fail(this.held===id?'Этот предмет уже в руке.':'Рука занята. Сначала положи удерживаемый предмет.','held');
      const target=this.contextAt(id,this.hero.position);if(!this.canInteract(id,target))return fail('Сначала подойди к предмету: /move_to '+id,'too-far');return {ok:true,...target};
    }
    if(this.held!==id)return fail('Сначала возьми предмет: /take '+id,'not-held');
    if(action==='put'){const target=this.contextAt(id,this.hero.position,{returning:true});if(!this.canInteract(id,target))return fail('До места возврата далеко. Подойди к исходной поверхности.','too-far');return {ok:true,...target};}
    return {ok:true};
  }
  contact(operation){
    const checked=this.prepare(operation);if(!checked.ok)throw Error(checked.reason);const o=this.objects[operation.item];
    if(operation.action==='stand_up'){this.hero.posture='standing';this.hero.support=null;}
    if(['sit','lie_down','sleep'].includes(operation.action)){this.hero.posture={sit:'sitting',lie_down:'lying',sleep:'sleeping'}[operation.action];this.hero.support=operation.item;}
    if(operation.action==='toggle')o.state.on=operation.value;
    if(operation.action==='receive'){o.location=locationFor(o.id,'hand');o.returnTo=copy(operation.destination);}
    if(operation.action==='take'){o.returnTo=copy(o.location);o.location=locationFor(o.id,'hand');}
    if(operation.action==='put'){o.location=copy(o.returnTo);o.returnTo=null;o.state={open:0,using:false};}
    if(operation.action==='open'||operation.action==='close')o.state.open=operation.action==='open'?1:0;
    this.save();
  }
}
export class RoomController{
  constructor(state,renderer,{onChange=()=>{},onProgress=()=>{}}={}){this.state=state;this.renderer=renderer;renderer.connect?.(state);this.onChange=onChange;this.onProgress=onProgress;this.queue=[];this.epoch=0;this.running=null;this.busy=false;this.operation=null;this.history=[];this.sequence=0;}
  get pending(){return this.queue.length;}
  status(action,item,status,message=''){const same=status!=='waiting'&&this.operation?.action===action&&this.operation?.item===item&&['waiting','running'].includes(this.operation?.status);this.operation={id:same?this.operation.id:++this.sequence,action,item,status,message};this.history.push({...this.operation});this.history=this.history.slice(-40);this.onChange();}
  run(command){if(this.queue.length>=6)return Promise.resolve({message:'В очереди уже шесть фраз. Подожди немного.',type:'queue'});return new Promise(resolve=>{this.queue.push({command,resolve,status:'waiting'});this.drain();this.onChange();});}
  clearUse(){for(const o of Object.values(this.state.objects)){o.state.using=false;if(o.id==='book')o.state.open=0;}}
  cancel(){this.state.rollback();this.epoch++;this.running=null;this.busy=false;for(const task of this.queue.splice(0))task.resolve({cancelled:true});this.renderer.cancel();this.clearUse();this.state.save();if(this.operation?.status==='running')this.status(this.operation.action,this.operation.item,'error','cancelled');this.onChange();}
  reset(){this.state.reset();this.cancel();}
  async operate(operation,epoch){
    if(epoch!==this.epoch)return {cancelled:true};
    if(operation.action==='toggle'&&typeof operation.value!=='boolean')operation={...operation,value:!this.state.objects[operation.item]?.state.on};
    const {action,item}=operation;this.status(action,item,'waiting');const context=this.state.prepare(operation);
    if(!context.ok){this.status(action,item,'error',context.reason);return {message:context.message,type:'error'};}
    this.status(action,item,'running');let contacted=false;
    const done=await this.renderer.perform(operation,context,{contact:()=>{if(epoch!==this.epoch)return;this.state.contact(operation);contacted=true;this.onChange();}});
    if(!done||epoch!==this.epoch)return {cancelled:true};if(['take','put','open','close','sit','lie_down','sleep','stand_up','toggle','receive'].includes(action)&&!contacted)throw Error('missing-contact');
    if(action==='use'&&this.state.objects[item].use==='eat'){const o=this.state.objects[item];o.location=locationFor(item,'absent');o.returnTo=null;o.state={open:0,using:false};this.renderer.synchronize?.();}
    this.state.save();this.status(action,item,'completed');
    return {message:({move_to:'Герой подошёл к предмету.',take:'Предмет в руке.',put:'Предмет возвращён на место.',use:({book:'Герой прочитал книгу.',water:'Герой попил воды.',milk:'Герой выпил молоко.',phone:'Герой посмотрел телефон.',apple:'Герой съел яблоко.'})[item],sit:'Герой сидит.',lie_down:'Герой лежит.',sleep:'Герой спит.',stand_up:'Герой встал.',toggle:'Свет переключён.'})[action]||'Готово.',type:'success'};
  }
  async putAt(id,placement,epoch,debug={}){
    if(epoch!==this.epoch)return {cancelled:true};
    this.state.objects[id].returnTo=copy(placement.location);this.state.save();this.renderer.setPlacement?.({...placement,...debug});
    for(const operation of [{action:'move_to',item:id,returning:true,position:placement.target.position},{action:'put',item:id}]){const result=await this.operate(operation,epoch);if(result.cancelled||result.type==='error')return result;}
    return {type:'success'};
  }
  async createPortable(action,epoch){
    const id=action.item;if(this.state.items[id])return {message:`${ROOM_ITEMS[id]} уже есть в комнате.`,type:''};
    if(this.state.held){const held=this.state.held,placement=findPlacement(this.state,held);if(!placement.ok)return {message:placement.message,type:'error'};const result=await this.putAt(held,placement,epoch);if(result.cancelled||result.type==='error')return result;}
    const placement=findPlacement(this.state,id);if(!placement.ok)return {message:placement.message,type:'error'};
    this.renderer.setPlacement?.(placement);
    const received=await this.operate({action:'receive',item:id,destination:placement.location},epoch);if(received.cancelled||received.type==='error')return received;
    const result=await this.putAt(id,placement,epoch);if(result.cancelled||result.type==='error')return result;
    this.renderer.synchronize?.();return {message:`${ROOM_ITEMS[id]}: герой поставил предмет на ${placement.location.surface==='floor'?'пол рядом с собой':placement.location.surface==='bed'?'кровать':'стол'}.`,type:'success'};
  }
  planRelocations(ids,{avoid=[],excludeSurfaces=[]}={}){
    const state=this.state.fork(),moves=[];
    for(const child of [...new Set([...(state.held?[state.held]:[]),...ids])]){
      if(state.held!==child){const pickup=state.prepare({action:'move_to',item:child});if(!pickup.ok)return pickup;state.moveHero(pickup.position,pickup.facing);const take=state.prepare({action:'take',item:child});if(!take.ok)return take;state.contact({action:'take',item:child});}
      const placement=findPlacement(state,child,{avoid,excludeSurfaces});if(!placement.ok)return placement;
      moves.push({id:child,placement});state.objects[child].location=copy(placement.location);state.objects[child].returnTo=null;state.moveHero(placement.target.position,placement.target.facing);
    }
    return {ok:true,moves,finalState:state};
  }
  planFurniture(id){
    if(this.state.items[id])return {ok:false,reason:'duplicate',message:`${ROOM_ITEMS[id]} уже есть в комнате.`};
    if(!furnitureLocation(this.state,id))return {ok:false,message:'Зону мебели занимает герой или другая мебель. Сначала освободи место.'};
    const zone={id,...this.state.objects[id].footprint},blockers=furnitureBlockers(this.state,this.state.objects[id]),planned=this.planRelocations(blockers,{avoid:[zone]});
    if(!planned.ok)return planned;if(!furnitureLocation(planned.finalState,id))return placementError();return {...planned,blockers,zone};
  }
  rollbackTransfer(epoch){if(epoch===this.epoch){this.state.rollback();this.renderer.synchronize?.();}}
  async transferMoves(prepared,epoch){
    if(epoch!==this.epoch)return {cancelled:true};
    if(prepared.moves.length){this.state.transaction={kind:'furniture',snapshot:this.state.snapshot()};this.state.save();}
    for(const move of prepared.moves){
      if(this.state.held!==move.id)for(const op of [{action:'move_to',item:move.id},{action:'take',item:move.id}]){const result=await this.operate(op,epoch);if(result.cancelled||result.type==='error'){this.rollbackTransfer(epoch);return result;}}
      const result=await this.putAt(move.id,move.placement,epoch,{zone:prepared.zone,blockers:prepared.blockers});if(result.cancelled||result.type==='error'){this.rollbackTransfer(epoch);return result;}
    }return {type:'success'};
  }
  async clearRestSurface(id,epoch){
    const blockers=Object.values(this.state.objects).filter(o=>o.location.surface===id).map(o=>o.id);
    if(!blockers.length)return {type:'success'};
    const prepared=this.planRelocations(blockers,{excludeSurfaces:[id]});if(!prepared.ok)return {message:prepared.message,type:'error'};
    const result=await this.transferMoves({...prepared,blockers},epoch);if(epoch!==this.epoch)return {cancelled:true};if(result.cancelled||result.type==='error')return result;
    this.state.transaction=null;this.state.save();this.renderer.synchronize?.();return result;
  }
  async createFurniture(action,epoch){
    const prepared=this.planFurniture(action.item);if(!prepared.ok)return {message:prepared.message,type:prepared.reason==='duplicate'?'':'error'};
    this.renderer.setPlacement?.(prepared);
    const moved=await this.transferMoves(prepared,epoch);if(epoch!==this.epoch)return {cancelled:true};if(moved.cancelled||moved.type==='error')return moved;
    const plan=this.state.plan(action);if(!plan.ok||plan.blockers.length){this.rollbackTransfer(epoch);return {message:'Не удалось безопасно освободить зону мебели.',type:'error'};}
    this.status('create',action.item,'running');const done=await this.renderer.run(plan);
    if(!done||epoch!==this.epoch){this.rollbackTransfer(epoch);return {cancelled:true};}
    this.state.transaction=null;this.state.commit(plan);this.renderer.synchronize?.();this.status('create',action.item,'completed');return {message:plan.message,type:'success'};
  }
  async drain(){
    if(this.running===this.epoch)return;const epoch=this.epoch;this.running=epoch;this.busy=true;this.onChange();
    while(this.queue.length&&epoch===this.epoch){const {command,resolve}=this.queue.shift();this.onProgress(command);this.onChange();let result;
      try{
        if(!command.ok){result={message:command.message,type:'error'};await this.renderer.confused();}
        else for(const action of command.commands){
          if(action.action==='lesson'){result=await runLesson(this,action.item,epoch);if(result.cancelled||result.type==='error')break;continue;}
          if(action.action==='create'&&this.state.items[action.item]){this.status('create',action.item,'error','duplicate');result={message:`${ROOM_ITEMS[action.item]} уже есть в комнате.`,type:''};continue;}
          if(this.state.held&&['sit','lie_down','sleep','toggle'].includes(action.action)){result={message:'Сначала положи удерживаемый предмет.',type:'error'};break;}
          if(this.state.hero.posture!=='standing'&&action.action!=='stand_up'&&!(action.action==='sleep'&&this.state.hero.support===action.item)){result=await this.operate({action:'stand_up',item:this.state.hero.support},epoch);if(result.cancelled||result.type==='error')break;}
          if(['lie_down','sleep'].includes(action.action)&&command.mode!=='step'){result=await this.clearRestSurface(action.item,epoch);if(result.cancelled||result.type==='error')break;}
          if(['sit','lie_down','sleep','toggle','take'].includes(action.action)&&command.mode!=='step'){
            result=await this.operate({action:'move_to',item:action.item},epoch);if(result.cancelled||result.type==='error')break;
          }
          if(action.action==='put'&&command.mode!=='step'&&this.state.held===action.item){result=await this.operate({action:'move_to',item:action.item,returning:true},epoch);if(result.cancelled||result.type==='error')break;}

          if(action.action==='create'){
            result=isFurniture(action.item)?await this.createFurniture(action,epoch):await this.createPortable(action,epoch);
          }else if(action.action==='remove'){
            const plan=this.state.plan(action);this.status(action.action,action.item,'waiting');
            if(!plan.ok){this.status(action.action,action.item,'error',plan.reason);result={message:plan.message,type:plan.reason==='duplicate'?'':'error'};}
            else{this.status(action.action,action.item,'running');const done=await this.renderer.run(plan);if(!done||epoch!==this.epoch)break;this.state.commit(plan);this.renderer.synchronize?.();this.status(action.action,action.item,'completed');result={message:plan.message,type:'success'};}
          }else if(action.action==='use'&&command.mode!=='step'){
            const plan=this.state.plan(action);if(!plan.ok){result={message:plan.message,type:'error'};this.status('use',action.item,'error',plan.reason);}
            else{
              const operations=this.state.held===action.item?[]:[{action:'move_to',item:action.item},{action:'take',item:action.item}];
              operations.push({action:'use',item:action.item});if(this.state.objects[action.item].use!=='eat')operations.push({action:'move_to',item:action.item,returning:true},{action:'put',item:action.item});
              for(const op of operations){result=await this.operate(op,epoch);if(result.cancelled||result.type==='error')break;}
              if(result?.type!=='error'&&!result?.cancelled)result={message:plan.message,type:'success'};
            }
          }else result=await this.operate(action,epoch);
          if(epoch!==this.epoch||result?.cancelled||result?.type==='error')break;
        }
        resolve(epoch===this.epoch?(result||{message:'Готово.'}):{cancelled:true});
      }catch{
        if(epoch===this.epoch){this.state.rollback();this.renderer.cancel();this.clearUse();this.state.save();this.status(this.operation?.action||'unknown',this.operation?.item,'error','animation-failed');}
        resolve(epoch===this.epoch?{message:'Действие прервалось. Положение героя и предметов сохранено.',type:'error'}:{cancelled:true});
      }
    }
    if(epoch===this.epoch){this.busy=false;this.running=null;this.onChange();}
  }
}
