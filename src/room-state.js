export const ROOM_STORAGE_KEY='korean-stickman.room.v1';
export const ROOM_ITEMS={desk:'Стол',book:'Книга',water:'Вода'};
export const TABLE={u:.55,v:.30,w:.35,d:.32,height:102,scale:1};
export const FLOOR_SLOTS={book:[.24,.84],water:[.20,.54]};
export const TABLE_SLOTS={book:[.61,.54],water:[.80,.53]};
export const START=[.22,.72];
export const HERO_SCALE=.60;
export const GRIPS={book:[0,-5],water:[0,-25]};
export function project([u,v],height=0){return [500+410*u-410*v,340+165*u+215*v-height];}
export function itemLocation(id,placement){const uv=(placement==='table'?TABLE_SLOTS:FLOOR_SLOTS)[id];return {uv:[...uv],point:project(uv,placement==='table'?TABLE.height:0),placement};}
export function approach(id,placement){return placement==='table'?(id==='book'?[.60,.72]:[.81,.72]):(id==='book'?[.20,.94]:[.16,.64]);}
// All destinations lie outside the desk. This fixed front corridor is not a pathfinder.
export function routeTo(from,to){return [[...from],[from[0],.84],[to[0],.84],[...to]].filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>.001);}
export function parseRoom(raw){
  const heard=String(raw||'').normalize('NFKC').trim();
  const text=heard.replace(/[\s.!?。！？,，]/gu,'').replace(/^안녕하세요/u,'');
  const fail={ok:false,heard,commands:[],reason:'unknown-room-intent',message:'Попробуй короткую фразу: 책이 있어요, 책을 읽어요 или 물을 마셔요.'};
  if(/[?？]/u.test(heard))return fail;
  if(/^(책하고물|책과물|책이랑물)(이|가)?(있어요|있습니다)$/u.test(text))return {ok:true,heard,commands:[{action:'create',item:'book'},{action:'create',item:'water'}],reason:'two-items'};
  const existence=text.match(/^(책상|책|물)(?:이|가)?(있어요|없어요|있습니다|없습니다)$/u);
  if(existence)return {ok:true,heard,commands:[{action:existence[2].startsWith('있')?'create':'remove',item:({'책상':'desk','책':'book','물':'water'})[existence[1]]}],reason:'existence'};
  if(/^책(?:을)?(읽어요|읽습니다)$/u.test(text))return {ok:true,heard,commands:[{action:'use',item:'book'}],reason:'read'};
  if(/^물(?:을)?(마셔요|마십니다)$/u.test(text))return {ok:true,heard,commands:[{action:'use',item:'water'}],reason:'drink'};
  return fail;
}
export class RoomState{
  constructor(storage){
    if(arguments.length===0){try{storage=globalThis.localStorage;}catch{}}
    this.storage=storage;this.items={desk:null,book:null,water:null};this.storageAvailable=Boolean(storage);
    try{const saved=JSON.parse(storage?.getItem(ROOM_STORAGE_KEY)||'null');if(saved?.version===1){
      this.items.desk=saved.items?.desk==='floor'?'floor':null;
      for(const id of ['book','water']){const place=saved.items?.[id];this.items[id]=place==='floor'?'floor':place==='table'?(this.items.desk?'table':'floor'):null;}
    }}catch{this.storageAvailable=false;}
  }
  save(){try{this.storage?.setItem(ROOM_STORAGE_KEY,JSON.stringify({version:1,items:this.items}));this.storageAvailable=Boolean(this.storage);}catch{this.storageAvailable=false;}}
  reset(){this.items={desk:null,book:null,water:null};this.save();}
  plan(command){
    const next={...this.items},id=command.item,name=ROOM_ITEMS[id];
    if(!name||!['create','remove','use'].includes(command.action)||(command.action==='use'&&id==='desk'))return {ok:false,message:'Не удалось понять команду.'};
    if(command.action==='create'){
      if(next[id])return {ok:false,message:`${name} уже есть в комнате.`,reason:'duplicate'};
      next[id]=id==='desk'||!next.desk?'floor':'table';
    }else if(!next[id])return {ok:false,message:`${name}: пока нет в комнате. Сначала скажи «${id==='book'?'책이':id==='water'?'물이':'책상이'} 있어요».`,reason:'missing'};
    else if(command.action==='remove'){
      next[id]=null;if(id==='desk')for(const small of ['book','water'])if(next[small]==='table')next[small]='floor';
    }
    const created={desk:'Стол появился.',book:'Книга появилась.',water:'Вода появилась.'},removed={desk:'Стол убран.',book:'Книга убрана.',water:'Вода убрана.'};
    return {ok:true,...command,before:{...this.items},next,message:command.action==='use'?(id==='book'?'Герой прочитал книгу.':'Герой попил воды.'):command.action==='create'?created[id]:removed[id]};
  }
  commit(plan){this.items={...plan.next};this.save();}
}
export class RoomController{
  constructor(state,renderer,{onChange=()=>{},onProgress=()=>{}}={}){this.state=state;this.renderer=renderer;this.onChange=onChange;this.onProgress=onProgress;this.queue=[];this.epoch=0;this.running=null;this.busy=false;}
  get pending(){return this.queue.length;}
  run(command){if(this.queue.length>=6)return Promise.resolve({message:'В очереди уже шесть фраз. Подожди немного.',type:'queue'});return new Promise(resolve=>{this.queue.push({command,resolve});this.drain();this.onChange();});}
  cancel(){this.epoch++;this.running=null;this.busy=false;for(const task of this.queue.splice(0))task.resolve({cancelled:true});this.renderer.cancel(this.state.items);this.onChange();}
  reset(){this.state.reset();this.cancel();}
  async drain(){
    if(this.running===this.epoch)return;const epoch=this.epoch;this.running=epoch;this.busy=true;this.onChange();
    while(this.queue.length&&epoch===this.epoch){
      const {command,resolve}=this.queue.shift();this.onProgress(command);this.onChange();let result;
      try{
        if(!command.ok){await this.renderer.confused();result={message:command.message,type:'error'};}
        else for(const action of command.commands){
          const plan=this.state.plan(action);
          if(!plan.ok){await this.renderer.confused();result={message:plan.message,type:plan.reason==='duplicate'?'':'error'};}
          else{const done=await this.renderer.run(plan);if(!done||epoch!==this.epoch)break;this.state.commit(plan);result={message:plan.message,type:'success'};this.onChange();}
          if(epoch!==this.epoch)break;
        }
        resolve(epoch===this.epoch?(result||{message:'Готово.'}):{cancelled:true});
      }catch{this.renderer.cancel(this.state.items);resolve(epoch===this.epoch?{message:'Движение прервалось. Попробуй ещё раз.',type:'error'}:{cancelled:true});}
    }
    if(epoch===this.epoch){this.busy=false;this.running=null;this.onChange();}
  }
}
