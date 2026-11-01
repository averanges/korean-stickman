import {parseKorean,interpretSpeech} from './parser.js';
import {parseRoom} from './room-state.js';
const creator={привет:'안녕하세요',здравствуй:'안녕하세요',здравствуйте:'안녕하세요','я мужчина':'남자예요','я женщина':'여자예요','я из россии':'러시아 사람이에요','я из кореи':'한국 사람이에요','я студент':'학생이에요','я учитель':'선생님이에요','я врач':'의사예요'};
const nouns={стол:'책상',стул:'의자',кровать:'침대',книгу:'책',воду:'물',яблоко:'사과'};
const actions={'прочитай книгу':'책을 읽어요','выпей воду':'물을 마셔요','съешь яблоко':'사과를 먹어요','сядь на стул':'의자에 앉아요',встань:'일어나요','ляг на кровать':'침대에 누워요','поспи на кровати':'침대에서 자요','включи лампу':'전등을 켜요','выключи лампу':'전등을 꺼요','удали стол':'책상이 없어요'};
export function interpretRussian(raw,{home=false,profile={},voice=false}={}){
 const heard=String(raw||'').normalize('NFC').trim(),text=heard.toLowerCase().replace(/ё/gu,'е').replace(/[.!?,;:«»"]/gu,'').replace(/\s+/gu,' ').trim();let korean;
 if(home){const create=text.match(/^(создай|поставь|добавь) (.+)$/u);korean=create&&nouns[create[2]]?nouns[create[2]]+' 있어요':actions[text];}else korean=creator[text];
 if(!korean||/[?？]/u.test(heard))return {ok:false,heard,type:'unknown',reason:'unknown-russian-test-command',message:`Я услышал «${heard.slice(0,200)}», но не понял команду.`};
 const result=home?parseRoom(korean):voice?interpretSpeech([{text:korean}],profile):parseKorean(korean,profile);return {...result,heard,sourceText:heard};
}
