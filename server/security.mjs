export function publicOrigins(env=process.env){
  const configured=env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||(env.RENDER_EXTERNAL_HOSTNAME?`https://${env.RENDER_EXTERNAL_HOSTNAME}`:'');
  if(!configured)return [];
  const url=new URL(configured);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('invalid-public-origin');
  return [url.origin];
}
export function frontendOrigins(env=process.env){
  if(!env.FRONTEND_ORIGIN)return [];
  const url=new URL(env.FRONTEND_ORIGIN);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('invalid-frontend-origin');
  return [url.origin];
}
export function allowedRequest(req,origins,frontends=[]){
  const host=req.headers.host||'';
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/u.test(host);
  const origin=origins.find(value=>new URL(value).host===host);
  if(!local&&!origin)return false;
  if(!req.headers.origin)return true;
  return frontends.includes(req.headers.origin)||req.headers.origin===(origin||`http://${host}`);
}
export class SttGate{
  constructor({maximum=2,perMinute=20,now=Date.now}={}){this.maximum=maximum;this.perMinute=perMinute;this.now=now;this.active=0;this.started=[];}
  acquire(){
    const time=this.now();this.started=this.started.filter(value=>time-value<60000);
    if(this.active>=this.maximum||this.started.length>=this.perMinute)return null;
    this.started.push(time);this.active++;let released=false;
    return ()=>{if(!released){released=true;this.active--;}};
  }
}
