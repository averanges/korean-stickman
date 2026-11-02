import {BrowserSpeech} from './speech.js';
import {RoutedSttProvider} from './routed-stt.js';
import {SpeechError} from './stt-client.js';
import {ERROR_MESSAGES} from './voice-diagnostics.js';
// Deliberately has no parser/controller/world dependency: a diagnostic transcript cannot play the game.
export function createDiagnosticSpeech({registry,select,diagnostics,onChange=()=>{},capture={}}){
 return new BrowserSpeech({
  beforeUpload:()=>{if(!registry.available(select()))throw new SpeechError('api-unconfigured',{stage:'audio_ready'});},
  onStage:(stage,details)=>{if(['timing','routing'].includes(stage))diagnostics.update(details);else diagnostics.stage(stage,{...details,...(details.elapsedMs!==undefined?{durationMs:details.elapsedMs}:{})});onChange();},
  onStatus:()=>onChange(),
  onFinal:text=>{diagnostics.update({transcript:text,action:'Не выполняется: диагностический тест'});return {ok:true,message:'Транскрипция получена. Игровые действия не выполнялись.'};},
  onError:code=>{diagnostics.update({result:ERROR_MESSAGES[code]||'Ошибка теста STT'});onChange();},onEnd:()=>onChange()
 },{...capture,retainAudio:true,provider:capture.provider||new RoutedSttProvider(registry,select,{local:false,mode:'диагностика STT'})});
}
