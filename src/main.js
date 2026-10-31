import { parseKorean, interpretSpeech } from './parser.js';
import { catalogs } from './catalog.js';
import { WorldState } from './world.js';
import { Renderer } from './renderer.js';
import { ActionController } from './controller.js';
import { BrowserSpeech } from './speech.js';
const $=selector=>document.querySelector(selector);
const world=new WorldState();
const renderer=new Renderer(world.profile);
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
  const listening=speech?.recording||false,voiceBusy=speech?.active||false,busy=world.busy;
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
  else if(busy)$('#status').textContent=controller?.pending?`Обрабатываю · в очереди ${controller.pending}`:'Обрабатываю';
  else $('#status').textContent=voiceError?'Повторить':'Готов';
  if(listening){const seconds=Math.floor(recordedMs/1000);$('#speech-help').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Нажми ещё раз, когда закончишь`;}
  else if(processing)$('#speech-help').textContent='Распознаём полную запись';
  else if(speech?.supported)$('#speech-help').textContent='Первое нажатие — запись, второе — отправка';
  $('#scene-caption').textContent=profile.awake?'Теперь это твой герой.':'Разбуди его одним словом.';
  $('#context-hint').textContent=profile.awake?'Например: 저는 학생이에요 — «Я ученик»':'Скажи «안녕하세요» — «Здравствуйте»';
  $('#scene').setAttribute('aria-label',`${profile.awake?'Стоящий':'Спящий'} стикмен. ${Object.entries(catalogs).map(([field,catalog])=>catalog[profile[field]]?.label).filter(Boolean).join(', ')}`);
}
controller=new ActionController(world,renderer,{
  onChange:refresh,
  onProgress:command=>{
    $('#transcript').textContent=command.heard||command.text||'…';
    feedback(command.ok?'Герой тебя услышал. Смотри, что будет…':command.message,command.ok?'':command.type);
  },
});
async function execute(command){
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
    const command=interpretSpeech([{text}],world.profile);
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
      'timeout':'Распознавание заняло слишком долго. Попробуй ещё раз.',
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
$('#command-form').onsubmit=event=>{event.preventDefault();if(!speech.active){const raw=$('#command').value,command=parseKorean(raw,world.profile);diagnose(raw,command,'manual');execute(command);}};
$('#mic').onclick=()=>{voiceError=false;if(speech.recording)speech.stop();else if(!speech.active)speech.start();refresh();};
$('#cancel-recording').onclick=()=>{speech.cancel();voiceError=false;feedback('Запись отменена. Она не отправлена; герой остаётся прежним.');refresh();};
$('#repeat').onclick=()=>{if(last)execute(last);};
$('#reset').onclick=()=>{
  revision++;speech.cancel();controller.reset();last=null;voiceError=false;$('#hero-name').value='';$('#command').value='';$('#transcript').textContent='…';
  showCreator();feedback('Новая история начинается с приветствия. 안녕하세요!');refresh();
};
function showCreator(){mode='creator';$('#world-screen').hidden=true;$('#creator').hidden=false;renderer.visible=true;refresh();}
$('#enter-world').onclick=()=>{
  revision++;speech.cancel();controller.cancel();world.save();mode='world';renderer.visible=false;
  $('#world-name').textContent=world.profile.name||'Новый знакомый';
  $('#world-description').textContent=Object.entries(catalogs).map(([field,catalog])=>catalog[world.profile[field]]?.label).filter(Boolean).join(' · ')||'У этой истории пока чистый лист. Всё ещё впереди!';
  const portraitChair=!world.profile.awake?$('#chair').innerHTML.replaceAll('url(#wood)','url(#portrait-wood)'):'';
  $('#world-portrait').innerHTML='<defs><linearGradient id="portrait-wood" x2=".8" y2="1"><stop stop-color="#f5c77f"/><stop offset="1" stop-color="#d69449"/></linearGradient></defs>'+portraitChair+renderer.portraitMarkup();
  $('#save-note').textContent=world.storageAvailable?'Герой хранится в этом браузере на этом устройстве. Его характеристики можно изменить в любой момент.':'Браузер не разрешает сохранение. Герой останется с тобой в этой вкладке, пока она открыта.';
  $('#creator').hidden=true;$('#world-screen').hidden=false;$('#back-to-creator').focus();window.scrollTo({top:0,behavior:'instant'});
};
$('#back-to-creator').onclick=()=>{showCreator();$('#enter-world').focus();};
if(!speech.supported){$('#speech-help').textContent='Запись недоступна — напиши фразу ниже';feedback('Браузер не поддерживает запись подходящего аудиоформата. Ручной ввод работает.');}
else fetch('/api/stt/status').then(response=>response.json()).then(status=>{if(!status.configured&&!speech.active&&mode==='creator')feedback('Для голоса настрой GROQ_API_KEY в локальном .env. Ручной ввод уже работает.');}).catch(()=>{if(!speech.active)feedback('Голосовой сервер недоступен. Проверь, что игра запущена через npm run dev.');});
if(!world.storageAvailable)feedback('Сохранение недоступно. Герой останется в текущей вкладке.');
else if(world.profile.awake)feedback('С возвращением! Герой сохранён. Его характеристики можно менять.');
refresh();
