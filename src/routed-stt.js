import {HttpSttProvider,SpeechError} from './stt-client.js';
export class RoutedSttProvider{
 constructor(registry,select=()=>registry.selected,{local=false,mode='игра',fetcher}={}){Object.assign(this,{registry,select,local,mode,fetcher});}
 async transcribe(audio,options){
  const id=this.select(),server=this.registry.get(id),endpoint=this.registry.endpoint(id,'transcribe',{local:this.local}),limits=this.registry.limits(id);
  options.onStage?.('routing',{serverId:id,serverName:server.label,serverUrl:this.registry.address(id,{local:this.local}),testMode:this.mode});
  if(audio.size>limits.maxAudioBytes)throw new SpeechError('too-large',{stage:'audio_ready',source:server.label});
  if(limits.maxDurationMs&&options.durationMs>limits.maxDurationMs)throw new SpeechError('too-long',{stage:'audio_ready',source:server.label});
  try{return await new HttpSttProvider(this.fetcher,()=>endpoint).transcribe(audio,options);}catch(error){if(['Render','network/Render','platform'].includes(error.source))error.source=server.label;throw error;}
 }
}
