import {ACTIONS,NOUNS,OBJECTS,catalogs} from './language-catalog.js';
import {makeIntent,documentOf} from './language-contract.js';
import {parseRoom} from './room-state.js';
import {parseKorean,interpretSpeech} from './parser.js';
export const normalizeText=raw=>String(raw??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
const compact=s=>s.replace(/[\s.!。！,，]/gu,'');
const result=(document,extra={})=>({document,terminal:document.status!=='unresolved',candidates:[],hint:null,...extra});
const blocked=(reason='unsafe',extra={})=>result(documentOf('blocked',[],reason),extra);
const unresolved=reason=>result(documentOf('unresolved',[],reason||'unsupported'),{terminal:false});
export function grammarFeatures(text){
 const b=compact(text).replace(/^안녕하세요/u,'');
 const knownEnding=Object.values(ACTIONS).some(a=>a.forms.some(form=>b.endsWith(form)));
 const question=/[?？]|어디|누구|무엇|왜|언제|어떻게|(?:해도|셔도|어도)돼요/u.test(b)||!knownEnding&&/(?:까요|나요|습니까|입니까|인가요|니)$/u.test(b);
 const negative=/(?:^|\s)(?:안|못)(?:\s|$)/u.test(text)||/지(?:마|않|못)|아니|(?:안|못)(?=해|하|읽|먹|마시|마셔|공부|배우|배워|일하|일해|운동|만나|사요|봐|보|자|앉|누|일어|켜|꺼)/u.test(b);
 const past=/(?:았|었|했|였|샀|봤|잤|셨|났|왔|갔|웠|켰|껐)/u.test(b);
 const reported=/(?:라고|다고|다네요|대요|라면|으면|다면|겠|거예요|예정)|["“”「」]/u.test(b);
 return {speechAct:question?'question':negative?'prohibition':/(?:세요|주세요)$/u.test(b)?'instruction':'statement',polarity:negative?'negative':'positive',tense:past?'past':Object.values(ACTIONS).some(a=>a.forms.some(form=>form.endsWith('다')&&b.endsWith(form)))||/이다$/u.test(b)?'dictionary':'present',unsafe:question||negative||past||reported};
}
function hero(raw,context,{voice=false,profile={}}={}){
 const text=normalizeText(raw),b=compact(text),features=grammarFeatures(text),who={...context.attributes,...profile};
 const prior=voice?interpretSpeech([{text}],who):parseKorean(text,who);
 if(prior.ok){
  const claims=prior.commands||[prior];const attrs=Object.fromEntries(claims.filter(c=>c.action==='set').map(c=>[c.field,c.value]));
  return result(documentOf('resolved',[makeIntent(prior.action==='greet'?'greet':'set_character_attributes',null,prior.action==='greet'?'greet':'set_character_attributes',attrs,{},features)]),{legacy:prior});
 }
 if(prior.reason==='conflicting-claims')return result(documentOf('clarify',[],'ambiguous'));if(features.unsafe)return blocked('unsafe');
 if(voice&&!/(?:이에요|예요|입니다|이고|이다|이야|야|죠|해요|아요|어요)[.!。！]*$/u.test(b)&&!/^(안녕하세요|안녕)$/u.test(b))return result(documentOf('unresolved',[],'incomplete'),{terminal:true});
 if(prior.type==='incomplete')return result(documentOf('unresolved',[],'incomplete'),{terminal:true});
 if(prior.type==='form'&&prior.field){const value=prior.value;return result(documentOf('resolved',[makeIntent('set_character_attributes',null,'set_character_attributes',{[prior.field]:value})]),{hint:'Распознавание могло изменить окончание. Учебный образец: '+prior.correction});}
 const entries=Object.entries(catalogs).flatMap(([field,items])=>Object.entries(items).map(([value,item])=>({field,value,noun:compact(item.ko)})));
 const body=b.replace(/^안녕하세요/u,'');
 const knownSubjects=['저는','나는','제가','내가','이사람은','이사람이','저의국적은','제국적은','저의직업은','제직업은'];
 const name=compact(profile.name||'');if(name){for(const suffix of ['씨는','씨가','은','는','이','가'])knownSubjects.unshift(name+suffix);}
 let content=body;const subject=knownSubjects.find(s=>content.startsWith(s));if(subject)content=content.slice(subject.length);
 // Unknown people and quoted/reported claims never become attributes of this hero.
 if(/(?:친구|엄마|아빠|그사람|민수|동생|형|누나)(?:은|는|이|가)/u.test(content)||/[.!。]\s*[^.。]{1,15}(?:은|는|씨가)/u.test(text.replace(/저는|나는|제가|이 사람은/gu,'')))return blocked('unsafe');
 if(!subject&&/^[가-힣]{2,12}(?:씨는|씨가|는|은)/u.test(content)&&!entries.some(e=>content.startsWith(e.noun)))return blocked('unsafe');
 const attrs={},spans=[];let conflict=false;
 const add=(field,value,start,end)=>{if(attrs[field]&&attrs[field]!==value)conflict=true;attrs[field]=value;spans.push([start,end]);};
 for(const e of entries){
  const nouns=e.field==='country'?[e.noun,e.noun.replace(/사람$/u,'인')]:[e.noun];
  for(const noun of nouns)for(const m of content.matchAll(new RegExp(noun+'(?:이에요|예요|입니다|이고|이다|이야|야|이죠|죠)','gu')))add(e.field,e.value,m.index,m.index+m[0].length);
  if(e.field==='country'){
   const root=e.noun.replace(/사람$/u,'');for(const m of content.matchAll(new RegExp(root+'(?:이며|이에요|예요|입니다)','gu')))add(e.field,e.value,m.index,m.index+m[0].length);const job=Object.values(catalogs.profession).map(p=>compact(p.ko)).join('|');
   for(const m of content.matchAll(new RegExp(root+'(?=(?:'+job+')(?:이에요|예요|입니다|이고))','gu')))add(e.field,e.value,m.index,m.index+m[0].length);
  }
 }
 if(conflict)return result(documentOf('clarify',[],'ambiguous'));
 if(Object.keys(attrs).length){
  if(!/(?:이에요|예요|입니다|이죠|죠|해요|아요|어요|이다|이야|야)$/u.test(content))return result(documentOf('unresolved',[],'incomplete'),{terminal:true});
  let unknown=content.split('');for(const [start,end] of spans)for(let n=start;n<end;n++)unknown[n]='';
  const tail=unknown.join('').replace(/이고|그리고|감사합니다|정말|오늘|저는/gu,'');
  return result(documentOf('resolved',[makeIntent('set_character_attributes',null,'set_character_attributes',attrs,{},features)]),{hint:tail?'Понятные характеристики сохранены; остальные слова не оценивались.':null});
 }
 return unresolved();
}
function nounSpans(text,id){
 const spans=[];for(const noun of NOUNS[id]){let start=-1;while((start=text.indexOf(noun,start+1))>=0){const before=text.slice(0,start),after=text.slice(start+noun.length);if((!before||/[\s,.。]$/u.test(before)||/(?:있는|보이는|놓인|놓여있는|위에|옆에|그리고|하고)$/u.test(before))&&(!after||/^(?:\s|을|를|이|가|은|는|에|의|좀|마시|마셔|읽|먹|봐|보|앉|자|누|집|놓|있|없|켜|꺼)/u.test(after)))spans.push({noun,start,after});}}return spans;
}
export function anchored(intent,text,context){
 const b=compact(text),a=ACTIONS[intent.action];
 if(intent.kind==='greet')return /안녕/u.test(b);
 if(intent.kind==='set_character_attributes')return Object.entries(intent.attributes).every(([field,value])=>{const noun=compact(catalogs[field][value].ko);return field==='country'?new RegExp(noun.replace(/사람$/u,'')+'(?:사람|인|이에요|입니다|예요|이고|'+Object.values(catalogs.profession).map(p=>p.ko).join('|')+')','u').test(b):new RegExp(noun+'(?:이에요|예요|입니다|이고|이다|이야|야|죠)','u').test(b);});
 const spans=id=>nounSpans(normalizeText(text),id),explicit=intent.target&&spans(intent.target).length>0;
 if(['create','remove'].includes(intent.kind))return explicit&&new RegExp(intent.kind==='create'?'있':'없','u').test(b)&&!/(?:에|에서)(?:있|없)/u.test(b);
 if(!a||!a.roots.some(root=>b.includes(root)))return false;
 if(intent.kind==='lesson')return intent.action==='meet'?b.includes('친구'):intent.action==='movie'?b.includes('영화'):intent.action==='shop'?b.includes('옷'):true;
 if(!a.targets.length)return true;
 const mentioned=OBJECTS.filter(id=>spans(id).some(s=>!/^\s*(?:위에|옆에|아래에|에|에서|의)/u.test(s.after)));
 if(explicit)return mentioned.every(id=>id===intent.target);
 if(/[가-힣]{2,}(?:을|를)/u.test(b))return false;
 const candidates=a.targets.filter(id=>context.items.includes(id));return !mentioned.length&&(candidates.length===1&&candidates[0]===intent.target||context.held===intent.target&&a.targets.includes(context.held));
}

function analyzeLocalImpl(raw,context,options={}){
 const normalized=normalizeText(raw),text=compact(normalized),f=grammarFeatures(normalized);
 if(!normalized||normalized.length>500||!/[가-힣]/u.test(normalized))return result(documentOf('unresolved',[],'unsupported'),{terminal:true});
 if(context.level==='home'){
  const chain=text.match(/^책을?(안)?읽고(.+)$/u);if(chain){const after=chain[2],features=grammarFeatures(after);let next=null;for(const [id,a] of Object.entries(ACTIONS))if(a.kind==='use'&&a.roots.some(r=>after.includes(r)))for(const target of a.targets)if(NOUNS[target].some(n=>after.includes(n)))next=makeIntent(a.kind,target,id,{},{},features);if(next)return result(documentOf('blocked',[makeIntent('use','book','read',{},{},{polarity:chain[1]?'negative':'positive'}),next],'multiple-actions'));}
 }
 if(f.unsafe)return blocked('unsafe');
 if(context.level==='home'&&/(?:가서|한뒤|한후|다음에|하고나서|해서).+/u.test(text))return blocked('multiple-actions');
 if(context.level==='creator')return {...hero(raw,context,options),normalized};
 let body=text.replace(/^안녕하세요/u,'').replace(/^(?:저는|나는|제가|내가)/u,'');
 const firstNoun=OBJECTS.map(id=>NOUNS[id].map(n=>body.indexOf(n))).flat().filter(i=>i>=0).sort((a,b)=>a-b)[0];
 const prefix=firstNoun===undefined?body:body.slice(0,firstNoun);
 if(/^(?:친구|엄마|아빠|그사람|민수|영희|동생|선생님)(?:은|는|이|가)/u.test(body)||/^[가-힣]{2,7}(?:씨는|씨가|는|은)$/u.test(prefix)&&!/(?:있는|보이는|지금은|오늘은)$/u.test(prefix))return blocked('unsafe');
 // Existential and locative statements are intentionally kept distinct.
 for(const id of OBJECTS)for(const noun of NOUNS[id]){
  const match=body.match(new RegExp('^'+noun+'(이|가|에|에서)?(있어요|있습니다|없어요|없습니다)$','u'));if(!match)continue;
  if(['에','에서'].includes(match[1])){
   const candidate=makeIntent('create',id,'create');return result(documentOf('clarify',[], 'location'),{candidates:!context.items.includes(id)&&match[2].startsWith('있')?[candidate]:[],usesContext:true});
  }
  const kind=match[2].startsWith('없')?'remove':'create';return result(documentOf('resolved',[makeIntent(kind,id,kind,{},{},{...f,polarity:kind==='remove'?'negative':'positive'})]));
 }
 const prior=parseRoom(normalized);
 if(prior.ok){
  const intents=prior.commands.map(c=>{
   if(['create','remove'].includes(c.action))return makeIntent(c.action,c.item,c.action,{},{},{...f,polarity:c.action==='remove'?'negative':'positive'});
   const action=c.action==='lesson'?c.item:c.action==='use'?Object.keys(ACTIONS).find(id=>ACTIONS[id].kind==='use'&&ACTIONS[id].targets.includes(c.item)):c.action==='toggle'?(c.value?'on':'off'):c.action;
   return makeIntent(c.action,c.action==='lesson'?null:c.item,action,{},c.action==='toggle'?{on:c.value}:{},f);
  });const one=intents.length===1?intents[0]:null,a=one&&ACTIONS[one.action],omitted=one?.target&&a&&NOUNS[one.target].some(n=>a.forms.some(form=>body===n+form));return result(documentOf('resolved',intents),{legacyBatch:intents.length===2,hint:omitted?'Учебный образец: '+a.canonical(one.target)+'. Распознавание могло пропустить частицу; это не оценка речи.':null});
 }
 if(OBJECTS.some(id=>NOUNS[id].some(noun=>new RegExp('^'+noun+'(?:을|를|이|가|에)?$','u').test(body)))||['공부','운동','숙제','배우','마시'].includes(body))return result(documentOf('unresolved',[],'incomplete'),{terminal:true});
 if(/(?:있어요|없어요|있습니다|없습니다)$/u.test(body)&&!OBJECTS.some(id=>NOUNS[id].some(noun=>body.includes(noun))))return result(documentOf('unresolved',[],'unsupported'),{terminal:true});
 body=body.replace(/좀|한번|조금/gu,'');
 for(const [id,a] of Object.entries(ACTIONS)){
  if(a.kind==='lesson'&&a.forms.includes(body))return result(documentOf('resolved',[makeIntent('lesson',null,id,{},{},f)]));
  for(const form of a.forms){
   if(body===form){
    if(a.kind==='lesson')continue;
    if(!a.targets.length)return result(documentOf('resolved',[makeIntent(a.kind,null,id,{},{},f)]));
    const existing=a.targets.filter(target=>context.items.includes(target)),candidates=context.held&&a.targets.includes(context.held)?[context.held]:existing.length?existing:a.targets;
    if(candidates.length!==1)return result(documentOf('clarify',[],'ambiguous'),{candidates:candidates.map(target=>makeIntent(a.kind,target,id,{},{},f)),usesContext:true});
    return result(documentOf('resolved',[makeIntent(a.kind,candidates[0],id,{},a.kind==='toggle'?{on:a.value}:{},f)]),{usesContext:true});
   }
   for(const target of a.targets)for(const noun of NOUNS[target])for(const particle of ['',...a.particles])if(body===noun+particle+form){
    return result(documentOf('resolved',[makeIntent(a.kind,target,id,{},a.kind==='toggle'?{on:a.value}:{},f)]),{hint:particle?'':`Учебный образец: ${a.canonical(target)}. Распознавание могло пропустить частицу.`});
   }
  }
 }
 // A bounded diagnostic representation for two familiar ordered actions; execution is deferred.
 const chain=body.match(/^(책을?읽고)(.+)$/u);if(chain){const second=analyzeLocal(chain[2],context,options);if(second.document.status==='resolved')return result(documentOf('blocked',[makeIntent('use','book','read'),...second.document.intents],'multiple-actions'));}
 if(/(?:읽고|먹고|마시고|집어서|놓고|다음|면서|하고|만나고).+/u.test(body))return blocked('multiple-actions');
 return {...unresolved(),normalized};
}

export function analyzeLocal(raw,context,options={}){return {...analyzeLocalImpl(raw,context,options),features:grammarFeatures(normalizeText(raw)),normalized:normalizeText(raw)};}
