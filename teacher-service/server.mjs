import http from 'node:http';import {pathToFileURL} from 'node:url';import {LessonRooms,RoomError} from './rooms.mjs';
function validOrigin(value){const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('invalid-frontend-origin');return u.origin;}
function readJson(req){
 return new Promise((resolve,reject)=>{let size=0,done=false;const chunks=[];
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('aborted',abort);req.off('error',abort);if(error){req.pause();reject(error);}else{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new RoomError(400,'invalid-json'));}}};
  const data=chunk=>{size+=chunk.length;if(size>32768)finish(new RoomError(413,'too-large'));else chunks.push(chunk);},end=()=>finish(),abort=()=>finish(new RoomError(408,'request-aborted'));
  const timer=setTimeout(()=>finish(new RoomError(408,'upload-timeout')),5000);req.on('data',data);req.once('end',end);req.once('aborted',abort);req.once('error',abort);
 });
}
export function createTeacherHandler({rooms,origins,now=Date.now}){
 const allowed=origins.map(validOrigin),rates=new Map();
 function limit(key,max){const cut=now()-60000,list=(rates.get(key)||[]).filter(t=>t>cut);if(list.length>=max)throw new RoomError(429,'rate-limit');list.push(now());rates.set(key,list);if(rates.size>2000)for(const [k,v]of rates)if(v.at(-1)<cut)rates.delete(k);}
 return async(req,res)=>{
  req.on('error',()=>{});
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Origin'};
  const send=(status,data)=>{if(!res.destroyed){res.writeHead(status,h);res.end(status===204?null:JSON.stringify(data));}};
  try{
   if(['/health','/teacher-api/health'].includes(req.url)&&req.method==='GET')return send(200,{ok:true,service:'teacher-mode',version:'0.3.0'});
   if(!allowed.includes(req.headers.origin))throw new RoomError(403,'forbidden-origin');
   h['Access-Control-Allow-Origin']=req.headers.origin;
   const path=req.url;if(path.includes('?')||path.includes('#'))throw new RoomError(404,'not-found');
   const match=path.match(/^\/teacher-api\/rooms\/([a-f0-9]{32})\/(join|student-sync|teacher-sync|commands|ack|leave|close)$/u),create=path==='/teacher-api/rooms';
   if(!create&&!match)throw new RoomError(404,'not-found');
   if(req.method==='OPTIONS'){
    const requested=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(req.headers['access-control-request-method']!=='POST'||requested.some(x=>!['content-type','authorization'].includes(x)))throw new RoomError(403,'forbidden');
    Object.assign(h,{'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type, authorization','Access-Control-Max-Age':'600'});return send(204,{});
   }
   if(req.method!=='POST')throw new RoomError(405,'method-not-allowed');
   if(!/^application\/json(?:;|$)/iu.test(req.headers['content-type']||''))throw new RoomError(415,'json-required');
   limit('ip:'+req.socket.remoteAddress,600);
   if(create)limit('create:'+req.socket.remoteAddress,5);
   if(Number(req.headers['content-length'])>32768)throw new RoomError(413,'too-large');
   const body=await readJson(req);
   if(create){if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length)throw new RoomError(400,'invalid-data');return send(201,rooms.create());}
   const [,roomId,route]=match,authorization=req.headers.authorization||'',credential=/^Bearer ([a-f0-9]{64})$/u.exec(authorization)?.[1];
   if(route==='join'){limit('join:'+roomId,12);return send(200,rooms.join(roomId,body));}
   if(!credential)throw new RoomError(403,'forbidden');
   const role=['teacher-sync','commands','close'].includes(route)?'teacher':'student';rooms.auth(roomId,credential,role);limit(roomId+':'+role,240);
   if(route==='student-sync')return send(200,rooms.studentSync(roomId,credential,body));
   if(route==='teacher-sync'){if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length)throw new RoomError(400,'invalid-data');return send(200,rooms.teacherSync(roomId,credential));}
   if(route==='commands'){limit(roomId+':commands',24);return send(200,rooms.command(roomId,credential,body));}
   if(route==='ack')return send(200,rooms.acknowledge(roomId,credential,body));
   if(route==='leave')return send(200,rooms.leave(roomId,credential,body));
   if(route==='close'){if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).length)throw new RoomError(400,'invalid-data');return send(200,rooms.close(roomId,credential));}
  }catch(error){if(!req.complete)h.Connection='close';if(error.status===429)h['Retry-After']='60';send(error instanceof RoomError?error.status:500,{ok:false,error:error instanceof RoomError?error.code:'server-error'});}
 };
}
export function createTeacherServer({rooms=new LessonRooms(),origins=['https://averanges.github.io'],now=Date.now}={}){
 const server=http.createServer({maxHeaderSize:16384},createTeacherHandler({rooms,origins,now}));
 server.requestTimeout=10000;server.headersTimeout=5000;server.setTimeout(12000,s=>s.destroy());
 const cleanup=setInterval(()=>rooms.cleanup(),60000);cleanup.unref();server.once('close',()=>clearInterval(cleanup));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=Number(process.env.PORT||8083);if(!Number.isInteger(port)||port<1||port>65535)throw Error('invalid-port');
 const origins=process.env.FRONTEND_ORIGINS?process.env.FRONTEND_ORIGINS.split(',').map(s=>s.trim()):process.env.NODE_ENV==='production'?['https://averanges.github.io']:['https://averanges.github.io','http://localhost:5175','http://127.0.0.1:5175'];
 const server=createTeacherServer({origins});server.listen(port,'0.0.0.0',()=>console.log('Teacher service listening on port '+port));
 const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections();process.exit(0);},5000).unref();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
