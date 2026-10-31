import { catalogs } from './catalog.js';
const compact=t=>t.replace(/\s+/gu,'');
const entries=Object.entries(catalogs).flatMap(([field,items])=>Object.entries(items).map(([value,item])=>({field,value,...item})));
const neutral=/(만나서반갑습니다|날씨가좋아요|안녕하세요|안녕|반갑습니다|반가워요|감사합니다|고맙습니다|여기|지금|정말|사실|오늘|그리고|하지만|또|저기)/gu;
const reject=(reason,message)=>({ok:false,type:'meaning',reason,message,intents:[]});
function subject(prefix,context){
  const body=prefix.replace(neutral,'').replace(/[.,!。！，\s]/gu,'');
  if(!body)return true;
  const match=body.match(/^(.*?)(은|는|이|가)$/u);if(!match)return false;
  const who=match[1];
  if(['저','나','이사람','이남자','이여자','남자','여자'].includes(who)){
    const gender=who.includes('남자')?'male':who.includes('여자')?'female':null;
    return !gender||!context.gender||context.gender===gender;
  }
  const name=compact(context.name||''),aliases=/^alex$/iu.test(name)?[name,'알렉스']:[name];
  return Boolean(name)&&aliases.some(alias=>who===alias||who===alias+'씨');
}
export function semanticMeaning(raw,context={},simple){
  const text=String(raw||'').normalize('NFC').trim(),body=compact(text);
  if(/[가-힣]/u.test(body)&&/[?？]|입니까|인가요/u.test(body))return reject('question','Это вопрос. Скажи утверждение о герое.');
  if(/아니|않|없|말고|아닌|라면|일수|일지도|거나|또는|혹은|라고|["“”「」]/u.test(body))return reject('negative-or-uncertain','В записи есть отрицание или неоднозначность. Скажи одно ясное утверждение о герое.');
  const claims=[];
  for(const entry of entries){
    const noun=compact(entry.ko),names=entry.field==='country'?[noun,noun.replace(/사람$/u,'인')]:[noun];
    for(const name of names)for(const match of body.matchAll(new RegExp(name+'(이에요|이예요|예요|에요|입니다|이고|이다|이야|야|이죠|죠)','gu')))claims.push({...entry,start:match.index,end:match.index+match[0].length,ending:match[1],noun:name});
  }
  claims.sort((a,b)=>a.start-b.start||b.end-a.end);if(!claims.length)return null;
  let previous=0;const values=new Map(),commands=[];
  for(const claim of claims){
    if(claim.start<previous)continue;
    if(!subject(body.slice(previous,claim.start),{...context,gender:values.get('gender')||context.gender}))return reject('other-or-ambiguous-subject','Неясно, относится ли это к нашему герою. Используй 저는, 이 사람은 или имя героя.');
    if(values.has(claim.field)&&values.get(claim.field)!==claim.value)return reject('conflicting-claims','В записи разные значения одной характеристики. Уточни одно значение.');
    const code=claim.ko.charCodeAt(claim.ko.length-1)-0xac00;
    const canonical=simple(claim.ko+(code>=0&&code%28!==0?'이에요':'예요'));
    const exact=simple(claim.noun+claim.ending);
    if(!context.voice&&!['입니다','이고','이다','이야','야','이죠','죠'].includes(claim.ending)&&!exact.ok)return exact;
    if(!values.has(claim.field)){values.set(claim.field,claim.value);commands.push({...canonical,text,reason:'unambiguous-hero-assertion'});}previous=claim.end;
  }
  const tail=body.slice(previous).replace(neutral,'').replace(/[.!。！,]/gu,'');
  if(claims.at(-1).ending==='이고'||tail&&!/^(요|네|잘부탁해요|날씨가좋아요)$/u.test(tail))return reject('unresolved-tail','Не удалось однозначно понять всё утверждение. Попробуй разделить его на короткие фразы.');
  return {...commands[0],text,reason:'unambiguous-hero-assertion',intents:commands.map(({field,value})=>({field,value})),...(commands.length>1?{commands}:{}),pronunciationAdjusted:Boolean(context.voice&&claims.some(c=>!simple(c.noun+c.ending).ok&&c.ending!=='입니다'))};
}
