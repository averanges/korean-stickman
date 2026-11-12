import test from 'node:test';import assert from 'node:assert/strict';
import {FAMILY} from '../src/identity-topics.js';import {LanguageService} from '../src/language-service.js';import {safeContext} from '../src/language-contract.js';
const service=new LanguageService({endpoint:()=>{throw Error('Family must be handled locally before the generic fallback');}}),context=safeContext({level:'creator'});
test('all family aliases work with optional 저는 and omitted particles through the full voice interpreter',async()=>{
 for(const [id,item]of Object.entries(FAMILY))for(const noun of item.aliases)for(const subject of ['', '저는 '])for(const particle of ['', /[가-힣]$/u.test(noun)&&((noun.charCodeAt(noun.length-1)-0xac00)%28)?'이':'가'])for(const ending of ['있어요','없어요']){
  const raw=subject+noun+particle+' '+ending,result=await service.interpret(raw,context,{voice:true});assert.equal(result.command?.action,'family',raw);assert.deepEqual(result.command.members,[id],raw);assert.equal(result.command.present,ending==='있어요',raw);assert.equal(result.llmRequested,false,raw);
 }
});
test('mixed family lists keep every relative and deduplicate aliases without requiring a final particle',async()=>{
 for(const raw of ['엄마하고 아빠 있어요','저는 엄마하고 아빠 있어요','엄마하고 아빠가 있어요','엄마와 어머니하고 아빠 있어요']){const r=await service.interpret(raw,context,{voice:true});assert.deepEqual(r.command?.members,['mother','father'],raw);}
});
test('omitting particles does not turn questions, past or unrelated statements into family actions',async()=>{
 for(const raw of ['엄마 있어요?','저는 엄마 있어요?','아빠 없어요?','엄마 있었어요','엄마 없었어요','엄마 안 있어요','엄마가 아니에요','엄마 있어요라고 말해요','민수는 엄마 있어요','친구는 엄마 있어요','엄마하고 있어요','엄마'])assert.equal((await service.interpret(raw,context,{voice:true})).command,null,raw);
});
