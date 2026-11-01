import {TABLE,FLOOR_SLOTS,TABLE_SLOTS,START,GRIPS,project,approach,distance,facingFor} from './room-space.js';
import {planRoute,walkable,chooseRoute,NAV} from './room-navigation.js';
import {reachableGrip,gripExtension} from './room-motion.js';
import {releaseSurface} from './room-surfaces.js';
export * from './room-space.js';
export const ROOM_STORAGE_KEY='korean-stickman.room.v1';
import {ROOM_ITEMS,KOREAN,OBJECT_TYPES,placementFor,isFurniture,furnitureCenter} from './room-catalog.js';
export {ROOM_ITEMS,OBJECT_TYPES};
export const OPERATIONS=['move_to','take','put','use','open','close','sit','lie_down','sleep','stand_up','toggle'];
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
  const m=text.match(/^(책상|책|물|의자|침대|사과|휴대폰|우유|전등)(?:이|가)?(있어요|없어요|있습니다|없습니다)$/u);
  if(m)return result(m[2].startsWith('있')?'create':'remove',names[m[1]]);
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
function restoredLocation(id,data){const result=locationFor(id,data?.kind);if(!isFurniture(id)&&['floor','table'].includes(result.kind)&&Array.isArray(data.uv)&&data.uv.length===2&&data.uv.every(v=>Number.isFinite(v)&&v>=0&&v<=1))result.uv=[...data.uv];return result;}
export class RoomState{
  constructor(storage){
    if(arguments.length===0){try{storage=globalThis.localStorage;}catch{}}
    this.storage=storage;this.storageAvailable=Boolean(storage);this.initialize();
    try{const saved=JSON.parse(storage?.getItem(ROOM_STORAGE_KEY)||'null');
      if(saved?.version===1)for(const id of Object.keys(ROOM_ITEMS)){const k=saved.items?.[id];this.objects[id].location=locationFor(id,(isFurniture(id)?k==='floor':['floor','table'].includes(k))?k:'absent');}
      if([2,3].includes(saved?.version)){let occupied=false;
        for(const id of Object.keys(ROOM_ITEMS)){const data=saved.objects?.[id],k=data?.location?.kind,valid=isFurniture(id)?k==='floor':['floor','table','hand'].includes(k);
          this.objects[id].location=valid&&!(k==='hand'&&occupied)?restoredLocation(id,data.location):locationFor(id,'absent');
          if(id==='lamp')this.objects[id].state.on=data?.state?.on===true;
          if(k==='hand'&&valid&&!occupied){occupied=true;this.objects[id].returnTo=restoredLocation(id,['floor','table'].includes(data.returnTo?.kind)?data.returnTo:{kind:'floor'});}
        }
        const p=saved.hero?.position;if(Array.isArray(p)&&p.length===2&&walkable(p,this.obstacles))this.hero.position=[...p];
        if(['front','back','left','right'].includes(saved.hero?.facing))this.hero.facing=saved.hero.facing;
        const posture=saved.hero?.posture,support=saved.hero?.support;if(['sitting','lying','sleeping'].includes(posture)&&this.items[support]&&((posture==='sitting'&&support==='chair')||(posture!=='sitting'&&support==='bed'))){this.hero.posture=posture;this.hero.support=support;this.hero.position=[...this.objects[support].approach];this.hero.facing='right';}
      }this.repairSupports();
    }catch{this.storageAvailable=false;}
  }
  initialize(){this.hero={position:[...START],facing:'right',posture:'standing',support:null};this.objects=Object.fromEntries(Object.entries(OBJECT_TYPES).map(([id,definition])=>[id,{id,...copy(definition),location:locationFor(id,'absent'),returnTo:null,state:{open:0,using:false,on:false}}]));}
  get items(){return Object.fromEntries(Object.entries(this.objects).map(([id,o])=>[id,o.location.kind==='absent'?null:o.location.kind]));}
  get held(){return Object.values(this.objects).find(o=>o.location.kind==='hand')?.id||null;}
  get obstacles(){return Object.values(this.objects).filter(o=>o.type==='furniture'&&o.location.kind==='floor').map(o=>({id:o.id,...o.footprint}));}
  save(){try{this.storage?.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:3,hero:this.hero,objects:this.objects}));this.storageAvailable=Boolean(this.storage);}catch{this.storageAvailable=false;}}
  reset(){this.initialize();this.save();}
  repairSupports(){
    const missing=new Set();for(const object of Object.values(this.objects))for(const loc of [object.location,object.returnTo])if(loc?.surface&&!['floor','hero'].includes(loc.surface)&&(!this.objects[loc.surface]||this.objects[loc.surface].location.kind==='absent'))missing.add(loc.surface);
    for(const id of missing){const release=releaseSurface(this.objects,id,this.obstacles);if(release.ok)this.applyLocations(release);}
  }
  applyLocations({locations={},returnLocations={}}){for(const [id,loc] of Object.entries(locations))this.objects[id].location=copy(loc);for(const [id,loc] of Object.entries(returnLocations))this.objects[id].returnTo=copy(loc);}
  moveHero(position,facing=this.hero.facing){this.hero.position=[...position];this.hero.facing=facing;}
  point(id,{returning=false}={}){const o=this.objects[id],loc=returning?o.returnTo:o.location;return loc&&['floor','table'].includes(loc.kind)?project(loc.uv,loc.height):null;}
  contextAt(id,position,{returning=false}={}){
    const o=this.objects[id],loc=returning?o.returnTo:o.location;if(!loc||!['floor','table'].includes(loc.kind))return null;
    const point=isFurniture(id)?project(furnitureCenter(id),o.footprint.height):this.point(id,{returning});
    return {position:[...position],point,grip:isFurniture(id)?(id==='lamp'?project(furnitureCenter(id),72):null):point.map((v,i)=>v+o.grip[i]),facing:isFurniture(id)?(id==='lamp'&&point[0]<project(position)[0]?'left':'right'):point[0]<project(position)[0]?'left':'right',location:copy(loc)};
  }
  canInteract(id,context){
    if(!context||!walkable(context.position,this.obstacles))return false;
    if(isFurniture(id))return false;
    if(distance(context.position,context.location.uv)>(context.location.kind==='table'?.24:.18))return false;
    if(context.location.kind==='floor'&&(!walkable(context.location.uv,this.obstacles,0)||distance(project(context.position),project(context.location.uv))<(id==='book'?45:27)))return false;
    return reachableGrip(context.position,context);
  }
  targets(id,options={}){
    const o=this.objects[id],loc=options.returning?o.returnTo:o.location;if(!loc||!['floor','table'].includes(loc.kind))return [];
    if(isFurniture(id)&&id!=='desk'){const position=o.approach;return walkable(position,this.obstacles)?[this.contextAt(id,position,options)]:[];}
    const positions=[],slot=(loc.kind==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id]||loc.uv;
    if(id==='desk'||loc.kind==='table'){
      const pad=NAV.radius+.012;
      for(const t of [0,.15,.3,.45,.6,.75,.9,1]){
        const u=TABLE.u+TABLE.w*t,v=TABLE.v+TABLE.d*t;
        positions.push([TABLE.u-pad,v],[TABLE.u+TABLE.w+pad,v],[u,TABLE.v-pad],[u,TABLE.v+TABLE.d+pad]);
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
    return {ok:true,...command,before:{...this.items},next,...release,message:command.action==='use'?({book:'Герой прочитал книгу.',water:'Герой попил воды.',milk:'Герой выпил молоко.',phone:'Герой посмотрел телефон.',apple:'Герой съел яблоко.'}[id]):command.action==='create'?(created[id]||`${name}: появился в комнате.`):(removed[id]||`${name}: убран.`)};
  }
  commit(plan){for(const [id,k] of Object.entries(plan.next))if(k!==this.items[id]&&!plan.locations?.[id])this.objects[id].location=locationFor(id,k||'absent');this.applyLocations(plan);this.repairSupports();this.save();}
  prepare(operation){
    const {action,item:id}=operation,o=this.objects[id];
    if(action==='stand_up')return this.hero.posture!=='standing'?{ok:true,support:this.hero.support}:{ok:false,reason:'already-standing',message:'Герой уже стоит.'};
    if(!OPERATIONS.includes(action)||!o)return fail('Неизвестная операция.','unsupported');
    if(o.location.kind==='absent')return fail(missing(id),'missing');if(!o.actions.includes(action))return fail('Этот объект не поддерживает такую операцию.','unsupported');
    if(['sit','lie_down','sleep','toggle'].includes(action)){
      if(this.held)return fail('Сначала положи удерживаемый предмет.','held');
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
      const candidates=this.targets(id,{returning:operation.returning}),chosen=chooseRoute(this.hero.position,candidates,this.obstacles);
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
  cancel(){this.epoch++;this.running=null;this.busy=false;for(const task of this.queue.splice(0))task.resolve({cancelled:true});this.renderer.cancel();this.clearUse();this.state.save();if(this.operation?.status==='running')this.status(this.operation.action,this.operation.item,'error','cancelled');this.onChange();}
  reset(){this.state.reset();this.cancel();}
  async operate(operation,epoch){
    if(operation.action==='toggle'&&typeof operation.value!=='boolean')operation={...operation,value:!this.state.objects[operation.item]?.state.on};
    const {action,item}=operation;this.status(action,item,'waiting');const context=this.state.prepare(operation);
    if(!context.ok){this.status(action,item,'error',context.reason);return {message:context.message,type:'error'};}
    this.status(action,item,'running');let contacted=false;
    const done=await this.renderer.perform(operation,context,{contact:()=>{if(epoch!==this.epoch)return;this.state.contact(operation);contacted=true;this.onChange();}});
    if(!done||epoch!==this.epoch)return {cancelled:true};if(['take','put','open','close','sit','lie_down','sleep','stand_up','toggle'].includes(action)&&!contacted)throw Error('missing-contact');
    if(action==='use'&&this.state.objects[item].use==='eat'){const o=this.state.objects[item];o.location=locationFor(item,'absent');o.returnTo=null;o.state={open:0,using:false};this.renderer.synchronize?.();}
    this.state.save();this.status(action,item,'completed');
    return {message:({move_to:'Герой подошёл к предмету.',take:'Предмет в руке.',put:'Предмет возвращён на место.',use:({book:'Герой прочитал книгу.',water:'Герой попил воды.',milk:'Герой выпил молоко.',phone:'Герой посмотрел телефон.',apple:'Герой съел яблоко.'})[item],sit:'Герой сидит.',lie_down:'Герой лежит.',sleep:'Герой спит.',stand_up:'Герой встал.',toggle:'Свет переключён.'})[action]||'Готово.',type:'success'};
  }
  async drain(){
    if(this.running===this.epoch)return;const epoch=this.epoch;this.running=epoch;this.busy=true;this.onChange();
    while(this.queue.length&&epoch===this.epoch){const {command,resolve}=this.queue.shift();this.onProgress(command);this.onChange();let result;
      try{
        if(!command.ok){result={message:command.message,type:'error'};await this.renderer.confused();}
        else for(const action of command.commands){
          if(this.state.held&&['sit','lie_down','sleep','toggle'].includes(action.action)){result={message:'Сначала положи удерживаемый предмет.',type:'error'};break;}
          if(this.state.hero.posture!=='standing'&&action.action!=='stand_up'&&!(action.action==='sleep'&&this.state.hero.support===action.item)){result=await this.operate({action:'stand_up',item:this.state.hero.support},epoch);if(result.cancelled||result.type==='error')break;}
          if(['sit','lie_down','sleep','toggle','take'].includes(action.action)&&command.mode!=='step'){
            result=await this.operate({action:'move_to',item:action.item},epoch);if(result.cancelled||result.type==='error')break;
          }
          if(action.action==='put'&&command.mode!=='step'&&this.state.held===action.item){result=await this.operate({action:'move_to',item:action.item,returning:true},epoch);if(result.cancelled||result.type==='error')break;}

          if(['create','remove'].includes(action.action)){
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
        if(epoch===this.epoch){this.renderer.cancel();this.clearUse();this.state.save();this.status(this.operation?.action||'unknown',this.operation?.item,'error','animation-failed');}
        resolve(epoch===this.epoch?{message:'Действие прервалось. Положение героя и предметов сохранено.',type:'error'}:{cancelled:true});
      }
    }
    if(epoch===this.epoch){this.busy=false;this.running=null;this.onChange();}
  }
}
