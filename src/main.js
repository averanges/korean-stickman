import { parseKorean, interpretSpeech } from './parser.js';
import { catalogs } from './catalog.js';
import { WorldState } from './world.js';
import { Renderer } from './renderer.js';
import { ActionController } from './controller.js';
import { BrowserSpeech } from './speech.js';
import { RoomState, RoomController, parseRoom } from './room-state.js';
import { RoomRenderer } from './room-renderer.js';
const $=selector=>document.querySelector(selector);
const world=new WorldState();
const renderer=new Renderer(world.profile);
const room=new RoomState();
const roomRenderer=new RoomRenderer(renderer,{onPhase:message=>{$('#room-caption').textContent=message;}});
const roomController=new RoomController(room,roomRenderer,{onChange:()=>refresh(),onProgress:command=>{
  $('#transcript').textContent=command.heard||'…';feedback(command.ok?'Герой тебя услышал. Смотри, что будет…':command.message);
}});
let controller, speech, last=null, revision=0, voiceError=false, speechPhase='idle', mode='creator';
let recordedMs=0;
const feedback=(message,type='')=>{$('#feedback').textContent=message;$('#feedback').dataset.type=type;};
function refresh(){
  const profile=world.profile;
  for(const field of ['gender','country','profession']){
    const node=$(`#profile-${field}`),text=catalogs[field][profile[field]]?.label||'—';
    if(node.textContent!==text){node.textContent=text;node.classList.remove('updated');void node.offsetWidth;node.classList.add('updated');}
    node.classList.toggle('empty',!profile[field]);
  }
  const activeController=mode==='home'?roomController:controller;
  const listening=speech?.recording||false,voiceBusy=speech?.active||false,busy=mode==='home'?roomController.busy:world.busy;
  const processing=['stopping','processing'].includes(speechPhase);
  $('#mic').disabled=!speech?.supported||processing||speechPhase==='requesting';
  $('#mic').classList.toggle('listening',listening);$('#mic').classList.toggle('processing',processing||busy&&!listening);$('#mic').classList.toggle('error',voiceError);
  $('#mic').setAttribute('aria-label',listening?'Завершить запись и распознать':'Начать запись корейской речи');
  $('#mic').setAttribute('aria-pressed',String(listening));
  $('#cancel-recording').hidden=!voiceBusy;$('#cancel-recording').textContent=processing?'Отменить отправку':'Отменить запись';
  $('#submit').disabled=voiceBusy;$('#repeat').disabled=!last||voiceBusy;
  if(listening)$('#status').textContent='Слушаю';
  else if(speechPhase==='requesting')$('#status').textContent='Разрешите микрофон';
  else if(processing)$('#status').textContent='Обрабатываю';
  else if(busy)$('#status').textContent=activeController?.pending?`Обрабатываю · в очереди ${activeController.pending}`:'Обрабатываю';
  else $('#status').textContent=voiceError?'Повторить':'Готов';
  if(listening){const seconds=Math.floor(recordedMs/1000);$('#speech-help').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Нажми ещё раз, когда закончишь`;}
  else if(processing)$('#speech-help').textContent='Распознаём полную запись';
  else if(speech?.supported)$('#speech-help').textContent='Первое нажатие — запись, второе — отправка';
  $('#scene-caption').textContent=profile.awake?'Теперь это твой герой.':'Разбуди его одним словом.';
  $('#context-hint').textContent=profile.awake?'Например: 저는 학생이에요 — «Я ученик»':'Скажи «안녕하세요» — «Здравствуйте»';
  $('#scene').setAttribute('aria-label',`${profile.awake?'Стоящий':'Спящий'} стикмен. ${Object.entries(catalogs).map(([field,catalog])=>catalog[profile[field]]?.label).filter(Boolean).join(', ')}`);
  if(mode==='home'){
    for(const id of ['desk','book','water']){const placement=room.items[id];$(`#room-${id}`).textContent=placement==='hand'?'В руке':placement==='table'?'На столе':placement==='floor'?'На полу':'Пока нет';$(`#room-${id}`).classList.toggle('present',Boolean(placement));}
    $('#room-hero-summary').textContent=[profile.name||'Твой герой',...Object.entries(catalogs).map(([field,catalog])=>catalog[profile[field]]?.label).filter(Boolean)].join(' · ');
    const op=roomController.operation;$('#room-operation').textContent=op?`${op.action} ${op.item} · ${op.status}${op.message?' · '+op.message:''}`:'Операций пока нет';
  }
}
controller=new ActionController(world,renderer,{
  onChange:refresh,
  onProgress:command=>{
    $('#transcript').textContent=command.heard||command.text||'…';
    feedback(command.ok?'Герой тебя услышал. Смотри, что будет…':command.message,command.ok?'':command.type);
  },
});
async function execute(command){
  if(mode==='home'){
    voiceError=false;if(command.ok)last=command;const current=revision;
    if(roomController.busy)feedback('Фраза в очереди. Герой сначала закончит движение.');
    const result=await roomController.run(command);
    if(!result.cancelled&&revision===current&&mode==='home'&&(!roomController.busy||result.type==='queue'))feedback(result.message,result.type);
    refresh();return;
  }
  if(command.commands){const revisionBefore=revision;const results=await Promise.all(command.commands.map(item=>execute({...item,heard:command.heard})));if(revision===revisionBefore){last=command;refresh();}return results;}
  voiceError=false;
  const current=revision;
  if(command.ok)last=command;
  if(world.busy)feedback('Фраза добавлена в очередь. Герой закончит движение и продолжит.');
  const result=await controller.run(command);
  if(result.cancelled||current!==revision||mode!=='creator')return;
  // Do not overwrite the next command's live feedback when its predecessor resolves.
  if(!world.busy||result.type==='queue')feedback(result.message,result.type);
  refresh();
}
speech=new BrowserSpeech({
  onStatus:(phase,details)=>{
    speechPhase=phase;recordedMs=details?.elapsedMs||0;voiceError=false;
    if(phase==='requesting'){$('#transcript').textContent='…';feedback('Говори спокойно: паузы можно делать любой длины. Закончив, нажми микрофон ещё раз.');}
    if(phase==='processing')feedback('Распознаём полную запись. Характеристики героя пока не меняются.');
    refresh();
  },
  onFinal:text=>{
    const command=mode==='home'?parseRoom(text):interpretSpeech([{text}],world.profile);
    diagnose(text,command,'Groq');
    $('#command').value=text;
    execute(command);
  },
  onError:code=>{
    voiceError=true;
    const messages={
      'not-allowed':'Доступ к микрофону закрыт. Разреши его в браузере или напиши фразу ниже.',
      'service-not-allowed':'Браузер запретил распознавание. Можно написать фразу вручную.',
      'audio-capture':'Микрофон не найден. Подключи его или используй поле ниже.',
      'no-speech':'Не удалось услышать речь. Нажми на микрофон и попробуй ещё раз.',
      network:'Распознавание недоступно. Проверь интернет или напиши фразу.',
      'service-unavailable':'Голосовой сервис временно недоступен или просыпается. Попробуй позже; ручной ввод работает, герой сохранён.',
      'api-unconfigured':'Адрес голосового сервиса не настроен. Ручной ввод работает, герой сохранён.',
      'language-not-supported':'Распознавание ko-KR недоступно в этом браузере. Используй ручной ввод.',
      'not-configured':'Добавь GROQ_API_KEY в локальный .env сервера. Ключ не нужно вводить на странице.',
      'empty-audio':'В записи не удалось обнаружить звук речи. Нажми микрофон и попробуй ещё раз.',
      'too-short':'Запись слишком короткая. Говори спокойно, затем нажми микрофон ещё раз.',
      'unclear':'Не удалось уверенно разобрать запись. Попробуй ещё раз — герой остаётся прежним.',
      'interrupted':'Браузер прервал запись. Она не отправлена. Нажми микрофон и попробуй ещё раз.',
      'unsupported-format':'Браузер не поддерживает подходящий формат записи. Используй другой браузер или ручной ввод.',
      'recording-error':'Не удалось записать звук. Проверь микрофон и попробуй ещё раз.',
      'provider-auth':'Сервер не смог подключиться к Groq. Проверь ключ в локальном .env.',
      'rate-limit':'Сервис распознавания просит немного подождать. Затем попробуй ещё раз.',
      'timeout':'Голосовой сервис не ответил вовремя. Он может просыпаться. Попробуй ещё раз или используй ручной ввод.',
      'too-large':'Запись слишком большая. Она не отправлена. Запиши более короткую попытку.',
    };
    feedback(messages[code]||'Не удалось распознать речь. Попробуй ещё раз или напиши фразу.','error');refresh();
  },
  onEnd:()=>{speechPhase='idle';refresh();},
});
$('#hero-name').value=world.profile.name;
$('#hero-name').addEventListener('input',event=>{world.setName(event.target.value);});
function diagnose(raw,command,source){
  if(new URLSearchParams(location.search).get('debug')==='1')console.info('[Korean Stickman interpretation]',{source,raw,accepted:command.ok,intents:command.intents||[],reason:command.reason||command.type||'unknown'});
}
$('#command-form').onsubmit=event=>{event.preventDefault();if(!speech.active){const raw=$('#command').value,command=mode==='home'?parseRoom(raw,{debug:roomRenderer.debug}):parseKorean(raw,world.profile);diagnose(raw,command,'manual');execute(command);}};
$('#mic').onclick=()=>{voiceError=false;if(speech.recording)speech.stop();else if(!speech.active)speech.start();refresh();};
$('#cancel-recording').onclick=()=>{speech.cancel();voiceError=false;feedback('Запись отменена. Она не отправлена; герой остаётся прежним.');refresh();};
$('#repeat').onclick=()=>{if(last)execute(last);};
$('#reset').onclick=()=>{
  if(mode==='home'){revision++;speech.cancel();roomController.reset();last=null;voiceError=false;$('#command').value='';$('#transcript').textContent='…';feedback('Комната снова пустая. Герой сохранил свои характеристики.');refresh();return;}
  revision++;speech.cancel();controller.reset();last=null;voiceError=false;$('#hero-name').value='';$('#command').value='';$('#transcript').textContent='…';
  changeLevel(false);feedback('Новая история начинается с приветствия. 안녕하세요!');refresh();
};
function changeLevel(home){
  revision++;speech.cancel();roomController.cancel();roomRenderer.visible=false;controller.cancel();world.save();
  mode=home?'home':'creator';last=null;voiceError=false;renderer.visible=!home;
  document.title=home?'Korean Stickman — Мой дом · V2.3':'Korean Stickman — Создай своего героя';
  $('#creator-stage').hidden=home;$('#home-stage').hidden=!home;$('#room-panel').hidden=!home;
  $('.profile-fields').hidden=home;$('.future').hidden=home;
  $('.hero-card h1').textContent=home?'Мой дом':'Создай своего героя';
  $('.card-subtitle').textContent=home?'Слова наполняют комнату':'Расскажи о нём по-корейски';
  $('.header-actions .level-tag b').textContent=home?'02':'01';
  $('#enter-world').textContent=home?'← К герою':'В мир →';
  $('.optional-note').textContent=home?'Характеристики героя сохранены':'Можно отправиться даже с пустой анкетой';
  $('#reset').setAttribute('aria-label',home?'Очистить комнату':'Начать заново');$('#reset').title=home?'Убрать предметы, сохранив героя':'Очистить сохранённого героя и начать заново';$('#reset span').textContent=home?'Очистить комнату':'Начать заново';
  $('#command').value='';$('#command').placeholder=home?'Или напиши: 책상이 있어요':'Или напиши: 학생이에요';$('#transcript').textContent='…';
  if(home){roomRenderer.visible=true;roomRenderer.synchronize();feedback(Object.values(room.items).some(Boolean)?'Твой дом сохранился. Можешь читать книгу, пить воду или менять предметы.':'Это твой дом. Начни с «책상이 있어요».');}
  else feedback('Твой герой сохранён. Его характеристики можно менять.');
  refresh();window.scrollTo({top:0,behavior:'instant'});
}
$('#enter-world').onclick=()=>changeLevel(mode!=='home');
$('#room-debug').onchange=event=>{roomRenderer.setDebug(event.target.checked);$('#room-debug-controls').hidden=!event.target.checked;};
if(!speech.supported){$('#speech-help').textContent='Запись недоступна — напиши фразу ниже';feedback('Браузер не поддерживает запись подходящего аудиоформата. Ручной ввод работает.');}
if(!world.storageAvailable)feedback('Сохранение недоступно. Герой останется в текущей вкладке.');
else if(world.profile.awake)feedback('С возвращением! Герой сохранён. Его характеристики можно менять.');
refresh();
if(new URLSearchParams(location.search).get('level')==='2')changeLevel(true);
