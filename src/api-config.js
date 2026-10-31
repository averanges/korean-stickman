// Public backend address only. The Pages build can override it; never put API keys here.
export const API_BASE_URL='https://korean-stickman.onrender.com';
export function apiUrl(route,base=API_BASE_URL,location=globalThis.location){
  // Local development always uses its own server, including the unbuilt source files.
  if(['localhost','127.0.0.1'].includes(location?.hostname))return route;
  if(!base){
    throw Object.assign(new Error('api-unconfigured'),{code:'api-unconfigured'});
  }
  const url=new URL(base);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Object.assign(new Error('api-unconfigured'),{code:'api-unconfigured'});
  return url.origin+route;
}
