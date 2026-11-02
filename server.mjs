import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readConfig } from './server/config.mjs';
import {GroqWhisper} from './server/stt.mjs';
import {createSttApi,API_PATHS} from './server/api.mjs';
import {nodeApi} from './server/http-adapters.mjs';
import { publicOrigins, frontendOrigins as configuredFrontends, allowedRequest, SttGate } from './server/security.mjs';
const projectURL=new URL('.',import.meta.url);
const root=path.resolve(fileURLToPath(projectURL));
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
export function createApp({config=()=>readConfig(projectURL),providerFactory=options=>new GroqWhisper(options),origins=publicOrigins(),frontends=configuredFrontends(),apiOnly=process.env.RENDER==='true'||process.env.API_ONLY==='true',gate=new SttGate()}={}){
  const api=createSttApi({platform:'render',config,providerFactory,origins,frontends,gate});
  return http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host||'';
      if(!allowedRequest(req,origins,frontends)){json(res,403,{error:'forbidden'});return;}
      const pathname=decodeURIComponent(new URL(req.url,`http://${host}`).pathname);
      if(API_PATHS.includes(pathname)){await nodeApi(api,req,res,pathname);return;}
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
      json(res,error.code==='ENOENT'?404:500,{error:error.code==='ENOENT'?'not-found':'server-error'});
    }
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const settings=await readConfig(projectURL);
  const server=createApp();server.requestTimeout=75000;
  server.listen(settings.port,process.env.RENDER==='true'?'0.0.0.0':'127.0.0.1',()=>console.log(`Korean Stickman listening on port ${settings.port}`));
}
