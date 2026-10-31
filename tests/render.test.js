import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {publicOrigins,SttGate} from '../server/security.mjs';
import {readConfig} from '../server/config.mjs';
const config=async()=>({key:'fake-test-key',model:'whisper-large-v3'});
function request(app,path='/',{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:app.address().port,path,method,headers:{Connection:'close',...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));});req.on('error',reject);req.end(body);
  });
}
async function withApp(options,check){const app=createApp(options);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));try{await check(app);}finally{await new Promise(resolve=>app.close(resolve));}}
test('Render URL is explicit HTTPS; unexpected public domains and unsafe URL settings are rejected',()=>{
  assert.deepEqual(publicOrigins({RENDER_EXTERNAL_URL:'https://stickman.onrender.com'}),['https://stickman.onrender.com']);
  assert.deepEqual(publicOrigins({RENDER_EXTERNAL_HOSTNAME:'stickman.onrender.com'}),['https://stickman.onrender.com']);
  for(const value of ['http://stickman.onrender.com','https://user:secret@example.com','https://example.com/path'])assert.throws(()=>publicOrigins({PUBLIC_ORIGIN:value}));
});
test('public HTTPS interface and STT work behind TLS termination without trusting forwarded Host',async()=>{
  let calls=0;
  await withApp({config,origins:['https://stickman.onrender.com'],providerFactory:()=>({async transcribe(){calls++;return{text:'학생입니다'};}})},async app=>{
    const publicHeaders={Host:'stickman.onrender.com',Origin:'https://stickman.onrender.com'};
    assert.equal((await request(app,'/',{headers:publicHeaders})).status,200);
    assert.equal((await request(app,'/',{headers:{Host:'evil.example','X-Forwarded-Host':'stickman.onrender.com'}})).status,403);
    assert.equal((await request(app,'/',{headers:{...publicHeaders,Origin:'https://evil.example'}})).status,403);
    assert.equal((await request(app,'/',{headers:{...publicHeaders,Origin:'http://stickman.onrender.com'}})).status,403);
    const response=await request(app,'/api/stt',{method:'POST',headers:{...publicHeaders,'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1000'},body:Buffer.alloc(200)});
    assert.equal(response.status,200);assert.equal(JSON.parse(response.text).text,'학생입니다');assert.equal(calls,1);
    assert.equal((await request(app,'/')).status,200);
  });
});
test('all runtime JS/CSS and SVG assets are public, all local secret/server paths remain closed',async()=>{
  await withApp({config,origins:[]},async app=>{
    for(const file of await readdir(new URL('../src/',import.meta.url)))if(/\.(js|css)$/u.test(file))assert.equal((await request(app,'/src/'+file)).status,200,file);
    assert.equal((await request(app,'/docs/assets.svg')).status,200);
    for(const path of ['/.env','/.env.local','/.env.example','/server.mjs','/server/config.mjs','/server/security.mjs','/.git/config','/package.json'])assert.equal((await request(app,path)).status,404,path);
  });
});
test('gate enforces simultaneous and per-minute attempts and recovers after window',()=>{
  let time=0;const gate=new SttGate({maximum:2,perMinute:3,now:()=>time});
  const first=gate.acquire(),second=gate.acquire();assert.equal(gate.acquire(),null);first();first();assert.equal(gate.active,1);
  const third=gate.acquire();assert.equal(gate.acquire(),null);second();third();assert.equal(gate.acquire(),null);
  time=60000;assert.equal(typeof gate.acquire(),'function');
});
test('busy STT is rejected before Groq; errors and oversized audio release the slot',async()=>{
  let finish,entered;const started=new Promise(resolve=>{entered=resolve;});let calls=0;
  const gate=new SttGate({maximum:1,perMinute:20});
  await withApp({config,origins:[],gate,providerFactory:()=>({transcribe(){calls++;entered();return new Promise(resolve=>{finish=resolve;});}})},async app=>{
    const headers={'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1000'};
    const first=request(app,'/api/stt',{method:'POST',headers,body:Buffer.alloc(200)});await started;
    assert.equal((await request(app,'/api/stt',{method:'POST',headers,body:Buffer.alloc(200)})).status,429);assert.equal(calls,1);
    finish({text:'학생입니다'});await first;assert.equal(gate.active,0);
    const huge=await request(app,'/api/stt',{method:'POST',headers:{...headers,'Content-Length':String(20*1024*1024+1)}});assert.equal(huge.status,413);assert.equal(gate.active,0);assert.equal(calls,1);
    const empty=await request(app,'/api/stt',{method:'POST',headers,body:Buffer.alloc(10)});assert.equal(empty.status,422);assert.equal(gate.active,0);
  });
});
test('Render configuration does not depend on the local .env',async()=>{
  const config=await readConfig(new URL('file:///nonexistent-project/'),{RENDER:'true',PORT:'10000',GROQ_API_KEY:'test-env-key'});
  assert.equal(config.key,'test-env-key');assert.equal(config.port,10000);
});
