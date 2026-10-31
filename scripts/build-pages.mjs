import {mkdir,readFile,writeFile,readdir,lstat,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function buildPages({apiBase=process.env.API_BASE_URL,output}={}){
  if(!apiBase)throw Error('Set public API_BASE_URL, for example https://your-service.onrender.com');
  const api=new URL(apiBase);
  if(api.protocol!=='https:'||api.username||api.password||api.pathname!=='/'||api.search||api.hash)throw Error('API_BASE_URL must be an HTTPS origin without credentials or path');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const target=output?path.resolve(output):path.join(root,'dist');
  // Clean only the explicit default build directory; test outputs use fresh temporary directories.
  if(!output){if(path.dirname(target)!==path.resolve(root)||path.basename(target)!=='dist')throw Error('Unsafe build directory');await rm(target,{recursive:true,force:true});}
  await mkdir(path.join(target,'src'),{recursive:true});
  await copyFile(path.join(root,'index.html'),path.join(target,'index.html'));
  await mkdir(path.join(target,'docs'),{recursive:true});
  await copyFile(path.join(root,'docs','assets.svg'),path.join(target,'docs','assets.svg'));
  for(const file of await readdir(path.join(root,'src'))){
    if(!/^[a-z0-9-]+\.(js|css)$/u.test(file))continue;
    const source=path.join(root,'src',file);if(!(await lstat(source)).isFile())throw Error('Source assets must be regular files');
    await copyFile(source,path.join(target,'src',file));
  }
  const template=await readFile(path.join(root,'src','api-config.js'),'utf8');
  await writeFile(path.join(target,'src','api-config.js'),template.replace("export const API_BASE_URL='';",`export const API_BASE_URL=${JSON.stringify(api.origin)};`));
  await writeFile(path.join(target,'.nojekyll'),'');
  return target;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){await buildPages();console.log('Pages frontend built in dist/ (public files only).');}
