import test from 'node:test';
import assert from 'node:assert/strict';

// Import and invoke the deployment entry points, not just the shared handler.
async function withEnvironment(values,run){
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 try{for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await run();}
 finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
const frontend='https://averanges.github.io';
const requestHeaders={Origin:frontend,'Content-Type':'audio/webm','X-Requested-With':'KoreanStickman','X-Audio-Duration-Ms':'1000'};
test('Netlify entry ignores runtime Context as an API pathname and preserves all custom paths',async()=>{
 const base='https://routes-test.netlify.app';
 await withEnvironment({API_PUBLIC_ORIGIN:undefined,URL:base,FRONTEND_ORIGIN:frontend,GROQ_API_KEY:''},async()=>{
  const {default:handler,config}=await import('../netlify/functions/stt.mjs');
  const context={requestId:'runtime-fixture',site:{url:base},params:{},server:{region:'test'}};
  assert.deepEqual(config.path,['/health','/transcribe','/api/stt/status','/api/stt','/interpret','/api/interpret']);
  for(const path of ['/health','/api/stt/status','/health?diagnostic=1']){
   const response=await handler(new Request(base+path,{headers:{Origin:frontend}}),context);
   assert.equal(response.status,200,path);const data=await response.json();assert.equal(data.ok,true);assert.equal(data.platform,'netlify');assert.equal(data.configured,false);assert.equal(response.headers.get('access-control-allow-origin'),frontend);
  }
  for(const path of ['/transcribe','/api/stt']){
   const preflight=await handler(new Request(base+path,{method:'OPTIONS',headers:{Origin:frontend,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-requested-with,x-audio-duration-ms,x-stt-language'}}),context);assert.equal(preflight.status,204,path);
   for(const language of ['ko','ru']){const response=await handler(new Request(base+path,{method:'POST',headers:{...requestHeaders,'X-STT-Language':language},body:Buffer.alloc(200)}),context);assert.equal(response.status,503,path);assert.equal((await response.json()).error,'not-configured');}
  }
  for(const path of ['/interpret','/api/interpret']){const r=await handler(new Request(base+path,{method:'POST',headers:{Origin:frontend,'Content-Type':'application/json','X-Requested-With':'KoreanStickman'},body:'{}'}),context);assert.equal(r.status,400,path);assert.equal((await r.json()).error,'invalid-request');}
  // The bare infrastructure URL is not a health alias; never guess an operation from HTTP method.
  for(const path of ['/.netlify/functions/stt','/unknown']){const response=await handler(new Request(base+path),context);assert.equal(response.status,404);assert.equal((await response.json()).error,'not-found');}
  const denied=await handler(new Request(base+'/health',{headers:{Origin:'https://evil.example'}}),context);assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 });
});
test('actual Vercel entry points accept hostname system variables and explicit rewrite paths without changing CORS',async()=>{
 const host='routes-test.vercel.app',base='https://'+host;
 await withEnvironment({API_PUBLIC_ORIGIN:undefined,VERCEL_PROJECT_PRODUCTION_URL:host,VERCEL_URL:'preview-routes-test.vercel.app',FRONTEND_ORIGIN:frontend,GROQ_API_KEY:''},async()=>{
  const {default:health}=await import('../api/health.js'),{default:transcribe}=await import('../api/transcribe.js'),{default:interpret}=await import('../api/interpret.js');
  for(const path of ['/health','/api/health','/api/stt/status']){const response=await health.fetch(new Request(base+path,{headers:{Origin:frontend}}));assert.equal(response.status,200,path);const data=await response.json();assert.equal(data.ok,true);assert.equal(data.platform,'vercel');}
  for(const path of ['/transcribe','/api/transcribe','/api/stt']){const response=await transcribe.fetch(new Request(base+path,{method:'POST',headers:requestHeaders,body:Buffer.alloc(200)}));assert.equal(response.status,503,path);assert.equal((await response.json()).error,'not-configured');const options=await transcribe.fetch(new Request(base+path,{method:'OPTIONS',headers:{Origin:frontend,'Access-Control-Request-Method':'POST'}}));assert.equal(options.status,204,path);}
  for(const path of ['/interpret','/api/interpret']){const r=await interpret.fetch(new Request(base+path,{method:'POST',headers:{Origin:frontend,'Content-Type':'application/json','X-Requested-With':'KoreanStickman'},body:'{}'}));assert.equal(r.status,400,path);const options=await interpret.fetch(new Request(base+path,{method:'OPTIONS',headers:{Origin:frontend,'Access-Control-Request-Method':'POST'}}));assert.equal(options.status,204,path);}
  const denied=await health.fetch(new Request(base+'/health',{headers:{Origin:'https://evil.example'}}));assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 });
});
