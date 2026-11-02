import {mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),target=path.resolve(root,'backend-public');
if(path.dirname(target)!==path.resolve(root)||path.basename(target)!=='backend-public')throw Error('Unsafe build directory');
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await writeFile(path.join(target,'index.html'),'<!doctype html><meta charset="utf-8"><title>Korean Stickman API</title><p>Korean Stickman API. Use /health. The game is hosted separately.</p>');
