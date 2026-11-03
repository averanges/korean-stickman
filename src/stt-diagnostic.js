import {BrowserSpeech} from './speech.js';
import {RoutedSttProvider} from './routed-stt.js';
import {SpeechError} from './stt-client.js';
import {ERROR_MESSAGES} from './voice-diagnostics.js';
// Deliberately has no parser/controller/world dependency: a diagnostic transcript cannot play the game.
export function createDiagnosticSpeech({registry,select,diagnostics,onChange=()=>{},captureOnly=()=>false,capture={}}){
 let storedOnly=false;const routed=capture.provider||new RoutedSttProvider(registry,select,{local:false,mode:'диагностика STT'});
 return new BrowserSpeech({
  beforeUpload:()=>{if(!captureOnly()&&!registry.available(select()))throw new SpeechError('api-unconfigured',{stage:'audio_ready'});},
  onStage:(stage,details)=>{if(['timing','routing'].includes(stage))diagnostics.update(details);else diagnostics.stage(stage,{...details,...(details.elapsedMs!==undefined?{durationMs:details.elapsedMs}:{})});onChange();},
  onStatus:()=>onChange(),
  onFinal:text=>{if(storedOnly){diagnostics.update({transcript:'',action:'Не выполняется: запись сохранена без отправки'});return {ok:true,message:'Запись сохранена без отправки. Можно запустить сравнение A–D.'};}diagnostics.update({transcript:text,action:'Не выполняется: диагностический тест'});return {ok:true,message:'Транскрипция получена. Игровые действия не выполнялись.'};},
  onError:code=>{diagnostics.update({result:ERROR_MESSAGES[code]||'Ошибка теста STT'});onChange();},onEnd:()=>onChange()
 },{...capture,retainAudio:true,provider:{async transcribe(audio,options){storedOnly=captureOnly();return storedOnly?{text:''}:routed.transcribe(audio,options);}}});
}
