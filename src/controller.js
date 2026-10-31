export class ActionController {
  constructor(world, renderer, { onChange = () => {}, onProgress = () => {} } = {}) {
    this.world = world; this.renderer = renderer; this.onChange = onChange; this.onProgress = onProgress;
    this.queue = []; this.epoch = 0; this.runningEpoch = null;
  }
  get pending() { return this.queue.length; }
  cancel() {
    this.epoch++; this.runningEpoch = null;
    for (const task of this.queue.splice(0)) task.resolve({ cancelled: true });
    this.world.busy = false; this.renderer.reset(this.world.profile); this.onChange();
  }
  reset() { this.world.reset(); this.cancel(); }
  run(command) {
    if (this.queue.length >= 6) return Promise.resolve({ type: 'queue', message: 'В очереди уже шесть фраз. Дай герою немного времени.' });
    return new Promise(resolve => { this.queue.push({ command, resolve }); this.drain(); this.onChange(); });
  }
  async drain() {
    if (this.runningEpoch === this.epoch) return;
    const epoch = this.epoch; this.runningEpoch = epoch;
    this.world.busy = true; this.onChange();
    while (this.queue.length && epoch === this.epoch) {
      const { command, resolve } = this.queue.shift();
      this.onProgress(command); this.onChange();
      try {
        if (!command.ok) {
          await this.renderer.confused();
          resolve(epoch === this.epoch ? { type: command.type, message: command.message } : { cancelled: true }); continue;
        }
        if (!this.world.profile.awake && !await this.renderer.wake()) { resolve({ cancelled: true }); continue; }
        if (epoch !== this.epoch) { resolve({ cancelled: true }); continue; }
        if (command.action === 'greet') {
          this.world.apply(command); this.renderer.setProfile(this.world.profile); this.onChange();
          resolve({ type: 'success', message: '안녕하세요! Герой проснулся. Расскажи, кем он будет.' }); continue;
        }
        if (this.world.profile[command.field] === command.value) { resolve({ type: 'success', message: 'Да, всё верно — эта характеристика уже у героя.' }); continue; }
        const next = { ...this.world.profile, [command.field]: command.value, awake: true };
        const completed = command.field === 'gender' ? await this.renderer.changeAppearance(next) : await this.renderer.equip(command, next);
        if (epoch !== this.epoch || !completed) { resolve({ cancelled: true }); continue; }
        this.world.apply(command); this.renderer.setProfile(this.world.profile); this.onChange();
        resolve({ type: 'success', message: command.usedAlternative ? `Применено: ${command.canonical}. Выбран подходящий вариант распознавания.` : `${command.canonical} — готово!` });
      } catch (error) {
        console.error(error);
        if (epoch === this.epoch) this.renderer.reset(this.world.profile);
        resolve({ type: 'error', message: 'Не удалось закончить движение. Попробуй ещё раз — характеристики сохранены.' });
      }
    }
    if (epoch === this.epoch) { this.runningEpoch = null; this.world.busy = false; this.onChange(); }
  }
}
