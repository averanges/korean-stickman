import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldState, STORAGE_KEY, sanitizeProfile } from '../src/world.js';
import { parseKorean } from '../src/parser.js';
import { ActionController } from '../src/controller.js';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};};
test('profile survives reload, keeps independent attributes and derives visual slots',()=>{
  const store=storage(),world=new WorldState(store);
  assert.equal(world.profile.awake,false);
  world.setName('  민수  ');
  for(const text of ['여자예요','러시아 사람이에요','요리사예요'])world.apply(parseKorean(text));
  const restored=new WorldState(store);
  assert.equal(restored.profile.name,'민수');assert.equal(restored.profile.country,'russia');assert.equal(restored.profile.visual.hat,'chef');assert.equal(restored.profile.visual.flag,'ru');
  restored.apply(parseKorean('프랑스 사람이에요'));assert.equal(restored.profile.profession,'chef');assert.equal(restored.profile.gender,'female');
  assert.equal(restored.profile.visual.hat,'chef');assert.equal(restored.profile.visual.flag,'fr');
  restored.reset();assert.equal(new WorldState(store).profile.awake,false);
});
test('storage failure, malformed saves and invalid IDs do not crash the game',()=>{
  const bad={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  const world=new WorldState(bad);assert.equal(world.profile.name,'');assert.equal(world.storageAvailable,false);world.setName('A');assert.equal(world.profile.name,'A');
  const store=storage();store.setItem(STORAGE_KEY,'{broken');assert.equal(new WorldState(store).profile.country,null);
  const restored=sanitizeProfile({version:2,name:34,gender:'__proto__',country:'neverland',profession:'chef',visual:{hat:'ushanka'}});
  assert.equal(restored.gender,null);assert.equal(restored.country,null);assert.equal(restored.visual.hat,'chef');
});
function mockRenderer(log){return {async wake(){log.push('wake');return true;},async confused(){log.push('confused');return true;},async changeAppearance(next){log.push(next.gender);return true;},async equip(command){log.push(command.value);return true;},setProfile(){},reset(){log.push('reset');}};}
test('a characteristic wakes automatically; queue is serial; duplicates skip search',async()=>{
  const world=new WorldState(storage()),log=[],controller=new ActionController(world,mockRenderer(log));
  const commands=['학생이에요','러시아 사람이에요','요리사예요','프랑스 사람이에요','여자예요','여자예요'];
  await Promise.all(commands.map(text=>controller.run(parseKorean(text))));
  assert.deepEqual(log,['wake','student','russia','chef','france','female']);
  assert.equal(world.profile.country,'france');assert.equal(world.profile.profession,'chef');assert.equal(world.busy,false);
  await controller.run(parseKorean('непонятно'));assert.equal(log.at(-1),'confused');assert.equal(world.profile.country,'france');
});
test('state commits after completed animation; cancel discards current and queued commands',async()=>{
  const world=new WorldState(storage()),log=[];world.apply(parseKorean('안녕'));
  let finish;
  const renderer=mockRenderer(log);renderer.equip=()=>new Promise(resolve=>{finish=resolve;});
  const controller=new ActionController(world,renderer);
  const current=controller.run(parseKorean('러시아 사람이에요'));
  const queued=controller.run(parseKorean('학생이에요'));
  assert.equal(world.profile.country,null);controller.reset();finish(true);
  assert.equal((await current).cancelled,true);assert.equal((await queued).cancelled,true);
  assert.equal(world.profile.country,null);assert.equal(world.profile.awake,false);assert.equal(world.busy,false);
});
test('empty profile can be saved for the next level without mandatory fields',()=>{
  const store=storage(),world=new WorldState(store);assert.equal(world.save(),true);
  const next=new WorldState(store);assert.equal(next.profile.name,'');assert.equal(next.profile.country,null);
});
