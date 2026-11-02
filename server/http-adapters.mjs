import {SttError} from './stt.mjs';
export async function readStream(stream,maxBytes,signal){
 const chunks=[];let size=0;
 if(!stream)return new Uint8Array();
 const iterator=stream.iterator?stream.iterator({destroyOnReturn:false}):stream[Symbol.asyncIterator]();
 let abort;
 const interrupted=new Promise((_,reject)=>{abort=()=>reject(new SttError('timeout',504));signal?.addEventListener('abort',abort,{once:true});});
 try{while(true){if(signal?.aborted)throw new SttError('timeout',504);const result=await Promise.race([iterator.next(),interrupted]);if(result.done)break;const chunk=result.value;size+=chunk.byteLength;if(size>maxBytes)throw new SttError('too-large',413);chunks.push(chunk);}return Buffer.concat(chunks.map(c=>Buffer.from(c)),size);}
 finally{signal?.removeEventListener('abort',abort);if(size>maxBytes||signal?.aborted)Promise.resolve(iterator.return?.()).catch(()=>{});}
}
export async function nodeApi(api,req,res,path){
 const controller=new AbortController(),closed=()=>{if(!res.writableEnded)controller.abort();};res.on('close',closed);
 try{const result=await api({method:req.method,path,headers:req.headers,signal:controller.signal,readBody:(max,signal)=>readStream(req,max,signal)});if(!res.destroyed){res.writeHead(result.status,result.headers);res.end(result.body);}}
 finally{res.off('close',closed);}
}
export function webApi(api){return async(request,path=new URL(request.url).pathname)=>{
 const headers=Object.fromEntries(request.headers.entries());headers.host=new URL(request.url).host;
 const result=await api({method:request.method,path,headers,signal:request.signal,readBody:(max,signal)=>readStream(request.body,max,signal)});
 return new Response(result.body,{status:result.status,headers:result.headers});
};}
