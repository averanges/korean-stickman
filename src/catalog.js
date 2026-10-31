// Stable IDs form the contract between this level and future levels.
export const genders = {
  female: { ko: '여자', label: 'Женский', hair: 'bob' },
  male: { ko: '남자', label: 'Мужской', hair: 'tuft' },
};
export const countries = {
  china: { ko: '중국 사람', label: 'Китай', flag: 'cn', hat: 'china' },
  korea: { ko: '한국 사람', label: 'Корея', flag: 'kr', hat: 'korea' },
  usa: { ko: '미국 사람', label: 'США', flag: 'us', hat: 'cowboy' },
  japan: { ko: '일본 사람', label: 'Япония', flag: 'jp', hat: 'japan' },
  germany: { ko: '독일 사람', label: 'Германия', flag: 'de', hat: 'alpine' },
  france: { ko: '프랑스 사람', label: 'Франция', flag: 'fr', hat: 'beret' },
  russia: { ko: '러시아 사람', label: 'Россия', flag: 'ru', hat: 'ushanka' },
  uk: { ko: '영국 사람', label: 'Великобритания', flag: 'gb', hat: 'bowler' },
};
export const professions = {
  teacher: { ko: '선생님', label: 'Учитель', slot: 'hand', asset: 'pointer' },
  student: { ko: '학생', label: 'Ученик / студент', slot: 'back', asset: 'backpack' },
  doctor: { ko: '의사', label: 'Врач', slot: 'body', asset: 'stethoscope' },
  office: { ko: '회사원', label: 'Офисный сотрудник', slot: 'hand', asset: 'briefcase' },
  singer: { ko: '가수', label: 'Певец', slot: 'hand', asset: 'microphone' },
  soldier: { ko: '군인', label: 'Солдат', slot: 'hat', asset: 'helmet' },
  chef: { ko: '요리사', label: 'Повар', slot: 'hat', asset: 'chef' },
  reporter: { ko: '기자', label: 'Репортёр', slot: 'hand', asset: 'notebook' },
};
export const catalogs = { gender: genders, country: countries, profession: professions };
export function appearance(profile) {
  const country = countries[profile.country], job = professions[profile.profession];
  return { hair: genders[profile.gender]?.hair || null, hat: job?.slot === 'hat' ? job.asset : country?.hat || null,
    flag: country?.flag || null, hand: job?.slot === 'hand' ? job.asset : null,
    back: job?.slot === 'back' ? job.asset : null, body: job?.slot === 'body' ? job.asset : null };
}
