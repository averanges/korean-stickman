import test from 'node:test';
import assert from 'node:assert/strict';
import {parseKorean,interpretSpeech} from '../src/parser.js';
test('all supplied formulations identify country independently of wording',()=>{
  for(const text of ['저는 한국 사람이에요.','안녕하세요. 저는 한국 사람이에요.','저는 여기 한국 사람이에요.','저는 한국 사람입니다.','남자는 한국 사람이에요.','이 사람은 한국 사람이에요.','알렉스 씨는 한국 사람이에요.','알렉스 씨가 한국 사람입니다.','한국 사람이에요.']){
    const result=parseKorean(text,{name:'알렉스'});assert.equal(result.ok,true,text);assert.deepEqual(result.intents,[{field:'country',value:'korea'}]);
    assert.equal(interpretSpeech([{text}],{name:'알렉스'}).value,'korea');
  }
});
test('profession is never country and formal endings preserve meaning',()=>{
  for(const text of ['저는 학생이에요','저는 학생입니다','안녕하세요. 저는 학생입니다. 감사합니다.']){const result=parseKorean(text);assert.equal(result.field,'profession');assert.equal(result.value,'student');}
});
test('selected names and subject particles are contextual, never arbitrary people',()=>{
  for(const suffix of ['씨는','씨가','은','이'])assert.equal(parseKorean(`알렉스${suffix} 한국 사람입니다`,{name:'알렉스'}).ok,true);
  for(const text of ['민수는 한국 사람이에요','그 사람은 한국 사람이에요','친구는 한국 사람이에요','알렉스 씨는 한국 사람이에요'])assert.equal(parseKorean(text,{name:'안나'}).ok,false);
  assert.equal(parseKorean('남자는 한국 사람이에요',{gender:'female'}).ok,false);
  assert.equal(parseKorean('여자는 한국 사람이에요',{gender:'female'}).ok,true);
  assert.equal(parseKorean('저는 여자입니다. 남자는 한국 사람이에요').ok,false);
});
test('negations, contradictory identities, questions and reported claims never apply',()=>{
  for(const text of ['저는 한국 사람이 아니에요','저는 한국 사람이에요. 저는 미국 사람이에요.','저는 학생입니다. 의사예요.','한국 사람이에요?','저는 한국 사람일지도 몰라요','민수는 학생입니다. 저는 한국 사람이에요','저는 한국 사람이에요. 캐나다 사람입니다.','저는 학생이고 의사예요']){
    assert.equal(parseKorean(text).ok,false,text);assert.equal(interpretSpeech([{text}]).ok,false,text);
  }
});
test('multiple compatible facts are kept distinct and validated before any application',()=>{
  const result=parseKorean('안녕하세요. 저는 한국 사람입니다. 저는 학생이에요.');
  assert.equal(result.ok,true);assert.deepEqual(result.intents,[{field:'country',value:'korea'},{field:'profession',value:'student'}]);assert.equal(result.commands.length,2);
  assert.equal(parseKorean('저는 한국 사람이에요. 오늘 날씨가 좋아요.').ok,true);
  assert.equal(parseKorean('저는 한국 사람이에요. 감사합니다.').ok,true);
  assert.equal(parseKorean('저는 한국 사람이고 학생입니다').commands.length,2);
});
