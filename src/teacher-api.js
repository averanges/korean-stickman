export const roomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export const roomId=()=>crypto.randomUUID?.()||roomToken().slice(0,32);
export class LessonError extends Error{constructor(code,status=0){super(code);this.code=code;this.status=status;}}
export class LessonApi{
 constructor(base,{fetcher=(...a)=>fetch(...a),timeoutMs=6000}={}){this.base=base;this.fetcher=fetcher;this.timeoutMs=timeoutMs;}
 async request(path,body={},credential,options={}){
  if(!this.base)throw new LessonError('service-unconfigured');
  const controller=new AbortController();let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new LessonError('network-timeout'));controller.abort();},this.timeoutMs);});
  try{return await Promise.race([(async()=>{const response=await this.fetcher(this.base+'/teacher-api/rooms'+path,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:controller.signal,...options});let data;try{data=await response.json();}catch{throw new LessonError('invalid-response',response.status);}if(!response.ok)throw new LessonError(typeof data.error==='string'?data.error:'network-error',response.status);return data;})(),timeout]);}
  catch(error){throw error instanceof LessonError?error:new LessonError('network-error');}finally{clearTimeout(timer);}
 }
}
export const LESSON_MESSAGES={'server-version-mismatch':'Нужен отдельный сервис Teacher Mode 0.3. Перезапустите его на порту 8083 и создайте новый урок.','service-unconfigured':'Адрес сервиса уроков пока не настроен.','invalid-data':'Сервис уроков отклонил данные игры. Возможно, он остался от старой версии: перезапустите npm run teacher:server на порту 8083 и создайте новый урок.','invalid-command':'Сервис уроков не поддерживает эту команду или её параметры. После обновления игры перезапустите npm run teacher:server и создайте новый урок.','lesson-ended':'Урок завершён или срок подключения истёк.','invalid-invitation':'Ссылка приглашения недействительна.','invitation-used':'Это приглашение уже использовано другим учеником.','student-active-elsewhere':'Урок уже открыт в другой вкладке. Закрой её, чтобы продолжить здесь.','lease-expired':'Восстанавливаем подключение…',forbidden:'Доступ к этому уроку отклонён.','rate-limit':'Слишком много запросов. Подключение повторится автоматически.','storage-unavailable':'Нужно разрешить временное хранилище браузера для этого урока.','locks-unavailable':'Для подключения нужен современный браузер с поддержкой защиты от второй вкладки.','network-error':'Нет связи с уроком. Пробуем восстановить…','network-timeout':'Сервис уроков не отвечает. Пробуем восстановить…'};
export const lessonMessage=error=>LESSON_MESSAGES[error?.code]||'Не удалось связаться с уроком.';
export function readSession(storage,key){try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}}
export function writeSession(storage,key,value){try{const data=JSON.stringify(value);storage.setItem(key,data);if(storage.getItem(key)!==data)throw Error();}catch{throw new LessonError('storage-unavailable');}}
export function consumeInvite(location=globalThis.location,history=globalThis.history){
 const params=new URLSearchParams(location.hash.slice(1)),invite=params.get('lesson');
 if(!invite)return null;
 history.replaceState(null,'',location.pathname+location.search);
 const [roomId,inviteToken,...extra]=invite.split('.');if(extra.length||!/^[a-f0-9]{32}$/u.test(roomId)||!/^[a-f0-9]{64}$/u.test(inviteToken))throw new LessonError('invalid-invitation');return {roomId,inviteToken};
}
