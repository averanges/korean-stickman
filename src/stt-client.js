export class SpeechError extends Error {
  constructor(code){super(code);this.code=code;}
}
// Capture knows only this transport, not the server-side STT provider or API key.
export class HttpSttProvider {
  constructor(fetcher=(...args)=>globalThis.fetch(...args)){this.fetcher=fetcher;}
  async transcribe(audio,{durationMs,signal}){
    let response,timedOut=false;const controller=new AbortController();
    const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},65000);
    try{
      response=await this.fetcher('/api/stt',{method:'POST',headers:{'Content-Type':audio.type,'X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':String(Math.round(durationMs))},body:audio,signal:controller.signal});
    }catch(error){if(timedOut)throw new SpeechError('timeout');if(error.name==='AbortError')throw error;throw new SpeechError('network');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    let data;try{data=await response.json();}catch{throw new SpeechError('server-error');}
    if(!response.ok)throw new SpeechError(data.error||'server-error');
    if(typeof data.text!=='string'||!data.text.trim())throw new SpeechError('unclear');
    return {text:data.text};
  }
}
