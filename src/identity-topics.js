export const MIN_AGE=1,MAX_AGE=120;
export const validAge=value=>Number.isInteger(value)&&value>=MIN_AGE&&value<=MAX_AGE;
export const ageBand=age=>!validAge(age)?'adult':age<=12?'child':age<=19?'teen':age>=60?'senior':'adult';
export const ageStyle=age=>({child:{scale:.76,head:1.16},teen:{scale:.9,head:1.06},adult:{scale:1,head:1},senior:{scale:.98,head:1}}[ageBand(age)]);
export const FAMILY={mother:{label:'엄마',aliases:['엄마','어머니'],female:true},father:{label:'아빠',aliases:['아빠','아버지']},grandmother:{label:'할머니',aliases:['할머니'],female:true,senior:true},grandfather:{label:'할아버지',aliases:['할아버지'],senior:true},older_brother:{label:'형 / 오빠',aliases:['형','오빠']},older_sister:{label:'누나 / 언니',aliases:['누나','언니'],female:true},younger_sibling:{label:'동생',aliases:['동생'],young:true}};
export const validFamily=ids=>Array.isArray(ids)&&ids.length<=7&&new Set(ids).size===ids.length&&ids.every(id=>Object.hasOwn(FAMILY,id));
export const familyLabel=(id,gender)=>id==='older_brother'?(gender==='female'?'오빠':gender==='male'?'형':FAMILY[id].label):id==='older_sister'?(gender==='female'?'언니':gender==='male'?'누나':FAMILY[id].label):FAMILY[id]?.label||'';
export function koreanNumber(raw){
 const word=raw.replace(/\s/gu,'');if(/^\d{1,3}$/u.test(word))return Number(word);
 const ones={한:1,하나:1,두:2,둘:2,세:3,셋:3,네:4,넷:4,다섯:5,여섯:6,일곱:7,여덟:8,아홉:9};if(Object.hasOwn(ones,word))return ones[word];
 const tens={열:10,스무:20,스물:20,서른:30,마흔:40,쉰:50,예순:60,일흔:70,여든:80,아흔:90};for(const [prefix,value]of Object.entries(tens))if(word.startsWith(prefix)){const rest=word.slice(prefix.length);if(!rest)return value;if(Object.hasOwn(ones,rest)&&prefix!=='스무')return value+ones[rest];}
 const sino={일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};const match=word.match(/^(백)?(?:([일이삼사오육칠팔구])?십)?([일이삼사오육칠팔구])?$/u);if(match&&word)return (match[1]?100:0)+(word.includes('십')?(sino[match[2]]||1)*10:0)+(sino[match[3]]||0);return null;
}
const stripSubject=(s,profile)=>{let prefixes=['저는','나는','제가','내가','이사람은','이사람이','남자는','남자가','여자는','여자가'];const name=String(profile.name||'').replace(/\s/gu,'');if(name)prefixes=[...['씨는','씨가','은','는','이','가'].map(p=>name+p),...prefixes];const prefix=prefixes.find(p=>s.startsWith(p));return prefix?s.slice(prefix.length):s;};
export function parseIdentityTopics(raw,profile={}){
 if(!/(?:살|세(?:이에요|예요|에요|입니다|이야)|나이|몇살|엄마|어머니|아빠|아버지|할머니|할아버지|오빠|누나|언니|동생|형)/u.test(raw))return null;
 const commands=[],rest=[];for(const clause of raw.normalize('NFKC').split(/[.!。！]+/u).map(s=>s.trim()).filter(Boolean)){
  let s=stripSubject(clause.replace(/\s/gu,''),profile);
  const isAge=/(?:살|세(?:이에요|예요|에요|입니다|이야)|나이)/u.test(s),isFamily=Object.values(FAMILY).some(item=>item.aliases.some(a=>s.includes(a)));
  if(!isAge&&!isFamily){rest.push(clause);continue;}
  if(/[?？]|몇|누구|습니까|까요|나요|아니|않|없었|있었|라고|다고|했|였|안있|안없/u.test(s))return {error:'unsafe'};
  if(isAge){s=s.replace(/^(?:나이는|제나이는)/u,'');const m=s.match(/^([가-힣0-9]+)(살|세)(?:이에요|예요|입니다|이야)$/u);if(!m)return {error:'incomplete'};const age=koreanNumber(m[1]);if(!validAge(age))return {error:'invalid'};commands.push({kind:'set_age',age});continue;}
  s=s.replace(/^(?:우리가족은|우리가족에|우리가족에는)/u,'');const m=s.match(/^(.+?)(?:이|가)?(있어요|없어요|있습니다|없습니다)$/u);if(!m)return {error:'incomplete'};
  const nouns=m[1].split(/하고|이랑|랑|와|과|,/u),members=[];if(nouns.some(noun=>!noun))return {error:'incomplete'};for(const noun of nouns){const item=Object.entries(FAMILY).find(([,v])=>v.aliases.includes(noun));if(!item)return {error:'unsafe'};members.push(item[0]);}if(!members.length)return {error:'invalid'};commands.push({kind:'family',members:[...new Set(members)],present:m[2].startsWith('있')});
 }
 const ages=commands.filter(c=>c.kind==='set_age');if(new Set(ages.map(c=>c.age)).size>1)return {error:'ambiguous'};
 for(const id of Object.keys(FAMILY))if(new Set(commands.filter(c=>c.kind==='family'&&c.members.includes(id)).map(c=>c.present)).size>1)return {error:'ambiguous'};
 return {commands,rest:rest.join('. ')};
}
