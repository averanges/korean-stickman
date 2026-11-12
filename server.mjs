import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readConfig } from './server/config.mjs';
import {GroqWhisper} from './server/stt.mjs';
import {createSttApi,API_PATHS} from './server/api.mjs';
import {nodeApi} from './server/http-adapters.mjs';
import { publicOrigins, frontendOrigins as configuredFrontends, allowedRequest, SttGate } from './server/security.mjs';
import { createTeacherHandler } from './teacher-service/server.mjs';
import { LessonRooms } from './teacher-service/rooms.mjs';
const projectURL=new URL('.',import.meta.url);
const root=path.resolve(fileURLToPath(projectURL));
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
export function createApp({config=()=>readConfig(projectURL),providerFactory=options=>new GroqWhisper(options),origins=publicOrigins(),frontends=configuredFrontends(),apiOnly=process.env.RENDER==='true'||process.env.API_ONLY==='true',renderLessons=process.env.RENDER==='true',localLessonsPort,teacherPreview=false,gate=new SttGate(),interpreterFactory,llmGate,llmTimeoutMs,experimentProviderFactory,experimentGate,experimentTimeoutMs}={}){
  const previewOrigin=teacherPreview?origins[0]:null;
  if(teacherPreview&&(!previewOrigin||origins.length!==1||apiOnly))throw Error('Teacher preview needs one public HTTPS origin and full-stack mode');
  const api=createSttApi({platform:'render',config,providerFactory,origins,frontends,gate,interpreterFactory,llmGate,llmTimeoutMs,experimentProviderFactory,experimentGate,experimentTimeoutMs});
  const lessonOrigins=previewOrigin?[previewOrigin]
    :renderLessons?(frontends.length?frontends:['https://averanges.github.io'])
    :localLessonsPort&&!apiOnly?[`http://localhost:${localLessonsPort}`,`http://127.0.0.1:${localLessonsPort}`]:[];
  const lessonRooms=lessonOrigins.length?new LessonRooms():null;
  const lessonHandler=lessonRooms&&createTeacherHandler({rooms:lessonRooms,origins:lessonOrigins});
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host||'';
      if(lessonHandler&&req.url.startsWith('/teacher-api/')){
        if(!allowedRequest(req,origins,lessonOrigins)){json(res,403,{error:'forbidden'});return;}
        await lessonHandler(req,res);
        return;
      }
      if(!allowedRequest(req,origins,frontends)){json(res,403,{error:'forbidden'});return;}
      const pathname=decodeURIComponent(new URL(req.url,`http://${host}`).pathname);
      if(API_PATHS.includes(pathname)){await nodeApi(api,req,res,pathname);return;}
      if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'method-not-allowed'});return;}
      if(apiOnly){json(res,404,{error:'api-only'});return;}
      // Only public app assets are served. .env, server code, tests and dotfiles are never public.
      const publicPath=pathname==='/'?'/index.html':pathname;
      if(!(publicPath==='/index.html'||publicPath==='/teacher.html'||/^\/src\/[a-z0-9-]+\.(js|css)$/u.test(publicPath)||publicPath==='/docs/assets.svg')){json(res,404,{error:'not-found'});return;}
      const target=await realpath(path.resolve(root,'.'+publicPath));
      if(!target.startsWith(root+path.sep)){json(res,403,{error:'forbidden'});return;}
      let data=await readFile(target);
      if(previewOrigin&&publicPath==='/src/teacher-config.js'){
        data=data.toString().replace(/^export const TEACHER_API_BASE_URL=.*;$/mu,`export const TEACHER_API_BASE_URL=${JSON.stringify(previewOrigin)};`);
      }
      if(previewOrigin&&publicPath==='/src/api-config.js'){
        data=data.toString().replace(/^export const API_BASE_URL=.*;$/mu,`export const API_BASE_URL=${JSON.stringify(previewOrigin)};`);
      }
      res.writeHead(200,{'Content-Type':types[path.extname(target)]+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'microphone=(self)'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(error){
      if(res.destroyed)return;
      json(res,error.code==='ENOENT'?404:500,{error:error.code==='ENOENT'?'not-found':'server-error'});
    }
  });
  if(lessonRooms){
    const cleanup=setInterval(()=>lessonRooms.cleanup(),60000);
    cleanup.unref();
    server.once('close',()=>clearInterval(cleanup));
  }
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const settings=await readConfig(projectURL);
  const localLessons=process.argv.includes('--teacher-local');
  const teacherPreview=process.argv.includes('--teacher-preview');
  const port=localLessons&&!process.env.PORT?5175:settings.port;
  const server=createApp({localLessonsPort:localLessons?port:undefined,teacherPreview,apiOnly:teacherPreview?false:undefined});server.requestTimeout=75000;
  server.listen(port,process.env.RENDER==='true'?'0.0.0.0':'127.0.0.1',()=>console.log(`Korean Stickman listening on port ${port}`));
}
