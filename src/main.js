import {VoiceHealth} from './voice-health.js';
import {VoiceDiagnostics,STAGE_LABELS,ERROR_MESSAGES} from './voice-diagnostics.js';
import {interpretRussian} from './russian-test.js';
import {SpeechError} from './stt-client.js';
import { parseKorean, interpretSpeech } from './parser.js';
import { catalogs } from './catalog.js';
import { WorldState } from './world.js';
import { Renderer } from './renderer.js';
import { ActionController } from './controller.js';
import { BrowserSpeech } from './speech.js';
import { RoomState, RoomController, parseRoom,ROOM_ITEMS } from './room-state.js';
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
let recordedMs=0,voiceStage='idle';
const diagnostics=new VoiceDiagnostics();
diagnostics.onChange=()=>{$('#voice-report').value=diagnostics.report();};
$('#voice-report').value=diagnostics.report();
const health=new VoiceHealth({onChange:connection=>{diagnostics.update({serverState:connection.state==='ready'?(connection.configured?'Сервер готов (проверка доступности)':'Сервер готов, STT не настроен'):connection.state,serverHttp:connection.httpStatus,serverAttempts:connection.attempt,serverError:connection.error});refresh();}});
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
  const processing=['stopping','processing','executing'].includes(speechPhase);
  $('#mic').disabled=!speech?.supported||Boolean(speech?.active&&!listening)||(!listening&&(!health.ready||Boolean(speech?.pending)));
  $('#mic').classList.toggle('listening',listening);$('#mic').classList.toggle('processing',processing||busy&&!listening);$('#mic').classList.toggle('error',voiceError);
  $('#mic').setAttribute('aria-label',listening?'Завершить запись и распознать':speech?.language==='ru'?'Начать запись речи на русском':'Начать запись корейской речи');
  $('#mic').setAttribute('aria-pressed',String(listening));
  $('#cancel-recording').hidden=!voiceBusy&&!speech?.pending;$('#cancel-recording').textContent=!voiceBusy&&speech?.pending?'Удалить запись':processing?'Отменить отправку':'Отменить запись';
  $('#retry-audio').hidden=!speech?.pending||voiceBusy;$('#retry-audio').disabled=!health.ready;$('#stt-language').disabled=voiceBusy||Boolean(speech?.pending);
  $('#voice-connection').dataset.state=health.state;$('#connection-label').textContent=health.state==='connecting'?'Подключаем голосовое управление…':health.state==='ready'?(health.configured?'Сервер готов':'Сервер готов · распознавание не настроено'):health.state==='error'?(ERROR_MESSAGES[health.error]||ERROR_MESSAGES['server-unavailable']):'Подключаем голосовое управление…';
  $('#connection-retry').hidden=health.state!=='error'&&!(health.state==='ready'&&!health.configured);
  $('#transcript').lang=$('#stt-language').value;
  $('#command').placeholder=$('#stt-language').value==='ru'?(mode==='home'?'Или напиши: Создай книгу':'Или напиши: Привет'):(mode==='home'?'Или напиши: 책이 있어요':'Или напиши: 학생이에요');
  $('#submit').disabled=voiceBusy;$('#repeat').disabled=!last||voiceBusy;
  if(listening)$('#status').textContent='Слушаю';
  else if(speechPhase==='requesting')$('#status').textContent='Разрешите микрофон';
  else if(processing)$('#status').textContent='Обрабатываю';
  else if(busy)$('#status').textContent=activeController?.pending?`Обрабатываю · в очереди ${activeController.pending}`:'Обрабатываю';
  else $('#status').textContent=voiceError?'Повторить':STAGE_LABELS[voiceStage]||'Готов';
  if(!voiceBusy&&!busy&&!speech?.pending&&!health.ready)$('#status').textContent=health.state==='connecting'?'Подключаем…':health.state==='ready'?'Голос не настроен':'Голос недоступен';
  if(!listening&&speech?.active&&STAGE_LABELS[voiceStage])$('#status').textContent=STAGE_LABELS[voiceStage];
  if(!voiceBusy&&speech?.pending)$('#speech-help').textContent='Запись сохранена. Повторите отправку или удалите её для новой записи.';
  if(listening){const seconds=Math.floor(recordedMs/1000);$('#speech-help').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Нажми ещё раз, когда закончишь`;}
  else if(processing)$('#speech-help').textContent='Распознаём полную запись';
  else if(speech?.supported&&!speech.pending)$('#speech-help').textContent='Первое нажатие — запись, второе — отправка';
  $('#scene-caption').textContent=profile.awake?'Теперь это твой герой.':'Разбуди его одним словом.';
  $('#context-hint').textContent=profile.awake?'Например: 저는 학생이에요 — «Я ученик»':'Скажи «안녕하세요» — «Здравствуйте»';
  $('#scene').setAttribute('aria-label',`${profile.awake?'Стоящий':'Спящий'} стикмен. ${Object.entries(catalogs).map(([field,catalog])=>catalog[profile[field]]?.label).filter(Boolean).join(', ')}`);
  if(mode==='home'){
    for(const id of Object.keys(ROOM_ITEMS)){const placement=room.items[id];$(`#room-${id}`).textContent=placement==='hand'?'В руке':placement==='table'?'На столе':placement==='surface'?'На кровати':placement==='floor'?(id==='lamp'?(room.objects.lamp.state.on?'Включена':'Выключена'):(room.objects[id].type==='portable'?'На полу':'В комнате')):'Пока нет';$(`#room-${id}`).classList.toggle('present',Boolean(placement));}
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
    refresh();return result;
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
  refresh();return result;
}
speech=new BrowserSpeech({
  onStatus:(phase,details)=>{
    speechPhase=phase;recordedMs=details?.elapsedMs||0;voiceError=false;
    if(phase==='requesting'){$('#transcript').textContent='…';feedback('Говори спокойно: паузы можно делать любой длины. Закончив, нажми микрофон ещё раз.');}
    if(phase==='processing')feedback('Запись готова. Подготавливаем отправку.');
    refresh();
  },
  beforeUpload:()=>{if(!health.ready)throw new SpeechError(health.state==='ready'?'not-configured':'server-unavailable',{stage:'audio_ready',source:'Render'});},
  onStage:(stage,details)=>{
    if(stage==='timing'){diagnostics.update(details);return;}
    voiceStage=stage;if(['uploading','processing'].includes(stage))feedback(STAGE_LABELS[stage]);diagnostics.stage(stage,{...details,...(details.elapsedMs!==undefined?{durationMs:details.elapsedMs}:{})});refresh();
  },
  onFinal:async text=>{
    const voiceSession=speech.session;
    const command=selectedCommand(text,true);diagnose(text,command,'Groq');$('#command').value=text;
    diagnostics.update({transcript:text,action:command.ok?describeAction(command):'не определено'});
    if(!command.ok){await execute(command);if(speech.session!==voiceSession)return;diagnostics.update({result:'Команда не определена'});return {error:'unknown-command'};}
    speech.stage('executing');const result=await execute(command),results=Array.isArray(result)?result:[result],failure=results.find(r=>r?.cancelled||r?.type==='error'||r?.type==='queue');
    if(speech.session!==voiceSession)return;
    diagnostics.update({result:failure?.message||(failure?.cancelled?'Действие отменено':results.map(r=>r?.message).filter(Boolean).join(' · ')||'Выполнено')});
    return failure?{error:'game-error'}:{ok:true,message:diagnostics.data.result};
  },
  onError:code=>{
    voiceError=true;
    const message=code==='unknown-command'?`Я услышал «${String(diagnostics.data.transcript||'').slice(0,200)}», но не понял команду.`:ERROR_MESSAGES[code]||'Не удалось распознать речь. Попробуйте ещё раз.';
    feedback(message+(speech.pending?' Запись сохранена до повторной отправки или удаления.':''),'error');refresh();
  },
  onEnd:()=>{speechPhase='idle';refresh();},
});
$('#hero-name').value=world.profile.name;
$('#hero-name').addEventListener('input',event=>{world.setName(event.target.value);});
function diagnose(raw,command,source){
  if(new URLSearchParams(location.search).get('debug')==='1')console.info('[Korean Stickman interpretation]',{source,raw,accepted:command.ok,intents:command.intents||[],reason:command.reason||command.type||'unknown'});
}
function selectedCommand(text,voice=false){return $('#stt-language').value==='ru'?interpretRussian(text,{home:mode==='home',profile:world.profile,voice}):mode==='home'?parseRoom(text,{debug:!voice&&roomRenderer.debug}):voice?interpretSpeech([{text}],world.profile):parseKorean(text,world.profile);}
function describeAction(command){const list=command.commands||[command];return list.map(c=>c.item?`${c.action} ${c.item}`:c.field?`${c.action} ${c.field}=${c.value}`:c.action||c.reason||'unknown').join(' → ');}
$('#command-form').onsubmit=event=>{event.preventDefault();if(!speech.active){const raw=$('#command').value,command=selectedCommand(raw);diagnose(raw,command,'manual');execute(command);}};
$('#mic').onclick=()=>{voiceError=false;if(speech.recording)speech.stop();else if(!speech.active&&health.ready){diagnostics.begin(speech.language);speech.start();}refresh();};
$('#connection-retry').onclick=()=>health.check();
$('#retry-audio').onclick=()=>{if(health.ready&&!speech.active){voiceError=false;diagnostics.update({error:null,failureStage:null,httpStatus:null,waitMs:0,result:'Повторная отправка по нажатию пользователя'});speech.retry();}};
$('#stt-language').onchange=event=>{if(speech.setLanguage(event.target.value)){if(diagnostics.data.stage==='idle')diagnostics.begin(speech.language);last=null;feedback(event.target.value==='ru'?'Русский тестовый режим. Можно говорить или писать простые русские команды.':'Корейский режим. Состояние героя и комнаты сохранено.');}refresh();};
$('#copy-voice-report').onclick=async()=>{try{await navigator.clipboard.writeText(diagnostics.report());$('#copy-report-status').textContent='Отчёт скопирован';}catch{$('#voice-report').focus();$('#voice-report').select();$('#copy-report-status').textContent='Выделено: скопируйте текст вручную';}};
window.addEventListener('beforeunload',event=>{if(speech?.recording||speech?.pending){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')health.checkAfterIdle();});
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
  document.title=home?'Korean Stickman — Мой дом · V2.6':'Korean Stickman — Создай своего героя';
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

health.check();
