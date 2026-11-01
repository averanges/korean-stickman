export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const AUDIO_TYPES = new Map([['audio/webm','webm'],['audio/ogg','ogg'],['audio/mp4','mp4'],['audio/wav','wav'],['audio/x-wav','wav'],['audio/mpeg','mp3']]);
export class SttError extends Error {
  constructor(code, status = 422, source='Render') { super(code); this.code=code; this.status=status;this.source=source; }
}
export function assessTranscript(data,language='ko') {
  const text=typeof data?.text==='string'?data.text.normalize('NFC').trim():'';
  if(!text || text.length>500 || !(language==='ru'?/[а-яё]/iu:/[가-힣]/u).test(text))throw new SttError('unclear',422,'Groq');
  const segments=Array.isArray(data.segments)?data.segments:[];
  // No vocabulary prompt is sent to Whisper; no missing words are generated locally.
  if(!segments.length)throw new SttError('unclear',422,'Groq');
  const spoken=segments.filter(segment=>typeof segment.text==='string'&&segment.text.trim());
  if(!spoken.length || spoken.some(segment =>
    !Number.isFinite(segment.avg_logprob) || !Number.isFinite(segment.no_speech_prob) ||
    segment.avg_logprob < -1.1 || segment.no_speech_prob > .7 ||
    (Number.isFinite(segment.compression_ratio)&&segment.compression_ratio>2.6)))throw new SttError('unclear',422,'Groq');
  return {text};
}
// Replace this provider to change STT without changing capture or gameplay.
export class GroqWhisper {
  constructor({key,model='whisper-large-v3',fetcher=globalThis.fetch}) { this.key=key;this.model=model;this.fetcher=fetcher; }
  async transcribe(bytes,mime,{signal,language='ko'}={}) {
    if(!['ko','ru'].includes(language))throw new SttError('invalid-language',422);
    if(!this.key)throw new SttError('not-configured',503);
    const extension=AUDIO_TYPES.get(mime.split(';')[0].trim().toLowerCase());
    if(!extension)throw new SttError('unsupported-format',415);
    const form=new FormData();
    form.set('file',new Blob([bytes],{type:mime}),`recording.${extension}`);
    form.set('model',this.model);form.set('language',language);form.set('temperature','0');form.set('response_format','verbose_json');
    let response;
    try { response=await this.fetcher('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${this.key}`},body:form,signal}); }
    catch(error){throw new SttError(error.name==='AbortError'||error.name==='TimeoutError'?'timeout':'network',504,'Groq');}
    if(!response.ok){
      // Provider bodies can contain private request details: never forward them to the client.
      const code=response.status===401||response.status===403?'provider-auth':response.status===429?'rate-limit':'provider-error';
      throw new SttError(code,response.status===429?429:502,'Groq');
    }
    let data;try{data=await response.json();}catch{throw new SttError('provider-error',502,'Groq');}
    return assessTranscript(data,language);
  }
}
