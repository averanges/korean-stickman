import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSpeech, selectAudioType } from '../src/speech.js';
import { WorldState } from '../src/world.js';
import { ActionController } from '../src/controller.js';
import { parseKorean, interpretSpeech } from '../src/parser.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness({denied=false,deviceMissing=false,delayed=false,providerError=false,deferred=false}={}){
  let now=0,interval=null,recorder,amplitude=0,resolvePermission,resolveTranscript;
  const events=[],uploads=[];let tracksStopped=0;
  const track={stop(){tracksStopped++;},addEventListener(){}};
  const stream={getTracks:()=>[track]};
  class Recorder{
    static isTypeSupported(type){return type.startsWith('audio/webm');}
    constructor(_,options){this.mimeType=options.mimeType;this.state='inactive';recorder=this;}
    start(){this.state='recording';}
    chunk(text='a'.repeat(160)){this.ondataavailable?.({data:new Blob([text])});}
    stop(){this.state='inactive';queueMicrotask(()=>{this.chunk();this.onstop?.();});}
  }
  class AudioContext{
    resume(){return Promise.resolve();}close(){return Promise.resolve();}
    createMediaStreamSource(){return{connect(){},disconnect(){}};}
    createAnalyser(){return{fftSize:1024,getFloatTimeDomainData(samples){samples.fill(amplitude);}};}
  }
  const provider={async transcribe(blob,options){uploads.push({blob,options});if(providerError)throw{code:'unclear'};if(deferred)return new Promise(resolve=>{resolveTranscript=resolve;});return{text:'저는 러시아 사람이에요'};}};
  const navigator={mediaDevices:{async getUserMedia(){if(denied)throw{name:'NotAllowedError'};if(deviceMissing)throw new DOMException('','NotFoundError');if(delayed)return new Promise(resolve=>{resolvePermission=resolve;});return stream;}}};
  const speech=new BrowserSpeech({onStatus:state=>events.push(state),onFinal:text=>events.push({final:text}),onError:code=>events.push({error:code}),onEnd:()=>events.push('end')},{navigator,Recorder,AudioContext,provider,now:()=>now,schedule:fn=>{interval=fn;return 1;},unschedule:()=>{interval=null;}});
  return{speech,events,uploads,get recorder(){return recorder;},get stopped(){return tracksStopped;},advance(ms,sound=0){amplitude=sound;for(let i=0;i<ms;i+=50){now+=50;interval?.();}},allowPermission(){resolvePermission(stream);},finishUpload(){resolveTranscript({text:'학생이에요'});}};
}
test('one utterance uploads only on the second press, never on chunks',async()=>{
  const h=harness();await h.speech.start();h.advance(1000,.02);h.recorder.chunk('first');assert.equal(h.uploads.length,0);
  h.speech.stop();await flush();assert.equal(h.uploads.length,1);assert.equal(h.events.filter(e=>e?.final).length,1);assert.equal(h.speech.active,false);
});
test('저는 + four seconds silence + remaining words stays one intact recording',async()=>{
  const h=harness();await h.speech.start();h.advance(1000,.02);h.recorder.chunk('저는|');h.advance(4000);h.recorder.chunk('4-seconds-silence|');
  assert.equal(h.speech.recording,true);assert.equal(h.uploads.length,0);assert.equal(h.events.some(e=>e?.final),false);
  h.advance(1500,.02);h.recorder.chunk('러시아 사람이에요|');h.speech.stop();await flush();
  assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].options.durationMs,6500);assert.match(await h.uploads[0].blob.text(),/저는\|4-seconds-silence\|러시아 사람이에요/);
});
test('a mistake and a repeated fragment are retained until manual completion',async()=>{
  const h=harness();await h.speech.start();h.advance(800,.02);h.recorder.chunk('저는 저는 ');h.advance(1500);h.advance(1000,.02);h.recorder.chunk('러시아 사람이에요');
  assert.equal(h.uploads.length,0);h.speech.stop();await flush();assert.match(await h.uploads[0].blob.text(),/저는 저는/);
});
test('silent cancellation and empty stop never upload',async()=>{
  const h=harness();await h.speech.start();h.advance(5000);h.speech.cancel();await flush();assert.equal(h.uploads.length,0);assert.equal(h.speech.active,false);
  await h.speech.start();h.advance(1000);h.speech.stop();await flush();assert.equal(h.uploads.length,0);assert.ok(h.events.some(e=>e?.error==='empty-audio'));
});
test('unexpected browser stop cannot submit partial audio; immediate retry works',async()=>{
  const h=harness();await h.speech.start();h.advance(1000,.02);h.recorder.stop();await flush();assert.equal(h.uploads.length,0);assert.ok(h.events.some(e=>e?.error==='interrupted'));
  await h.speech.start();h.advance(800,.02);h.speech.stop();await flush();assert.equal(h.uploads.length,1);
});
test('unclear STT gives no final command and permits the next recording',async()=>{
  const h=harness({providerError:true});await h.speech.start();h.advance(900,.02);h.speech.stop();await flush();
  assert.equal(h.events.some(e=>e?.final),false);assert.ok(h.events.some(e=>e?.error==='unclear'));await h.speech.start();assert.equal(h.speech.recording,true);h.speech.cancel();
});
test('cancel while waiting for permission releases late-arriving microphone',async()=>{
  const h=harness({delayed:true});const pending=h.speech.start();h.speech.cancel();h.allowPermission();await pending;assert.equal(h.speech.active,false);assert.ok(h.stopped>0);assert.equal(h.uploads.length,0);
});
test('cancel during transcription ignores late results',async()=>{
  const h=harness({deferred:true});await h.speech.start();h.advance(1000,.02);h.speech.stop();await flush();assert.equal(h.speech.state,'processing');h.speech.cancel();h.finishUpload();await flush();assert.equal(h.events.some(e=>e?.final),false);
});
test('microphone refusal and double clicks cannot create a second recording',async()=>{
  const denied=harness({denied:true});await denied.speech.start();assert.ok(denied.events.some(e=>e?.error==='not-allowed'));
  const h=harness();await h.speech.start();await h.speech.start();h.advance(1000,.02);h.speech.stop();h.speech.stop();await flush();assert.equal(h.uploads.length,1);
});
test('format is selected from browser support rather than hardcoded',()=>{
  assert.equal(selectAudioType({isTypeSupported:type=>type==='audio/mp4'}),'audio/mp4');assert.equal(selectAudioType({isTypeSupported:()=>false}),null);
});
test('DOMException numeric codes cannot hide the microphone error',async()=>{
  const h=harness({deviceMissing:true});await h.speech.start();assert.ok(h.events.some(event=>event?.error==='audio-capture'));assert.equal(h.speech.active,false);
});
test('accidentally stopping immediately cannot submit an empty clip',async()=>{
  const h=harness();await h.speech.start();h.advance(150,.02);h.speech.stop();await flush();assert.equal(h.uploads.length,0);assert.ok(h.events.some(event=>event?.error==='too-short'));
});
test('failed recognition preserves an awake hero; the next attempt does not wake again',async()=>{
  const world=new WorldState({getItem:()=>null,setItem(){}});world.apply(parseKorean('안녕'));world.apply(parseKorean('러시아 사람이에요'));
  let wakes=0;
  const renderer={async wake(){wakes++;return true;},async equip(){return true;},setProfile(){},reset(){},async confused(){return true;}};
  const controller=new ActionController(world,renderer),h=harness({providerError:true});
  h.speech.callbacks.onFinal=text=>controller.run(interpretSpeech([{text}]));
  const before=JSON.stringify(world.profile);
  await h.speech.start();h.advance(1000,.02);h.speech.stop();await flush();assert.equal(JSON.stringify(world.profile),before);
  h.speech.provider={async transcribe(){return{text:'학생이에요'};}};
  await h.speech.start();h.advance(1000,.02);h.speech.stop();await flush();
  assert.equal(world.profile.country,'russia');assert.equal(world.profile.profession,'student');assert.equal(world.profile.awake,true);assert.equal(wakes,0);
});
