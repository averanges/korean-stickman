import {ACTIONS,OBJECTS,catalogs,NOUNS} from './language-catalog.js';
const own=(o,k)=>Object.hasOwn(o,k),plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const keys=(o,allowed)=>plain(o)&&Object.keys(o).every(k=>allowed.includes(k));
export const FEATURES={speechAct:['statement','instruction','question','prohibition','description','unknown'],polarity:['positive','negative','unknown'],tense:['present','past','dictionary','unknown']};
export function makeIntent(kind,target=null,action=kind,attributes={},params={},features={}){const {speechAct='statement',polarity='positive',tense='present'}=features;return {kind,target,action,attributes,params,speechAct,polarity,tense};}
export function documentOf(status,intents=[],reason='supported'){return {schemaVersion:1,status,intents,reason};}
export function validateDocument(data,level){
 if(!keys(data,['schemaVersion','status','intents','reason'])||data.schemaVersion!==1||!['resolved','clarify','blocked','unresolved'].includes(data.status)||!['supported','ambiguous','unsupported','unsafe','incomplete','location','multiple-actions','invalid','missing','already'].includes(data.reason)||!Array.isArray(data.intents)||data.intents.length>4)return false;
 if(data.status==='resolved'&&!data.intents.length)return false;
 return data.intents.every(i=>{
  if(!keys(i,['kind','target','action','attributes','params','speechAct','polarity','tense'])||Object.keys(i).length!==8||!plain(i.attributes)||!plain(i.params)||!FEATURES.speechAct.includes(i.speechAct)||!FEATURES.polarity.includes(i.polarity)||!FEATURES.tense.includes(i.tense))return false;
  if(level==='creator'){
   if(!['greet','set_character_attributes'].includes(i.kind)||i.target!==null||i.action!==i.kind||Object.keys(i.params).length)return false;
   if(i.kind==='greet')return Object.keys(i.attributes).length===0;
   return Object.keys(i.attributes).length>0&&Object.entries(i.attributes).every(([f,v])=>own(catalogs,f)&&typeof v==='string'&&own(catalogs[f],v));
  }
  if(level!=='home'||Object.keys(i.attributes).length||!(i.target===null||OBJECTS.includes(i.target)))return false;
  if(['create','remove'].includes(i.kind))return OBJECTS.includes(i.target)&&i.action===i.kind&&!Object.keys(i.params).length;
  const a=ACTIONS[i.action];if(!a||a.kind!==i.kind||(a.targets.length?!a.targets.includes(i.target):i.target!==null))return false;
  return i.kind==='toggle'?Object.keys(i.params).length===1&&i.params.on===a.value:Object.keys(i.params).length===0;
 });
}
export function validateContext(input){
 if(!keys(input,['level','mode','dictionary','theme','items','held','posture','position','attributes'])||!['creator','home'].includes(input.level)||!['free','grammar'].includes(input.mode)||typeof input.dictionary!=='boolean'||!['identity','home'].includes(input.theme)||!Array.isArray(input.items)||input.items.length>OBJECTS.length||new Set(input.items).size!==input.items.length||input.items.some(id=>!OBJECTS.includes(id))||!(input.held===null||input.items.includes(input.held))||!['standing','sitting','lying','sleeping'].includes(input.posture)||!Array.isArray(input.position)||input.position.length!==2||!input.position.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!plain(input.attributes))return false;
 return Object.entries(input.attributes).every(([f,v])=>own(catalogs,f)&&(v===null||own(catalogs[f],v)));
}
export function safeContext({level='home',mode='free',dictionary=true,theme,items=[],held=null,posture='standing',position=[.5,.5],attributes={}}={}){
 return {level,mode,dictionary,theme:theme||(level==='home'?'home':'identity'),items:[...items],held,posture,position:position.map(v=>Math.round(v*1000)/1000),attributes:Object.fromEntries(Object.keys(catalogs).map(f=>[f,attributes[f]||null]))};
}
export function validateForWorld(document,context,{legacyBatch=false}={}){
 if(!validateDocument(document,context.level))return {ok:false,reason:'invalid',message:'Ответ интерпретатора не прошёл проверку.'};
 if(document.status!=='resolved')return {ok:false,reason:document.reason};
 if(context.level==='home'&&document.intents.length>1&&!legacyBatch)return {ok:false,reason:'multiple-actions',message:'Вижу несколько действий. Давай выполним их по одному.'};
 for(const i of document.intents){
  if(i.speechAct==='question'||i.speechAct==='prohibition'||i.speechAct==='description'||i.speechAct==='unknown'||i.tense==='past'||i.tense==='unknown'||i.polarity!=='positive'&&!(i.kind==='remove'&&i.polarity==='negative'))return {ok:false,reason:'unsafe',message:'Это описание, вопрос или отрицание — новое действие не запускается.'};
  if(i.tense==='dictionary'&&!context.dictionary)return {ok:false,reason:'unsupported',message:'В этом режиме нужна полная фраза.'};
  if(context.level==='home'){
   if(i.kind!=='create'&&i.target&&!context.items.includes(i.target))return {ok:false,reason:'missing',message:'Нужен предмет: '+NOUNS[i.target][0]+'. Сначала добавь его в комнату.'};
   if(i.kind==='lesson'){const missing=ACTIONS[i.action].requires.filter(id=>!context.items.includes(id));if(missing.length)return {ok:false,reason:'missing',message:'Для действия нужны: '+missing.map(id=>NOUNS[id][0]).join(', ')+'. Сначала добавь их в комнату.'};}
   if(i.kind==='stand_up'&&context.posture==='standing')return {ok:false,reason:'already',message:'Герой уже стоит.'};
  }
 }
 return {ok:true,reason:'supported'};
}
export function engineCommand(document,raw){
 const commands=document.intents.map(i=>{
  if(i.kind==='greet')return {ok:true,action:'greet',canonical:'안녕하세요',heard:raw,text:raw};
  if(i.kind==='set_character_attributes')return Object.entries(i.attributes).map(([field,value])=>({ok:true,action:'set',field,value,canonical:catalogs[field][value].ko+'입니다',heard:raw,text:raw}));
  return {action:i.kind,item:i.kind==='lesson'?i.action:i.target,...(i.kind==='toggle'?{value:i.params.on}:{})};
 }).flat();
 if(commands[0]?.ok)return {...commands[0],...(commands.length>1?{commands}:{}),heard:raw,intents:commands.filter(c=>c.action==='set').map(c=>({field:c.field,value:c.value}))};
 return {ok:true,heard:raw,commands,reason:'language-intent'};
}
