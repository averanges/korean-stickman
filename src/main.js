import {SttServers,publicOrigin} from './stt-servers.js';
import {createDiagnosticSpeech} from './stt-diagnostic.js';
import {SttConnection} from './stt-connection.js';
import {FailoverSttProvider} from './stt-failover.js';
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
let recordedMs=0,voiceStage='idle',testSpeech,serverChecks,retryingConnection=false;
const registry=new SttServers();
const testDiagnostics=new VoiceDiagnostics();
function fullReport(){return diagnostics.report()+'\n\n'+(serverChecks?.report()||'Серверы ещё не проверены')+'\n\nДиагностический STT без игровых действий\n'+testDiagnostics.report();}
function updateReports(){$('#voice-report').value=fullReport();}
const diagnostics=new VoiceDiagnostics();
diagnostics.onChange=updateReports;testDiagnostics.onChange=updateReports;updateReports();
const health=new SttConnection(registry,{isBusy:()=>Boolean(speech?.active||testSpeech?.active||(mode==='home'?roomController.busy:world.busy)),onChange:connection=>{
 const id=registry.selected,r=connection.checks.rows.get(id)||{};
 diagnostics.update({activeServer:id,serverState:connection.state,serverHttp:r.httpStatus,serverError:connection.error});updateReports();refresh();
}});

const feedback=(message,type='')=>{$('#feedback').textContent=message;$('#feedback').dataset.type=type;};
function refresh(){
  health.resume();
  const profile=world.profile;
  for(const field of ['gender','country','profession']){
    const node=$(`#profile-${field}`),text=catalogs[field][profile[field]]?.label||'—';
    if(node.textContent!==text){node.textContent=text;node.classList.remove('updated');void node.offsetWidth;node.classList.add('updated');}
    node.classList.toggle('empty',!profile[field]);
  }
  const activeController=mode==='home'?roomController:controller;
  const testBusy=Boolean(testSpeech?.active);
  const listening=speech?.recording||false,voiceBusy=speech?.active||false,busy=mode==='home'?roomController.busy:world.busy;
  const processing=['stopping','processing','executing'].includes(speechPhase);
  $('#mic').disabled=!speech?.supported||testBusy||Boolean(speech?.active&&!listening)||(!listening&&(!health.ready||Boolean(speech?.pending)));
  $('#mic').classList.toggle('listening',listening);$('#mic').classList.toggle('processing',processing||busy&&!listening);$('#mic').classList.toggle('error',voiceError);
  $('#mic').setAttribute('aria-label',listening?'Завершить запись и распознать':speech?.language==='ru'?'Начать запись речи на русском':'Начать запись корейской речи');
  $('#mic').setAttribute('aria-pressed',String(listening));
  $('#cancel-recording').hidden=!voiceBusy&&!speech?.pending;$('#cancel-recording').textContent=!voiceBusy&&speech?.pending?'Удалить запись':processing?'Отменить отправку':'Отменить запись';
  $('#record-again').hidden=!speech?.pending||voiceBusy;$('#record-again').disabled=!health.ready||testBusy;$('#retry-audio').hidden=!speech?.pending||voiceBusy;$('#retry-audio').disabled=!health.ready;$('#stt-language').disabled=voiceBusy||testBusy||Boolean(speech?.pending||testSpeech?.pending||testSpeech?.comparison);
  $('#voice-connection').dataset.state=health.state;$('#connection-label').textContent=health.state==='connecting'?'Подключаем голосовое управление…':health.state==='ready'?(health.configured?'Сервер готов':'Сервер готов · распознавание не настроено'):health.state==='error'?(ERROR_MESSAGES[health.error]||ERROR_MESSAGES['server-unavailable']):'Подключаем голосовое управление…';
  $('#connection-retry').hidden=health.state!=='error'&&!(health.state==='ready'&&!health.configured);
  $('#transcript').lang=$('#stt-language').value;
  $('#command').placeholder=$('#stt-language').value==='ru'?(mode==='home'?'Или напиши: Создай книгу':'Или напиши: Привет'):(mode==='home'?'Или напиши: 책이 있어요':'Или напиши: 학생이에요');
  $('#submit').disabled=voiceBusy||testBusy;$('#repeat').disabled=!last||voiceBusy||testBusy;
  renderServerPanel();
  if(listening)$('#status').textContent='Нажми, чтобы завершить';
  else if(speechPhase==='requesting')$('#status').textContent='Разрешите микрофон';
  else if(processing)$('#status').textContent=retryingConnection?'Пробуем другое подключение…':'Распознаём речь…';
  else if(busy)$('#status').textContent=activeController?.pending?`Обрабатываю · в очереди ${activeController.pending}`:'Обрабатываю';
  else $('#status').textContent=voiceError?'Повторить':voiceStage==='error'?'Повторить':'Нажми и скажи';
  if(!voiceBusy&&!busy&&!speech?.pending&&!health.ready)$('#status').textContent=health.state==='connecting'?'Подключаем…':health.state==='ready'?'Голос не настроен':'Голос недоступен';
  if(!listening&&speech?.active&&speechPhase!=='requesting')$('#status').textContent=retryingConnection?'Пробуем другое подключение…':'Распознаём речь…';
  if(!voiceBusy&&speech?.pending)$('#speech-help').textContent='Запись сохранена. Повторите отправку или удалите её для новой записи.';
  if(listening){const seconds=Math.floor(recordedMs/1000);$('#speech-help').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Нажми ещё раз, когда закончишь`;}
  else if(processing)$('#speech-help').textContent='Распознаём полную запись';
  else if(speech?.supported&&!speech.pending)$('#speech-help').textContent='Нажми ещё раз, чтобы отправить запись';
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
  onLevel:(level,details)=>{const meter=$('#mic-meter');meter.hidden=!details.active||details.available===false;const weights=[.5,.72,.9,1,.83,.65,.4];Array.from(meter.children).forEach((bar,i)=>bar.style.transform=`scaleY(${.08+Math.max(0,Math.min(1,level))*weights[i]*.92})`);$('#mic-quiet').hidden=!details.active||details.available===false||!(details.quietMs>5000);},
  onStatus:(phase,details)=>{
    speechPhase=phase;recordedMs=details?.elapsedMs||0;voiceError=false;
    if(phase==='requesting'){$('#transcript').textContent='…';feedback('Говори спокойно: паузы можно делать любой длины. Закончив, нажми микрофон ещё раз.');}
    if(phase==='processing')feedback('Запись готова. Подготавливаем отправку.');
    refresh();
  },
  beforeUpload:()=>{if(!health.ready)throw new SpeechError(health.state==='ready'?'not-configured':'server-unavailable',{stage:'audio_ready',source:registry.get(registry.selected)?.label||'configuration'});},
  onStage:(stage,details)=>{
    if(['timing','routing','switching'].includes(stage)){if(details.attemptCount)retryingConnection=details.attemptCount>1;diagnostics.update(details);refresh();return;}
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
    const message=code==='no-compatible-server'?ERROR_MESSAGES[code]:speech.pending&&diagnostics.data.exhausted?'Не удалось обработать запись. Можно попробовать снова или записать новую фразу.':code==='unknown-command'?`Я услышал «${String(diagnostics.data.transcript||'').slice(0,200)}», но не понял команду.`:ERROR_MESSAGES[code]||'Не удалось распознать речь. Попробуйте ещё раз.';
    feedback(message+(speech.pending?' Запись сохранена до повторной отправки или удаления.':''),'error');refresh();
  },
  onEnd:()=>{speechPhase='idle';refresh();},
},{provider:new FailoverSttProvider(health)});
$('#hero-name').value=world.profile.name;
$('#hero-name').addEventListener('input',event=>{world.setName(event.target.value);});
function diagnose(raw,command,source){
  if(new URLSearchParams(location.search).get('debug')==='1')console.info('[Korean Stickman interpretation]',{source,raw,accepted:command.ok,intents:command.intents||[],reason:command.reason||command.type||'unknown'});
}
function selectedCommand(text,voice=false){return $('#stt-language').value==='ru'?interpretRussian(text,{home:mode==='home',profile:world.profile,voice}):mode==='home'?parseRoom(text,{debug:!voice&&roomRenderer.debug}):voice?interpretSpeech([{text}],world.profile):parseKorean(text,world.profile);}
function describeAction(command){const list=command.commands||[command];return list.map(c=>c.item?`${c.action} ${c.item}`:c.field?`${c.action} ${c.field}=${c.value}`:c.action||c.reason||'unknown').join(' → ');}
$('#command-form').onsubmit=event=>{event.preventDefault();if(!speech.active&&!testSpeech?.active){const raw=$('#command').value,command=selectedCommand(raw);diagnose(raw,command,'manual');execute(command);}};
function beginVoice(){retryingConnection=false;voiceError=false;diagnostics.begin(speech.language);diagnostics.update({serverId:registry.selected,serverName:registry.get(registry.selected)?.label,serverUrl:registry.address(registry.selected,{local:true}),testMode:health.mode==='auto'?'автоматически':'вручную'});speech.start();}
$('#mic').onclick=()=>{if(speech.recording)speech.stop();else if(!speech.active&&health.ready)beginVoice();refresh();};
$('#record-again').onclick=()=>{if(speech.active||testSpeech.active||!health.ready)return;speech.cancel();beginVoice();};

$('#connection-retry').onclick=()=>health.check();
$('#retry-audio').onclick=()=>{if(health.ready&&!speech.active){retryingConnection=false;voiceError=false;diagnostics.update({exhausted:false,error:null,failureStage:null,httpStatus:null,waitMs:0,result:'Повторная отправка по нажатию пользователя'});speech.retry();}};
$('#stt-language').onchange=event=>{if(speech.setLanguage(event.target.value)){if(diagnostics.data.stage==='idle')diagnostics.begin(speech.language);last=null;feedback(event.target.value==='ru'?'Русский тестовый режим. Можно говорить или писать простые русские команды.':'Корейский режим. Состояние героя и комнаты сохранено.');}refresh();};
$('#copy-voice-report').onclick=async()=>{try{await navigator.clipboard.writeText(fullReport());$('#copy-report-status').textContent='Отчёт скопирован';}catch{$('#voice-report').focus();$('#voice-report').select();$('#copy-report-status').textContent='Выделено: скопируйте текст вручную';}};
window.addEventListener('beforeunload',event=>{if(speech?.recording||speech?.pending||testSpeech?.recording||testSpeech?.pending||testSpeech?.comparison){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')health.checkAfterIdle();});
$('#cancel-recording').onclick=()=>{speech.cancel();voiceError=false;feedback('Запись отменена. Она не отправлена; герой остаётся прежним.');refresh();};
$('#repeat').onclick=()=>{if(last)execute(last);};
$('#reset').onclick=()=>{
  if(mode==='home'){revision++;speech.cancel();testSpeech.cancel();roomController.reset();last=null;voiceError=false;$('#command').value='';$('#transcript').textContent='…';feedback('Комната снова пустая. Герой сохранил свои характеристики.');refresh();return;}
  revision++;speech.cancel();testSpeech.cancel();controller.reset();last=null;voiceError=false;$('#hero-name').value='';$('#command').value='';$('#transcript').textContent='…';
  changeLevel(false);feedback('Новая история начинается с приветствия. 안녕하세요!');refresh();
};
function changeLevel(home){
  revision++;speech.cancel();if(testSpeech?.active)testSpeech.cancel();roomController.cancel();roomRenderer.visible=false;controller.cancel();world.save();
  mode=home?'home':'creator';last=null;voiceError=false;renderer.visible=!home;
  document.title=home?'Korean Stickman — Мой дом · V2.8':'Korean Stickman — Создай своего героя · V2.8';
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
initializeServers();
refresh();
if(new URLSearchParams(location.search).get('level')==='2')changeLevel(true);

health.check();

function initializeServers(){
 for(const e of registry.entries){
  const row=document.createElement('tr');row.dataset.server=e.id;
  for(let i=0;i<4;i++)row.append(document.createElement('td'));
  row.children[0].textContent=e.label;row.children[1].textContent=e.url||'Не настроен';row.children[2].textContent=e.url?'Не проверен':'Не настроен';$('#stt-server-rows').append(row);
  const label=document.createElement('label'),name=document.createElement('span'),input=document.createElement('input'),enabled=document.createElement('input');name.textContent=e.label;input.type='url';input.value=e.url;input.dataset.serverUrl=e.id;input.setAttribute('aria-label','Адрес API '+e.label);enabled.type='checkbox';enabled.checked=e.enabled;enabled.dataset.serverEnabled=e.id;enabled.setAttribute('aria-label','Проверять '+e.label);label.append(name,input,enabled);$('#stt-server-addresses').append(label);
  for(const selector of ['#voice-server','#test-server']){const option=document.createElement('option');option.value=e.id;option.textContent=e.label;$(selector).append(option);}
 }
 const auto=document.createElement('option');auto.value='auto';auto.textContent='Автоматически';$('#voice-server').prepend(auto);$('#voice-server').value='auto';$('#test-server').value='render';
 serverChecks=health.checks;
 testSpeech=createDiagnosticSpeech({registry,select:()=>$('#test-server').value,diagnostics:testDiagnostics,onChange:()=>refresh()});
 $('#check-stt-servers').onclick=()=>health.check();
 $('#voice-settings').addEventListener('toggle',()=>{if($('#voice-settings').open&&!serverChecks.rows.size)serverChecks.checkAll();});
 $('#voice-server').onchange=()=>{if(speech.active||speech.pending)return;health.setMode($('#voice-server').value);health.check();refresh();};
 $('#apply-server-addresses').onclick=()=>{try{const changes=registry.entries.map(e=>({id:e.id,url:publicOrigin(document.querySelector(`[data-server-url="${e.id}"]`).value),enabled:document.querySelector(`[data-server-enabled="${e.id}"]`).checked}));for(const e of changes)registry.update(e.id,e);health.check();$('#server-config-status').textContent='Адреса применены до перезагрузки. Запросы STT сами не отправляются.';refresh();}catch{$('#server-config-status').textContent='Нужны публичные HTTPS-адреса без пути, ключей и параметров.';}};
 $('#test-server').onchange=()=>renderServerPanel();
 $('#test-mic').onclick=()=>{if(testSpeech.recording)testSpeech.stop();else if(!testSpeech.active&&!speech.active&&!speech.pending&&registry.available($('#test-server').value)){testDiagnostics.begin(speech.language);testDiagnostics.update({serverId:$('#test-server').value,serverName:registry.get($('#test-server').value)?.label,serverUrl:registry.address($('#test-server').value),testMode:'диагностика STT'});testSpeech.setLanguage(speech.language);testSpeech.start();}refresh();};
 $('#test-resend').onclick=()=>{const clip=testSpeech.pending||testSpeech.comparison;if(!clip||testSpeech.active||speech.active||!registry.available($('#test-server').value))return;testDiagnostics.begin(clip.language);testDiagnostics.update({language:clip.language,mime:clip.audio.type,bytes:clip.audio.size,durationMs:clip.durationMs,result:'Явная повторная отправка выбранному серверу'});if(testSpeech.pending)testSpeech.retry();else testSpeech.compare();refresh();};
 $('#test-discard').onclick=()=>{testSpeech.cancel();refresh();};
}
function renderServerPanel(){
 if(!serverChecks||!testSpeech)return;
 const gameBusy=mode==='home'?roomController.busy:world.busy,blocked=Boolean(speech?.active||testSpeech.active||gameBusy),normalBlocked=blocked||Boolean(speech?.pending)||Boolean(health.pending);
 $('#voice-server').disabled=normalBlocked;$('#test-server').disabled=testSpeech.active;
 $('#apply-server-addresses').disabled=blocked||Boolean(serverChecks.pending)||Boolean(health.pending);$('#check-stt-servers').disabled=Boolean(serverChecks.pending);
 for(const e of registry.entries){
  const row=document.querySelector(`[data-server="${e.id}"]`),r=serverChecks.rows.get(e.id)||{};
  row.children[1].textContent=r.url||e.url||'Не настроен';row.children[2].textContent=!e.url?'Не настроен':!e.enabled?'Отключён':r.state==='checking'?'Проверяется…':r.state==='ok'?`OK · HTTP ${r.httpStatus} · API ${r.apiVersion} · ${r.version}${r.configured?'':' · STT не настроен'}`:r.state==='error'?`Ошибка ${({network:'Нет соединения / CORS',timeout:'Тайм-аут','invalid-response':'Неверный ответ API','http-error':'Ошибка HTTP'}[r.error]||r.error)} · HTTP ${r.httpStatus??'—'}`:'Не проверен';
  row.children[3].textContent=(r.latencyMs===undefined?'—':`${r.latencyMs} мс`)+(r.checkedAt?'\n'+new Date(r.checkedAt).toLocaleString('ru-RU'):'');row.title=r.checkedAt?'Последняя проверка: '+r.checkedAt:'';
  for(const selector of ['#voice-server','#test-server']){const option=Array.from($(selector).options).find(o=>o.value===e.id);option.disabled=!registry.available(e.id);option.textContent=e.label+(!e.url?' — Не настроен':!e.enabled?' — Отключён':'');}
  document.querySelector(`[data-server-url="${e.id}"]`).disabled=blocked||Boolean(serverChecks.pending)||Boolean(health.pending);document.querySelector(`[data-server-enabled="${e.id}"]`).disabled=blocked||Boolean(serverChecks.pending)||Boolean(health.pending);
 }
 $('#voice-server-address').textContent=registry.available(registry.selected)?'Активный сервер: '+registry.get(registry.selected).label+' · '+registry.address(registry.selected,{local:true}):'Сервер не настроен или отключён';
 const selected=$('#test-server').value,clip=testSpeech.pending||testSpeech.comparison,recording=testSpeech.recording;
 $('#test-mic').textContent=recording?'Завершить и отправить выбранному серверу':clip?'Записать новую тестовую фразу':'Записать тестовую фразу';
 $('#test-mic').disabled=!testSpeech.supported||(!recording&&gameBusy)||Boolean(speech?.active||speech?.pending)||Boolean(testSpeech.active&&!recording)||Boolean(testSpeech.pending)||!registry.available(selected);
 $('#test-resend').disabled=!clip||blocked||!registry.available(selected);$('#test-discard').disabled=!testSpeech.active&&!clip;
 $('#test-server-address').textContent=registry.available(selected)?registry.get(selected).url+'/transcribe':'Не настроен: аудио не отправляется';
 const d=testDiagnostics.data;$('#test-stt-result').textContent=[d.stage==='completed'?'Тест STT завершён':STAGE_LABELS[d.stage]||'Тест ещё не выполнялся',d.serverName,d.mime?`${d.language} · ${d.mime} · ${d.durationMs??'—'} мс · ${d.bytes??'—'} байт`:'',d.httpStatus?`HTTP ${d.httpStatus} · ${d.waitMs??'—'} мс`:'',d.transcript?`Текст: ${d.transcript}`:'',d.error?ERROR_MESSAGES[d.error]||d.error:d.result||'Игровые действия в этом тесте не выполняются.'].filter(Boolean).join('\n');
}
