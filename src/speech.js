import { HttpSttProvider, SpeechError } from './stt-client.js';
export const RECORDING_TYPES=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4','audio/webm','audio/ogg'];
export function selectAudioType(Recorder){return RECORDING_TYPES.find(type=>Recorder.isTypeSupported(type))||null;}
const MAX_BYTES=20*1024*1024;
let operationSequence=0;
const operationId=()=>globalThis.crypto?.randomUUID?.()||`voice-${Date.now()}-${++operationSequence}`;
// Manual recording: silence never stops, sends, truncates or restarts capture.
export class BrowserSpeech {
  constructor(callbacks,{navigator=globalThis.navigator,Recorder=globalThis.MediaRecorder,AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext,provider=new HttpSttProvider(),now=()=>performance.now(),schedule=(fn,ms)=>globalThis.setInterval(fn,ms),unschedule=id=>globalThis.clearInterval(id),retainAudio=false}={}){
    this.callbacks=callbacks;this.navigator=navigator;this.Recorder=Recorder;this.AudioContext=AudioContext;this.provider=provider;
    this.retainAudio=retainAudio;this.comparison=null;this.now=now;this.schedule=schedule;this.unschedule=unschedule;this.state='idle';this.session=null;this.pending=null;this.language='ko';this.stageName='idle';
    this.mime=Recorder?.isTypeSupported?selectAudioType(Recorder):null;
    this.supported=Boolean(navigator?.mediaDevices?.getUserMedia&&Recorder&&this.mime);
  }
  get active(){return ['requesting','recording','stopping','processing','executing'].includes(this.state);}
  get recording(){return this.state==='recording';}
  get cancellable(){return this.active;}
  stage(name,details={}){if(!['timing','routing','switching'].includes(name))this.stageName=name;this.callbacks.onStage?.(name,details);}
  status(state,details={}){this.state=state;if(state==='requesting')this.stage('requesting_microphone',{permission:'запрошен',language:this.language});if(state==='recording')this.stage('recording',{permission:'разрешён',...details});this.callbacks.onStatus?.(state,details);}
  setLanguage(language){if(this.active||this.pending||!['ko','ru'].includes(language))return false;this.language=language;return true;}
  current(session){return this.session===session;}
  release(session){
    if(session.timer!==undefined)this.unschedule(session.timer);
    if(session.recorder){session.recorder.ondataavailable=session.recorder.onstop=session.recorder.onerror=null;try{if(session.recorder.state!=='inactive')session.recorder.stop();}catch{}}
    if(this.current(session)||!this.session)this.callbacks.onLevel?.(0,{available:Boolean(session.analyser),active:false});
    session.stream?.getTracks().forEach(track=>track.stop());
    session.source?.disconnect?.();try{Promise.resolve(session.context?.close()).catch(()=>{});}catch{}
    session.chunks=[];
  }
  fail(session,code,details={}){
    if(!this.current(session))return;
    this.session=null;this.release(session);this.state='error';this.stage('error',{...details,error:code,failureStage:details.stage||this.stageName,...(code==='not-allowed'?{permission:'запрещён'}:{})});this.callbacks.onError?.(code,details);this.callbacks.onEnd?.();
  }
  async start(){
    if(!this.supported||this.active)return;
    this.pending=null;this.comparison=null;
    const session={operationId:operationId(),language:this.language,chunks:[],bytes:0,voicedMs:0,manual:false,abort:new AbortController()};
    this.session=session;this.status('requesting');
    try{
      // Create/resume on the initiating user gesture. Analysis never connects to speakers.
      let resumed=Promise.resolve(null);try{if(this.AudioContext){session.context=new this.AudioContext();resumed=Promise.resolve(session.context.resume?.()).then(()=>null,error=>error);}}catch{}
      session.stream=await this.navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:false,autoGainControl:true},video:false});
      if(!this.current(session)){this.release(session);return;}
      const resumeError=await resumed;if(!this.current(session)){this.release(session);return;}
      let recorder;for(const mimeType of RECORDING_TYPES.filter(type=>this.Recorder.isTypeSupported(type))){try{recorder=new this.Recorder(session.stream,{mimeType,audioBitsPerSecond:64000});break;}catch(error){if(error.name!=='NotSupportedError')throw error;}}
      if(!recorder)throw new SpeechError('unsupported-format');session.recorder=recorder;
      const actual=recorder.mimeType||this.mime;
      if(!/^(audio\/webm|audio\/ogg|audio\/mp4)(;|$)/u.test(actual))throw new SpeechError('unsupported-format');
      session.mime=actual;
      try{if(!session.context||resumeError)throw Error('meter-unavailable');session.source=session.context.createMediaStreamSource(session.stream);session.analyser=session.context.createAnalyser();session.analyser.fftSize=1024;session.source.connect(session.analyser);session.samples=new Float32Array(session.analyser.fftSize);}catch{session.source?.disconnect?.();try{Promise.resolve(session.context?.close()).catch(()=>{});}catch{}session.context=null;session.analyser=null;}
      this.stage('timing',{meterAvailable:Boolean(session.analyser),operationId:session.operationId});

      recorder.ondataavailable=event=>{
        if(!this.current(session)||!event.data?.size)return;
        session.bytes+=event.data.size;if(session.bytes>MAX_BYTES){this.fail(session,'too-large');return;}session.chunks.push(event.data);
      };
      recorder.onerror=()=>this.fail(session,'recording-error');
      recorder.onstop=()=>{
        if(!this.current(session))return;
        if(!session.manual){this.fail(session,'interrupted');return;}
        this.finish(session);
      };
      for(const track of session.stream.getTracks())track.addEventListener?.('ended',()=>{if(this.current(session)&&this.state==='recording')this.fail(session,'interrupted');});
      session.started=this.now();session.sampledAt=session.started;session.tick=0;
      recorder.start(1000); // Local chunks only. No HTTP request is made while recording.
      this.status('recording',{elapsedMs:0,mime:actual});
      session.timer=this.schedule(()=>{
        if(!this.current(session)||this.state!=='recording')return;
        const time=this.now(),delta=Math.max(0,Math.min(100,time-session.sampledAt));session.sampledAt=time;
        if(session.analyser){try{
          session.analyser.getFloatTimeDomainData(session.samples);
          let energy=0;for(const value of session.samples)energy+=value*value;
          const rms=Math.sqrt(energy/session.samples.length);
          if(rms>.003){session.voicedMs+=delta;session.lastSound=time;}
          session.level=(session.level||0)*.55+Math.min(1,rms*12)*.45;
          this.callbacks.onLevel?.(session.level,{active:true,available:true,quietMs:time-(session.lastSound||session.started)});
        }catch{session.analyser=null;this.callbacks.onLevel?.(0,{active:true,available:false});}}
        if(++session.tick%5===0)this.status('recording',{elapsedMs:time-session.started,mime:actual});
      },50);
    }catch(error){
      if(!this.current(session))return;
      this.fail(session,error instanceof SpeechError?error.code:({'NotAllowedError':'not-allowed','PermissionDeniedError':'not-allowed','SecurityError':'not-allowed','NotFoundError':'audio-capture','DevicesNotFoundError':'audio-capture','NotReadableError':'audio-capture','TrackStartError':'audio-capture','NotSupportedError':'unsupported-format','AbortError':'interrupted'}[error.name])||'recording-error');
    }
  }
  stop(){
    if(this.state!=='recording'||!this.session)return;
    const session=this.session;session.durationMs=this.now()-session.started;session.manual=true;
    this.callbacks.onLevel?.(0,{active:false});this.status('stopping');
    try{session.recorder.stop();}catch{this.fail(session,'recording-error');}
  }
  async finish(session){
    if(!this.current(session))return;
    const audio=new Blob(session.chunks,{type:session.mime});
    this.stage('audio_ready',{durationMs:session.durationMs,bytes:audio.size,mime:audio.type});
    // Reject silence only after the user's explicit stop; never cut internal pauses.
    if(session.durationMs<500){this.fail(session,'too-short');return;}
    if(audio.size<128||(session.analyser&&session.voicedMs<80)){this.fail(session,'empty-audio');return;}
    this.pending={operationId:session.operationId,audio,durationMs:session.durationMs,language:session.language};
    this.release(session);
    await this.submit(session,this.pending);
  }
  async submit(session,pending){
    this.status('processing');
    try{
      await this.callbacks.beforeUpload?.();if(!this.current(session))return;
      const result=await this.provider.transcribe(pending.audio,{durationMs:pending.durationMs,language:pending.language,operationId:pending.operationId,signal:session.abort.signal,onStage:(name,details)=>{if(this.current(session))this.stage(name,details);}});
      if(!this.current(session))return;
      if(pending.accepted&&!this.retainAudio){this.session=null;this.state='idle';this.callbacks.onEnd?.();return;}
      if(!this.retainAudio)pending.accepted=true;
      if(this.retainAudio)this.comparison=pending;this.pending=null;this.stage('transcribed',{transcript:result.text});this.state='executing';
      const executed=await this.callbacks.onFinal?.(result.text);
      if(!this.current(session))return;
      if(executed?.error)throw new SpeechError(executed.error,{stage:executed.error==='unknown-command'?'transcribed':'executing'});
      this.session=null;this.state='idle';this.stage('completed',{result:executed?.message||'Выполнено'});this.callbacks.onEnd?.();
    }catch(error){if(this.current(session))this.fail(session,error.name==='AbortError'?'interrupted':error.code||(this.state==='executing'?'game-error':'network'),error);}
  }
  async compare(){if(this.active||!this.comparison)return;this.pending=this.comparison;this.stage('audio_ready',{language:this.pending.language,durationMs:this.pending.durationMs,bytes:this.pending.audio.size,mime:this.pending.audio.type});return this.retry();}
  async retry(){
    if(this.active||!this.pending)return;const pending=this.pending;
    const session={chunks:[],abort:new AbortController(),language:pending.language,operationId:pending.operationId};this.session=session;
    await this.submit(session,pending);
  }
  cancel(){
    const session=this.session,hadAudio=Boolean(session||this.pending||this.comparison);this.session=null;this.pending=null;this.comparison=null;
    if(session){session.abort.abort();this.release(session);}
    if(hadAudio)this.stage('cancelled',{result:'Отменено пользователем',error:'cancelled',failureStage:null});this.status('idle');this.callbacks.onEnd?.();
  }
}
