import {AUDIO_TYPES,SttError} from './stt.mjs';
import {STT_KEYWORDS} from '../src/stt-experiment-config.js';
export class OpenAiTranscribe{
 constructor({openaiKey,fetcher=globalThis.fetch}={}){this.key=openaiKey;this.fetcher=fetcher;this.model='gpt-transcribe';}
 async transcribe(bytes,mime,{signal,hints=false,language='ko'}={}){
  if(language!=='ko')throw new SttError('invalid-language',422,'OpenAI');
  if(!this.key)throw new SttError('openai-not-configured',503,'OpenAI');
  const extension=AUDIO_TYPES.get(mime.split(';')[0].trim().toLowerCase());if(!extension)throw new SttError('unsupported-format',415,'OpenAI');
  const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),`recording.${extension}`);form.set('model',this.model);form.set('response_format','json');form.append('languages[]','ko');if(hints)for(const word of STT_KEYWORDS)form.append('keywords[]',word);
  let response;try{response=await this.fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+this.key},body:form,signal});}catch(error){throw new SttError(error.name==='AbortError'||signal?.aborted?'timeout':'network',504,'OpenAI');}
  if(!response.ok){const error=new SttError(response.status===401||response.status===403?'provider-auth':response.status===429?'rate-limit':'provider-error',response.status===429?429:502,'OpenAI');error.providerHttpStatus=response.status;throw error;}
  let data;try{data=await response.json();}catch{throw new SttError('invalid-response',502,'OpenAI');}
  if(typeof data?.text!=='string'||data.text.length>4000)throw new SttError('invalid-response',502,'OpenAI');
  return {text:data.text,quality:'not-assessed'};
 }
}
