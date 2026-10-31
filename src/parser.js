import { catalogs } from './catalog.js';
import { semanticMeaning } from './meaning.js';
export function hasBatchim(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}
const entries = Object.entries(catalogs).flatMap(([field, catalog]) => Object.entries(catalog).map(([value, entry]) => ({ field, value, ...entry })));
const compact = text => text.replace(/\s+/gu, '');
function parseSimple(raw) {
  const text = String(raw || '').normalize('NFC').trim().replace(/[.!?。？！]+$/u, '').trim();
  let body = compact(text);
  if (['안녕하세요', '안녕'].includes(body)) return { ok: true, action: 'greet', text, canonical: '안녕하세요' };
  body = body.replace(/^(이사람은|저는)/u, '');
  for (const entry of entries) {
    const noun = compact(entry.ko);
    const nouns = entry.field === 'country' ? [noun, noun.replace(/사람$/u, '인')] : [noun];
    for (const candidate of nouns) {
      const ending = hasBatchim(candidate) ? '이에요' : '예요';
      const canonical = `${entry.ko}${hasBatchim(noun) ? '이에요' : '예요'}`;
      if (body === candidate || body === candidate + ending) return { ok: true, action: 'set', field: entry.field, value: entry.value, text, canonical };
      if ([candidate + (ending === '이에요' ? '예요' : '이에요'), candidate+'에요', candidate+'이예요'].includes(body)) return {
        ok: false, type: 'form', field: entry.field, value: entry.value, correction: canonical,
        message: `Попробуй так: ${canonical}. После «${entry.ko}» здесь используется ${ending}.`,
      };
    }
  }
  return { ok: false, type: 'unknown', message: text ? 'Пока не понял фразу. Попробуй ещё раз — например, 학생이에요.' : 'Скажи приветствие или расскажи о герое. Например, 안녕하세요.' };
}
export function parseKorean(raw,context={}) {
  const result=semanticMeaning(raw,context,parseSimple)||parseSimple(raw);
  return {...result,reason:result.reason||(result.ok?'supported-short-form':result.type||'unknown'),intents:result.intents||(result.ok&&result.action==='set'?[{field:result.field,value:result.value}]:[])};
}
export function interpretSpeech(alternatives,context={}) {
  const options = alternatives.filter(value => typeof value?.text === 'string').slice(0, 5);
  const first = options[0]?.text || '';
  const parseVoice=text=>{
    // Only exact adjacent repetitions are collapsed; different claims are never selected for the speaker.
    const tokens=text.normalize('NFC').trim().split(/\s+/u).filter((token,index,array)=>index===0||token!==array[index-1]);
    const cleaned=tokens.join(' ').replace(/^(저는){2,}/u,'저는');
    let command=parseKorean(cleaned,{...context,voice:true});
    const completed=command.reason==='unambiguous-hero-assertion'||/(이에요|예요|에요|이예요|입니다)[.!?。？！]*\s*$/u.test(cleaned);
    if(command.ok&&command.action==='set'&&!completed)return {...command,ok:false,type:'incomplete',reason:'incomplete',message:'Фраза ещё не закончена. Попробуй произнести её целиком и завершить запись самостоятельно.'};
    if(!command.ok&&command.type==='form'&&completed){const corrected=parseKorean(command.correction);command={...corrected,heard:text,pronunciationAdjusted:true};}
    return command;
  };
  const primary = parseVoice(first);
  if (primary.ok) return { ...primary, heard: first, usedAlternative: false };
  if(primary.type==='incomplete')return {...primary,heard:first};
  if(primary.type==='meaning')return {...primary,heard:first};
  const heardBody=compact(first);
  const mentions=entries.filter(entry=>heardBody.includes(compact(entry.ko)) || (entry.field==='country'&&heardBody.includes(compact(entry.ko).replace(/사람$/u,'인'))));
  const valid = options.slice(1).map(option => ({ option, command: parseVoice(option.text) })).filter(({ command }) => command.ok);
  const identities = new Set(valid.map(({ command }) => `${command.action}:${command.field}:${command.value}`));
  // Never replace a known characteristic with a different one.
  const safe = valid.find(({ command }) =>
    (!primary.field || (command.field === primary.field && command.value === primary.value)) &&
    mentions.every(entry=>entry.field===command.field&&entry.value===command.value) &&
    !/아니|않|없|말고|또는|그리고/u.test(heardBody));
  if (safe && identities.size === 1) return { ...safe.command, heard: first, usedAlternative: true };
  return { ...primary, heard: first, message: primary.correction ? `Распознавание могло ошибиться. Попробуй ещё раз: ${primary.correction}.` : 'Не удалось уверенно понять речь. Проверь текст или повтори фразу.' };
}
