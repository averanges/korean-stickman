import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig } from '../server/config.mjs';
import { GroqWhisper, assessTranscript } from '../server/stt.mjs';
import { createApp } from '../server.mjs';
const confident=text=>({text,segments:[{text,avg_logprob:-.3,no_speech_prob:.02,compression_ratio:1.1}]});
test('provider sends the complete audio with Korean language and no prompt or trimming',async()=>{
  const bytes=Buffer.from('full-audio-before-four-seconds-silence-after'.repeat(10));
  let request;
  const provider=new GroqWhisper({key:'test-private-key',fetcher:async(url,options)=>{request={url,options};return{ok:true,json:async()=>confident('저는 러시아 사람이에요')};}});
  const result=await provider.transcribe(bytes,'audio/webm;codecs=opus');
  assert.equal(result.text,'저는 러시아 사람이에요');assert.equal(request.options.headers.Authorization,'Bearer test-private-key');
  const form=request.options.body;assert.equal(form.get('language'),'ko');assert.equal(form.get('prompt'),null);assert.equal(form.get('response_format'),'verbose_json');
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()),bytes);
});
test('uncertain, silent, repetitive and absent segments never yield an accepted transcript',()=>{
  for(const data of [{text:''},{text:'학생이에요'},confident('Thank you for watching'),{...confident('학생이에요'),segments:[{text:'학생이에요',avg_logprob:-2,no_speech_prob:.01}]},{...confident('학생이에요'),segments:[{text:'학생이에요',avg_logprob:-.1,no_speech_prob:.95}]}])assert.throws(()=>assessTranscript(data),error=>error.code==='unclear');
});
test('provider errors are sanitized rather than exposing key or upstream body',async()=>{
  const provider=new GroqWhisper({key:'private',fetcher:async()=>({ok:false,status:401,text:async()=>'private-provider-details'})});
  await assert.rejects(provider.transcribe(Buffer.alloc(200),'audio/webm'),error=>error.code==='provider-auth'&&!error.message.includes('private'));
});
test('local .env is loaded on each request and only relevant values are read',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'korean-stt-test-'));
  try{
    const root=pathToFileURL(directory+path.sep);assert.equal((await readConfig(root,{})).key,'');
    await writeFile(path.join(directory,'.env'),'GROQ_API_KEY="local-private"\nSTT_MODEL=whisper-large-v3\n');
    assert.equal((await readConfig(root,{})).key,'local-private');
    assert.equal((await readConfig(root,{GROQ_API_KEY:'override'})).key,'override');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('HTTP app rejects secret paths and cross-origin requests; upload is one complete file',async()=>{
  const calls=[];
  const app=createApp({config:async()=>({key:'test-secret',model:'whisper-large-v3'}),providerFactory:()=>({async transcribe(bytes,mime){calls.push({bytes,mime});return{text:'학생이에요'};}})});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
  try{
    for(const route of ['/.env','/.env.example','/server.mjs','/server/config.mjs','/package.json','/tests/speech.test.js'])assert.equal((await fetch(base+route)).status,404,route);
    const status=await(await fetch(base+'/api/stt/status')).text();assert.ok(!status.includes('test-secret'));assert.equal(JSON.parse(status).configured,true);
    const headers={'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'6500'};
    assert.equal((await fetch(base+'/api/stt',{method:'POST',headers:{...headers,Origin:'https://unrelated.example'},body:Buffer.alloc(200)})).status,403);
    assert.equal((await fetch(base+'/api/stt',{method:'POST',headers:{...headers,'X-Audio-Duration-Ms':'0'},body:Buffer.alloc(200)})).status,422);
    const audio=Buffer.from('first|four-second-pause|last'.repeat(20));
    const response=await fetch(base+'/api/stt',{method:'POST',headers,body:audio});assert.equal(response.status,200);assert.equal((await response.json()).text,'학생이에요');
    assert.equal(calls.length,1);assert.deepEqual(calls[0].bytes,audio);
  }finally{await new Promise(resolve=>app.close(resolve));}
});
