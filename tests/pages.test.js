import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {frontendOrigins} from '../server/security.mjs';
import {apiUrl} from '../src/api-config.js';
import {HttpSttProvider} from '../src/stt-client.js';
import {buildPages} from '../scripts/build-pages.mjs';
const page='https://averanges.github.io',backend='https://korean-stickman.onrender.com';
function request(app,route,method='GET',extra={},body){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:app.address().port,path:route,method,headers:{Host:'korean-stickman.onrender.com',Origin:page,Connection:'close',...extra}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});}
test('CORS allows exactly configured Pages origin and supported preflight, including readable API errors',async()=>{
  const app=createApp({origins:[backend],frontends:[page],apiOnly:true,config:async()=>({key:'dummy'}),providerFactory:()=>({async transcribe(){return{text:'학생이에요'};}})});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  try{
    const preflight={'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-requested-with,x-audio-duration-ms'};
    let result=await request(app,'/api/stt','OPTIONS',preflight);assert.equal(result.status,204);assert.equal(result.headers['access-control-allow-origin'],page);assert.notEqual(result.headers['access-control-allow-origin'],'*');
    assert.equal(result.headers['access-control-allow-credentials'],undefined);
    result=await request(app,'/api/stt','OPTIONS',{...preflight,Origin:'https://someone-else.github.io'});assert.equal(result.status,403);assert.equal(result.headers['access-control-allow-origin'],undefined);
    assert.equal((await request(app,'/api/stt','OPTIONS',{...preflight,'Access-Control-Request-Headers':'authorization'})).status,403);
    assert.equal((await request(app,'/api/stt','OPTIONS',{...preflight,'Access-Control-Request-Method':'DELETE'})).status,403);
    const headers={'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1500'};
    result=await request(app,'/api/stt','POST',headers,Buffer.alloc(200));assert.equal(result.status,200);assert.equal(result.headers['access-control-allow-origin'],page);
    result=await request(app,'/api/stt','POST',headers,Buffer.alloc(10));assert.equal(result.status,422);assert.equal(result.headers['access-control-allow-origin'],page);
    for(const route of ['/','/index.html','/src/main.js','/.env','/server.mjs'])assert.equal((await request(app,route)).status,404);
    assert.equal((await request(app,'/api/stt/status')).status,200);
  }finally{await new Promise(resolve=>app.close(resolve));}
});
test('frontend origin cannot include repository path or wildcard',()=>{
  assert.deepEqual(frontendOrigins({FRONTEND_ORIGIN:page}),[page]);
  for(const value of [page+'/korean-stickman/','http://pupil.github.io','*'])assert.throws(()=>frontendOrigins({FRONTEND_ORIGIN:value}));
});
test('API URLs work on Pages subpath and local dev; missing public configuration fails closed',()=>{
  assert.equal(apiUrl('/api/stt',undefined,{hostname:'averanges.github.io',pathname:'/korean-stickman/'}),backend+'/api/stt');
  assert.equal(apiUrl('/api/stt',undefined,{hostname:'localhost'}),'/api/stt');
  assert.equal(apiUrl('/api/stt',undefined,{hostname:'127.0.0.1'}),'/api/stt');
  assert.equal(apiUrl('/api/stt',backend,{hostname:'pupil.github.io',pathname:'/korean-stickman/'}),backend+'/api/stt');
  assert.equal(apiUrl('/api/stt','',{hostname:'localhost'}),'/api/stt');
  assert.throws(()=>apiUrl('/api/stt','',{hostname:'pupil.github.io'}),error=>error.code==='api-unconfigured');
});
test('Pages build publishes only public assets and supports /korean-stickman/ without backend requests',async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'stickman-pages-'));
  const override='https://replacement-api.onrender.com';
  await buildPages({apiBase:override,output});
  const names=await readdir(output,{recursive:true});
  for(const name of names)assert.ok(name==='src'||name==='docs'||name==='index.html'||name==='.nojekyll'||/^src[\\/][a-z0-9-]+\.(js|css)$/u.test(name)||/^docs[\\/]assets.svg$/u.test(name),name);
  const html=await readFile(path.join(output,'index.html'),'utf8');
  assert.match(html,/href="src\/style.css"/);assert.match(html,/src="src\/main.js"/);assert.doesNotMatch(html,/<script[^>]+https?:/);
  const api=await readFile(path.join(output,'src','api-config.js'),'utf8');assert.ok(api.includes(override));assert.ok(!api.includes(backend));
  for(const name of names.filter(name=>/\.js$/u.test(name))){
    const source=await readFile(path.join(output,name),'utf8');
    for(const match of source.matchAll(/from\s+['"](\.\/[^'"]+)['"]/gu))await readFile(path.resolve(path.dirname(path.join(output,name)),match[1]));
  }
  const main=await readFile(path.join(output,'src','main.js'),'utf8');assert.ok(!main.includes("fetch('/api/stt/status')"));
  assert.equal(new URL('src/main.js','https://pupil.github.io/korean-stickman/').pathname,'/korean-stickman/src/main.js');
  assert.equal(await readFile(path.join(output,'src','world.js'),'utf8'),await readFile(new URL('../src/world.js',import.meta.url),'utf8'));
});
test('unreachable and sleeping backend produces controlled errors, with no automatic retries',async()=>{
  let calls=0;
  const provider=new HttpSttProvider(async()=>{calls++;throw new TypeError('Failed to fetch');},()=>backend+'/api/stt');
  await assert.rejects(provider.transcribe(new Blob(['audio'],{type:'audio/webm'}),{durationMs:1000}),error=>error.code==='network');assert.equal(calls,1);
  const sleeping=new HttpSttProvider(async()=>({ok:false,status:503,json:async()=>{throw Error('HTML loading page');}}),()=>backend+'/api/stt');
  await assert.rejects(sleeping.transcribe(new Blob(['audio']),{durationMs:1000}),error=>error.code==='service-unavailable');
});
test('timeout covers response body too; user cancellation remains distinct',async()=>{
  const pending=async(_,options)=>({ok:true,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('','AbortError')),{once:true}))});
  const provider=new HttpSttProvider(pending,()=>backend+'/api/stt',20);
  await assert.rejects(provider.transcribe(new Blob(['audio']),{durationMs:1000}),error=>error.code==='timeout');
  const abort=new AbortController();const task=new HttpSttProvider(pending,()=>backend+'/api/stt').transcribe(new Blob(['audio']),{durationMs:1000,signal:abort.signal});
  await new Promise(resolve=>setImmediate(resolve));abort.abort();await assert.rejects(task,error=>error.name==='AbortError');
});
