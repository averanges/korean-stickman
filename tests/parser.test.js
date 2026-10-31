import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKorean, interpretSpeech, hasBatchim } from '../src/parser.js';
import { catalogs, appearance } from '../src/catalog.js';

test('all 18 characteristics support bare nouns and all three sentence formats',()=>{
  for(const [field,catalog] of Object.entries(catalogs))for(const [value,item] of Object.entries(catalog)){
    const ending=hasBatchim(item.ko)?'이에요':'예요';
    for(const prefix of ['','저는 ','이 사람은 ']){
      for(const punctuation of ['','.','!']){
        const command=parseKorean(prefix+item.ko+ending+punctuation);
        assert.equal(command.ok,true,prefix+item.ko+ending);assert.equal(command.field,field);assert.equal(command.value,value);
      }
    }
    assert.equal(parseKorean(item.ko).value,value);
    const wrong=hasBatchim(item.ko)?'예요':'이에요';
    assert.equal(parseKorean(item.ko+wrong).type,'form');
  }
});
test('greetings, Unicode and recognition spacing',()=>{
  for(const text of ['안녕하세요','안녕!','  안녕하세요. ','안녕하세요'.normalize('NFD')])assert.equal(parseKorean(text).action,'greet');
  assert.equal(parseKorean('이사람은러시아사람이에요').value,'russia');
  assert.equal(parseKorean('저 는 학 생 이 에 요').value,'student');
  assert.equal(parseKorean('한국인이에요').value,'korea');
});
test('never guesses unknown or compound statements or opposite attributes',()=>{
  for(const text of ['','저는 학생이 아니에요','남자와 여자예요','학생이고 의사예요','저는 교수예요','<script>'])assert.equal(parseKorean(text).ok,false,text);
  assert.equal(parseKorean('남자예요').value,'male');assert.equal(parseKorean('여자예요').value,'female');
});
test('speech uses alternatives conservatively and keeps grammar claims tentative',()=>{
  const options=(...texts)=>texts.map(text=>({text,confidence:.8}));
  assert.equal(interpretSpeech(options('???','학생이에요')).value,'student');
  assert.equal(interpretSpeech(options('???','학생이에요','의사예요')).ok,false);
  assert.equal(interpretSpeech(options('남자이에요','여자예요')).value,'male');
  assert.equal(interpretSpeech(options('남자에요','여자예요')).value,'male');
  assert.equal(interpretSpeech(options('남자는','여자예요')).ok,false);
  assert.equal(interpretSpeech(options('저는 학생이 아니에요','학생이에요')).ok,false);
  assert.equal(interpretSpeech(options('여자예요','남자예요')).value,'female');
  assert.equal(interpretSpeech(options('학생예요','학생이에요')).value,'student');
  assert.equal(interpretSpeech(options('학생예요')).pronunciationAdjusted,true);
});
test('voice never completes bare nouns; exact repetitions and copula variants preserve intent',()=>{
  for(const text of ['저는','학생','러시아 사람','의사'])assert.equal(interpretSpeech([{text}]).ok,false);
  assert.equal(interpretSpeech([{text:'저는 저는 러시아 사람이에요'}]).value,'russia');
  assert.equal(interpretSpeech([{text:'러시아 러시아 사람이에요'}]).value,'russia');
  assert.equal(interpretSpeech([{text:'여자에요'}]).value,'female');
  assert.equal(interpretSpeech([{text:'러시아 아니 프랑스 사람이에요'}]).ok,false);
});
test('one hat, independent flag, restored country hat and exclusive job attachments',()=>{
  for(const gender of Object.keys(catalogs.gender))for(const [country,nation] of Object.entries(catalogs.country))for(const [profession,job] of Object.entries(catalogs.profession)){
    const look=appearance({gender,country,profession});
    assert.equal(look.hat,job.slot==='hat'?job.asset:nation.hat);assert.equal(look.flag,nation.flag);
    for(const slot of ['hand','back','body'])assert.equal(look[slot],job.slot===slot?job.asset:null);
  }
  const hero={country:'russia',profession:'chef',gender:'female'};
  assert.deepEqual(appearance(hero),{hair:'bob',hat:'chef',flag:'ru',hand:null,back:null,body:null});
  const next=appearance({...hero,profession:'student'});
  assert.equal(next.hat,'ushanka');assert.equal(next.back,'backpack');
  const doctor=appearance({...hero,country:'france',profession:'doctor'});
  assert.equal(doctor.hat,'beret');assert.equal(doctor.body,'stethoscope');assert.equal(doctor.back,null);assert.equal(doctor.flag,'fr');
});
