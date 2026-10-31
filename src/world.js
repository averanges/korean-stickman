import { catalogs, appearance } from './catalog.js';
export const STORAGE_KEY = 'korean-stickman.hero.v2';
export function emptyProfile() { return { version: 2, name: '', gender: null, country: null, profession: null, awake: false, visual: appearance({}) }; }
export function sanitizeProfile(input) {
  const result = emptyProfile();
  if (!input || input.version !== 2) return result;
  result.name = typeof input.name === 'string' ? input.name.trim().slice(0, 32) : '';
  for (const [field, catalog] of Object.entries(catalogs)) if (Object.hasOwn(catalog, input[field])) result[field] = input[field];
  result.awake = input.awake === true || Boolean(result.gender || result.country || result.profession);
  result.visual = appearance(result);
  return result;
}
export class WorldState {
  constructor(storage) {
    if(arguments.length===0){try{storage=globalThis.localStorage;}catch{storage=undefined;}}
    this.storage = storage; this.busy = false; this.storageAvailable = Boolean(storage);
    try { this.profile = sanitizeProfile(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null')); }
    catch { this.profile = emptyProfile(); this.storageAvailable = false; }
  }
  save() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.profile)); return this.storageAvailable = Boolean(this.storage); }
    catch { return this.storageAvailable = false; }
  }
  apply(command) {
    if (command.action === 'set' && Object.hasOwn(catalogs[command.field] || {}, command.value)) this.profile[command.field] = command.value;
    this.profile.awake = true; this.profile.visual = appearance(this.profile); this.save();
  }
  setName(name) { this.profile.name = name.trim().slice(0, 32); this.save(); }
  reset() { this.profile = emptyProfile(); this.busy = false; this.save(); }
}
