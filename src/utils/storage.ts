export interface LevelRecord { best: number; stars: number; completed: boolean }
export interface Settings {
  master: number; music: number; sfx: number; muted: boolean;
  quality: 'high' | 'balanced' | 'performance';
  reducedMotion: boolean;
}
interface SaveData { unlocked: number; records: Record<number, LevelRecord>; settings: Settings; tutorialDone: boolean }

const KEY = 'luma-rift-save-v1';

const defaults = (): SaveData => ({
  unlocked: 1,
  records: {},
  settings: { master: 0.8, music: 0.55, sfx: 0.85, muted: false, quality: 'high', reducedMotion: false },
  tutorialDone: false,
});

/** LocalStorage wrapper. Every access is guarded so private mode / blocked storage never breaks the game. */
class StorageManager {
  data: SaveData;
  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData>;
        this.data = { ...defaults(), ...parsed, settings: { ...defaults().settings, ...(parsed.settings || {}) } };
      }
    } catch { /* storage unavailable */ }
    if (!('ontouchstart' in window) && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) {
      this.data.settings.quality = 'performance';
    }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
  get settings() { return this.data.settings; }
  record(level: number): LevelRecord { return this.data.records[level] || { best: 0, stars: 0, completed: false }; }
  completeLevel(level: number, score: number, stars: number) {
    const r = this.record(level);
    this.data.records[level] = { best: Math.max(r.best, score), stars: Math.max(r.stars, stars), completed: true };
    this.data.unlocked = Math.max(this.data.unlocked, Math.min(4, level + 1));
    this.save();
  }
}

export const storage = new StorageManager();
