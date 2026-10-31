import {TABLE,FLOOR_SLOTS,TABLE_SLOTS,START,GRIPS,project,approach,distance,facingFor} from './room-space.js';
import {planRoute,walkable} from './room-navigation.js';
import {reachableGrip} from './room-motion.js';
export * from './room-space.js';
export const ROOM_STORAGE_KEY='korean-stickman.room.v1';
export const ROOM_ITEMS={desk:'Стол',book:'Книга',water:'Вода'};
export const OPERATIONS=['move_to','take','put','use','open','close'];
export const OBJECT_TYPES={desk:{type:'furniture',actions:['move_to'],footprint:TABLE},book:{type:'portable',actions:['move_to','take','put','use'],grip:GRIPS.book},water:{type:'portable',actions:['move_to','take','put','use'],grip:GRIPS.water}};
const copy=value=>structuredClone(value);
const fail=(message,reason='impossible')=>({ok:false,message,reason});
const missing=id=>`${ROOM_ITEMS[id]}: пока нет в комнате. Сначала скажи «${id==='book'?'책이':id==='water'?'물이':'책상이'} 있어요».`;
export function routeTo(from,to){return planRoute(from,to,[TABLE]).points;}
export function parseRoom(raw,{debug=false}={}){
  const heard=String(raw||'').normalize('NFKC').trim(),text=heard.replace(/[\s.!?。！？,，]/gu,'').replace(/^안녕하세요/u,'');
  const rejected={ok:false,heard,commands:[],reason:'unknown-room-intent',message:'Попробуй короткую фразу: 책이 있어요, 책을 읽어요 или 물을 마셔요.'};
  if(debug){const m=heard.match(/^\/(move_to|take|put|use|open|close)\s+(desk|book|water)$/u);if(m)return {ok:true,mode:'step',heard,commands:[{action:m[1],item:m[2]}],reason:'debug-operation'};}
  if(/[?？]/u.test(heard))return rejected;
  if(/^(책하고물|책과물|책이랑물)(이|가)?(있어요|있습니다)$/u.test(text))return {ok:true,heard,commands:[{action:'create',item:'book'},{action:'create',item:'water'}],reason:'two-items'};
  const m=text.match(/^(책상|책|물)(?:이|가)?(있어요|없어요|있습니다|없습니다)$/u);
  if(m)return {ok:true,heard,commands:[{action:m[2].startsWith('있')?'create':'remove',item:({'책상':'desk','책':'book','물':'water'})[m[1]]}],reason:'existence'};
  if(/^책(?:을)?(읽어요|읽습니다)$/u.test(text))return {ok:true,heard,commands:[{action:'use',item:'book'}],reason:'read'};
  if(/^물(?:을)?(마셔요|마십니다)$/u.test(text))return {ok:true,heard,commands:[{action:'use',item:'water'}],reason:'drink'};
  return rejected;
}
function locationFor(id,kind){
  if(kind==='absent'||!kind)return {kind:'absent',surface:null,uv:null,height:0};
  if(kind==='hand')return {kind,surface:'hero',uv:null,height:0};
  return {kind,surface:kind==='table'?'desk':'floor',uv:copy(id==='desk'?[TABLE.u,TABLE.v]:(kind==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id]),height:kind==='table'?TABLE.height:0};
}
function restoredLocation(id,data){const result=locationFor(id,data?.kind);if(id!=='desk'&&['floor','table'].includes(result.kind)&&Array.isArray(data.uv)&&data.uv.length===2&&data.uv.every(v=>Number.isFinite(v)&&v>=0&&v<=1))result.uv=[...data.uv];return result;}
export class RoomState{
  constructor(storage){
    if(arguments.length===0){try{storage=globalThis.localStorage;}catch{}}
    this.storage=storage;this.storageAvailable=Boolean(storage);this.initialize();
    try{const saved=JSON.parse(storage?.getItem(ROOM_STORAGE_KEY)||'null');
      if(saved?.version===1)for(const id of Object.keys(ROOM_ITEMS)){const k=saved.items?.[id];this.objects[id].location=locationFor(id,(id==='desk'?k==='floor':['floor','table'].includes(k))?k:'absent');}
      if(saved?.version===2){let occupied=false;
        for(const id of Object.keys(ROOM_ITEMS)){const data=saved.objects?.[id],k=data?.location?.kind,valid=id==='desk'?k==='floor':['floor','table','hand'].includes(k);
          this.objects[id].location=valid&&!(k==='hand'&&occupied)?restoredLocation(id,data.location):locationFor(id,'absent');
          if(k==='hand'&&valid&&!occupied){occupied=true;this.objects[id].returnTo=restoredLocation(id,['floor','table'].includes(data.returnTo?.kind)?data.returnTo:{kind:'floor'});}
        }
        const p=saved.hero?.position;if(Array.isArray(p)&&p.length===2&&walkable(p,this.obstacles))this.hero.position=[...p];
        if(['front','back','left','right'].includes(saved.hero?.facing))this.hero.facing=saved.hero.facing;
      }this.repairSupports();
    }catch{this.storageAvailable=false;}
  }
  initialize(){this.hero={position:[...START],facing:'right'};this.objects=Object.fromEntries(Object.entries(OBJECT_TYPES).map(([id,definition])=>[id,{id,...copy(definition),location:locationFor(id,'absent'),returnTo:null,state:{open:0,using:false}}]));}
  get items(){return Object.fromEntries(Object.entries(this.objects).map(([id,o])=>[id,o.location.kind==='absent'?null:o.location.kind]));}
  get held(){return Object.values(this.objects).find(o=>o.location.kind==='hand')?.id||null;}
  get obstacles(){return Object.values(this.objects).filter(o=>o.type==='furniture'&&o.location.kind==='floor').map(o=>({id:o.id,...o.footprint}));}
  save(){try{this.storage?.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:2,hero:this.hero,objects:this.objects}));this.storageAvailable=Boolean(this.storage);}catch{this.storageAvailable=false;}}
  reset(){this.initialize();this.save();}
  repairSupports(){for(const id of ['book','water']){const o=this.objects[id];if(!this.items.desk){if(o.location.kind==='table')o.location=locationFor(id,'floor');if(o.returnTo?.kind==='table')o.returnTo=locationFor(id,'floor');}}}
  moveHero(position,facing=this.hero.facing){this.hero.position=[...position];this.hero.facing=facing;}
  point(id,{returning=false}={}){const o=this.objects[id],loc=returning?o.returnTo:o.location;return loc&&['floor','table'].includes(loc.kind)?project(loc.uv,loc.height):null;}
  target(id,{returning=false}={}){
    const o=this.objects[id],loc=returning?o.returnTo:o.location;if(!loc||!['floor','table'].includes(loc.kind))return null;
    const slot=(loc.kind==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id],position=id==='desk'?approach('book','table'):approach(id,loc.kind).map((v,i)=>v+(loc.uv[i]-slot[i])),point=id==='desk'?project([TABLE.u+TABLE.w/2,TABLE.v+TABLE.d/2],TABLE.height):this.point(id,{returning});
    return {position,point,grip:id==='desk'?null:point.map((v,i)=>v+o.grip[i]),facing:facingFor(position,loc.uv),location:copy(loc)};
  }
  describe(id){const o=this.objects[id];return {...copy(o),held:o.location.kind==='hand',interaction:this.target(id,{returning:o.location.kind==='hand'})};}
  plan(command){
    const next={...this.items},id=command.item,name=ROOM_ITEMS[id];if(!name||!['create','remove','use'].includes(command.action)||(command.action==='use'&&id==='desk'))return fail('Не удалось понять команду.');
    if(command.action==='create'){
      if(next[id])return fail(`${name} уже есть в комнате.`,'duplicate');next[id]=id==='desk'||!next.desk?'floor':'table';
      if(id==='desk'&&!walkable(this.hero.position,[...this.obstacles,TABLE]))return fail('Герой стоит на месте будущего стола. Сначала отойди к другому предмету.','occupied');
    }else if(!next[id])return fail(missing(id),'missing');
    else if(command.action==='use'&&this.held&&this.held!==id)return fail('Рука занята. Сначала положи удерживаемый предмет.','held');
    else if(command.action==='remove'){if(next[id]==='hand')return fail('Сначала положи предмет из руки.','held');next[id]=null;if(id==='desk')for(const small of ['book','water'])if(next[small]==='table')next[small]='floor';}
    const created={desk:'Стол появился.',book:'Книга появилась.',water:'Вода появилась.'},removed={desk:'Стол убран.',book:'Книга убрана.',water:'Вода убрана.'};
    return {ok:true,...command,before:{...this.items},next,message:command.action==='use'?(id==='book'?'Герой прочитал книгу.':'Герой попил воды.'):command.action==='create'?created[id]:removed[id]};
  }
  commit(plan){for(const [id,k] of Object.entries(plan.next))if(k!==this.items[id])this.objects[id].location=locationFor(id,k||'absent');this.repairSupports();this.save();}
  prepare(operation){
    const {action,item:id}=operation,o=this.objects[id];if(!OPERATIONS.includes(action)||!o)return fail('Неизвестная операция.','unsupported');
    if(o.location.kind==='absent')return fail(missing(id),'missing');if(!o.actions.includes(action))return fail('Этот объект не поддерживает такую операцию.','unsupported');
    if(action==='open'||action==='close'){
      const target=this.target(id);if(!target||distance(this.hero.position,target.position)>.025)return fail('Сначала подойди к объекту.','too-far');
      if(Boolean(o.state.open)===(action==='open'))return fail(action==='open'?'Объект уже открыт.':'Объект уже закрыт.','already');return {ok:true,...target};
    }
    if(action==='move_to'){const target=this.target(id,{returning:operation.returning});if(!target)return fail('Предмет уже в руке. Укажи предмет в комнате.','held');const route=planRoute(this.hero.position,target.position,this.obstacles);return route.ok?{ok:true,...target,route:route.points}:route;}
    if(action==='take'){
      if(this.held)return fail(this.held===id?'Этот предмет уже в руке.':'Рука занята. Сначала положи удерживаемый предмет.','held');
      const target=this.target(id);if(!target||distance(this.hero.position,target.position)>.025||!reachableGrip(this.hero.position,target)||!walkable(this.hero.position,this.obstacles)||(o.location.kind==='floor'&&!walkable(o.location.uv,this.obstacles,0)))return fail('Сначала подойди к предмету: /move_to '+id,'too-far');return {ok:true,...target};
    }
    if(this.held!==id)return fail('Сначала возьми предмет: /take '+id,'not-held');
    if(action==='put'){const target=this.target(id,{returning:true});if(!target||distance(this.hero.position,target.position)>.025||!reachableGrip(this.hero.position,target)||!walkable(this.hero.position,this.obstacles))return fail('До места возврата далеко. Подойди к исходной поверхности.','too-far');return {ok:true,...target};}
    return {ok:true};
  }
  contact(operation){
    const checked=this.prepare(operation);if(!checked.ok)throw Error(checked.reason);const o=this.objects[operation.item];
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
    const {action,item}=operation;this.status(action,item,'waiting');const context=this.state.prepare(operation);
    if(!context.ok){this.status(action,item,'error',context.reason);return {message:context.message,type:'error'};}
    this.status(action,item,'running');let contacted=false;
    const done=await this.renderer.perform(operation,context,{contact:()=>{if(epoch!==this.epoch)return;this.state.contact(operation);contacted=true;this.onChange();}});
    if(!done||epoch!==this.epoch)return {cancelled:true};if(['take','put','open','close'].includes(action)&&!contacted)throw Error('missing-contact');
    this.state.save();this.status(action,item,'completed');
    return {message:({move_to:'Герой подошёл к предмету.',take:'Предмет в руке.',put:'Предмет возвращён на место.',use:item==='book'?'Герой прочитал книгу.':'Герой попил воды.'})[action]||'Готово.',type:'success'};
  }
  async drain(){
    if(this.running===this.epoch)return;const epoch=this.epoch;this.running=epoch;this.busy=true;this.onChange();
    while(this.queue.length&&epoch===this.epoch){const {command,resolve}=this.queue.shift();this.onProgress(command);this.onChange();let result;
      try{
        if(!command.ok){result={message:command.message,type:'error'};await this.renderer.confused();}
        else for(const action of command.commands){
          if(['create','remove'].includes(action.action)){
            const plan=this.state.plan(action);this.status(action.action,action.item,'waiting');
            if(!plan.ok){this.status(action.action,action.item,'error',plan.reason);result={message:plan.message,type:plan.reason==='duplicate'?'':'error'};}
            else{this.status(action.action,action.item,'running');const done=await this.renderer.run(plan);if(!done||epoch!==this.epoch)break;this.state.commit(plan);this.renderer.synchronize?.();this.status(action.action,action.item,'completed');result={message:plan.message,type:'success'};}
          }else if(action.action==='use'&&command.mode!=='step'){
            const plan=this.state.plan(action);if(!plan.ok){result={message:plan.message,type:'error'};this.status('use',action.item,'error',plan.reason);}
            else{
              const operations=this.state.held===action.item?[]:[{action:'move_to',item:action.item},{action:'take',item:action.item}];
              operations.push({action:'use',item:action.item},{action:'move_to',item:action.item,returning:true},{action:'put',item:action.item});
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
