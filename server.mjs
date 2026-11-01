import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readConfig } from './server/config.mjs';
import { GroqWhisper, SttError, MAX_AUDIO_BYTES, AUDIO_TYPES } from './server/stt.mjs';
import { publicOrigins, frontendOrigins as configuredFrontends, allowedRequest, SttGate } from './server/security.mjs';
const projectURL=new URL('.',import.meta.url);
const root=path.resolve(fileURLToPath(projectURL));
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function readAudio(req){
  if(Number(req.headers['content-length'])>MAX_AUDIO_BYTES)throw new SttError('too-large',413);
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>MAX_AUDIO_BYTES)throw new SttError('too-large',413);chunks.push(chunk);}
  if(length<128)throw new SttError('empty-audio');
  return Buffer.concat(chunks);
}
export function createApp({config=()=>readConfig(projectURL),providerFactory=options=>new GroqWhisper(options),origins=publicOrigins(),frontends=configuredFrontends(),apiOnly=process.env.RENDER==='true'||process.env.API_ONLY==='true',gate=new SttGate()}={}){
  return http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host||'';
      if(!allowedRequest(req,origins,frontends)){json(res,403,{error:'forbidden'});return;}
      const pathname=decodeURIComponent(new URL(req.url,`http://${host}`).pathname);
      if(pathname==='/api/stt'||pathname==='/api/stt/status'){
        if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Retry-After');}
        if(req.method==='OPTIONS'){
          const method=pathname==='/api/stt'?'POST':'GET';
          const allowedHeaders=['content-type','x-requested-with','x-audio-duration-ms','x-stt-language','accept'];
          const requested=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
          if(!req.headers.origin||req.headers['access-control-request-method']!==method||requested.some(value=>!allowedHeaders.includes(value))){json(res,403,{error:'forbidden'});return;}
          res.writeHead(204,{'Access-Control-Allow-Methods':method+', OPTIONS','Access-Control-Allow-Headers':allowedHeaders.join(', '),'Access-Control-Max-Age':'600'});res.end();return;
        }
      }
      if(pathname==='/api/stt/status'&&req.method==='GET'){
        const settings=await config();json(res,200,{configured:Boolean(settings.key),provider:'Groq Whisper'});return;
      }
      if(pathname==='/api/stt'&&req.method==='POST'){
        if(req.headers['x-requested-with']!=='KoreanStickman'){json(res,403,{error:'forbidden'});return;}
        const language=req.headers['x-stt-language']||'ko';if(!['ko','ru'].includes(language))throw new SttError('invalid-language',422);
        const mime=String(req.headers['content-type']||'').toLowerCase();
        if(!AUDIO_TYPES.has(mime.split(';')[0].trim()))throw new SttError('unsupported-format',415);
        const duration=Number(req.headers['x-audio-duration-ms']);
        if(!Number.isFinite(duration)||duration<500)throw new SttError('too-short');
        const settings=await config();if(!settings.key)throw new SttError('not-configured',503);
        const release=gate.acquire();
        if(!release){res.setHeader('Retry-After','60');json(res,429,{error:'rate-limit',source:'Render'});return;}
        try{
        const audio=await readAudio(req);
        const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60000);
        const disconnected=()=>{if(!res.writableEnded)abort.abort();};res.on('close',disconnected);
        try{
          const result=await providerFactory(settings).transcribe(audio,mime,{signal:abort.signal,language});
          if(!res.destroyed)json(res,200,result);
        }finally{clearTimeout(timer);res.off('close',disconnected);}
        }finally{release();}
        return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'method-not-allowed'});return;}
      if(apiOnly){json(res,404,{error:'api-only'});return;}
      // Only public app assets are served. .env, server code, tests and dotfiles are never public.
      const publicPath=pathname==='/'?'/index.html':pathname;
      if(!(publicPath==='/index.html'||/^\/src\/[a-z0-9-]+\.(js|css)$/u.test(publicPath)||publicPath==='/docs/assets.svg')){json(res,404,{error:'not-found'});return;}
      const target=await realpath(path.resolve(root,'.'+publicPath));
      if(!target.startsWith(root+path.sep)){json(res,403,{error:'forbidden'});return;}
      const data=await readFile(target);
      res.writeHead(200,{'Content-Type':types[path.extname(target)]+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'microphone=(self)'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(error){
      if(res.destroyed)return;
      if(error instanceof SttError)json(res,error.status,{error:error.code,source:error.source});
      else json(res,error.code==='ENOENT'?404:500,{error:error.code==='ENOENT'?'not-found':'server-error'});
    }
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const settings=await readConfig(projectURL);
  const server=createApp();server.requestTimeout=75000;
  server.listen(settings.port,process.env.RENDER==='true'?'0.0.0.0':'127.0.0.1',()=>console.log(`Korean Stickman listening on port ${settings.port}`));
}
