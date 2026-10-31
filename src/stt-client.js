import {apiUrl} from './api-config.js';
export class SpeechError extends Error {
  constructor(code){super(code);this.code=code;}
}
// Capture knows only this transport, not the server-side STT provider or API key.
export class HttpSttProvider {
  constructor(fetcher=(...args)=>globalThis.fetch(...args),resolveUrl=apiUrl,timeoutMs=65000){this.fetcher=fetcher;this.resolveUrl=resolveUrl;this.timeoutMs=timeoutMs;}
  async transcribe(audio,{durationMs,signal}){
    const endpoint=this.resolveUrl('/api/stt');
    let timedOut=false;const controller=new AbortController();
    const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeoutMs);
    try{
      const response=await this.fetcher(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':audio.type,'X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':String(Math.round(durationMs))},body:audio,signal:controller.signal});
      let data;try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw new SpeechError('service-unavailable');}
      if(!response.ok)throw new SpeechError(response.status>=500?'service-unavailable':data.error||'service-unavailable');
      if(typeof data.text!=='string'||!data.text.trim())throw new SpeechError('unclear');
      return {text:data.text};
    }catch(error){if(timedOut)throw new SpeechError('timeout');if(error.name==='AbortError'||error instanceof SpeechError)throw error;throw new SpeechError('network');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
}
