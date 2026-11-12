import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readdir} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {publicOrigins,SttGate} from '../server/security.mjs';
import {readConfig} from '../server/config.mjs';
import {teacherApiBase} from '../src/teacher-config.js';
const config=async()=>({key:'fake-test-key',model:'whisper-large-v3'});
function request(app,path='/',{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:app.address().port,path,method,headers:{Connection:'close',...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text,headers:res.headers}));});req.on('error',reject);req.end(body);
  });
}
async function withApp(options,check){const app=createApp(options);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));try{await check(app);}finally{await new Promise(resolve=>app.close(resolve));}}
test('local prototype serves the panel, lesson API and STT on one origin',async()=>{
  const origin='http://localhost:5175',headers={Host:'localhost:5175',Origin:origin,'Content-Type':'application/json'};
  assert.equal(teacherApiBase(new URL(origin+'/teacher.html')),origin);
  await withApp({config,localLessonsPort:5175},async app=>{
    assert.equal((await request(app,'/teacher.html')).status,200);
    const response=await request(app,'/teacher-api/rooms',{method:'POST',headers,body:'{}'});
    assert.equal(response.status,201);
    assert.equal(JSON.parse(response.text).serverVersion,'0.3.0');
    assert.equal((await request(app,'/teacher-api/rooms',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal(JSON.parse((await request(app,'/api/stt/status')).text).configured,true);
    assert.equal((await request(app,'/.env')).status,404);
  });
  await withApp({config,localLessonsPort:5175,apiOnly:true},async app=>{
    assert.equal((await request(app,'/teacher-api/health')).status,404);
  });
});
test('public full-stack preview uses its own HTTPS origin and in-memory classroom API',async()=>{
  const origin='https://teacher-preview.example.test';
  const headers={Host:new URL(origin).host,Origin:origin,'Content-Type':'application/json'};
  await withApp({config,origins:[origin],teacherPreview:true,apiOnly:false},async app=>{
    assert.equal((await request(app,'/teacher.html',{headers})).status,200);
    for(const file of ['api-config.js','teacher-config.js']){
      assert.ok((await request(app,'/src/'+file,{headers})).text.includes(JSON.stringify(origin)));
    }
    assert.equal((await request(app,'/teacher-api/rooms',{method:'POST',headers,body:'{}'})).status,201);
    assert.equal((await request(app,'/teacher-api/rooms',{method:'POST',headers:{...headers,Origin:'https://other.example.test'},body:'{}'})).status,403);
    assert.equal((await request(app,'/transcribe',{method:'POST',headers})).status,403);
    assert.equal((await request(app,'/.env',{headers})).status,404);
  });
});
test('Render API mode serves Pages classroom preflights and STT independently',async()=>{
  const origin='https://averanges.github.io',apiOrigin='https://stickman.onrender.com';
  const headers={Host:new URL(apiOrigin).host,Origin:origin};
  const providerFactory=()=>({transcribe:async()=>({text:'침대'})});
  await withApp({config,origins:[apiOrigin],frontends:[origin],apiOnly:true,renderLessons:true,providerFactory},async app=>{
    assert.equal((await request(app,'/teacher.html',{headers})).status,404);
    const health=await request(app,'/teacher-api/health',{headers});
    assert.equal(JSON.parse(health.text).version,'0.3.0');
    const preflight=await request(app,'/teacher-api/rooms',{method:'OPTIONS',headers:{
      ...headers,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'
    }});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers['access-control-allow-origin'],origin);
    const room=await request(app,'/teacher-api/rooms',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
    assert.equal(room.status,201);
    assert.equal(JSON.parse(room.text).serverVersion,'0.3.0');
    assert.equal((await request(app,'/teacher-api/rooms',{method:'POST',headers:{...headers,Origin:'https://other.example.test','Content-Type':'application/json'},body:'{}'})).status,403);
    const stt=await request(app,'/transcribe',{method:'POST',headers:{...headers,'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1000'},body:Buffer.alloc(200)});
    assert.equal(stt.status,200);
    assert.equal(JSON.parse(stt.text).text,'침대');
    assert.equal(stt.headers['access-control-allow-origin'],origin);
  });
});
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
