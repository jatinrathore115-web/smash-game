import { LEVELS } from '../levels/LevelData';
import { storage, type Settings } from '../utils/storage';
import { DESIGN_W, DESIGN_H, BALANCE } from '../utils/constants';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

const ICON = {
  energy: `<svg viewBox="0 0 32 32"><defs><radialGradient id="eg" cx="40%" cy="35%"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#c8fbff"/><stop offset="1" stop-color="#5fd6f5"/></radialGradient></defs><circle cx="16" cy="16" r="11" fill="url(#eg)"/><circle cx="16" cy="16" r="14" fill="none" stroke="#c8fbff" stroke-opacity="0.6" stroke-width="1.5"/></svg>`,
  pause: `<svg viewBox="0 0 32 32" fill="#fff"><rect x="8" y="6" width="5.5" height="20" rx="2"/><rect x="18.5" y="6" width="5.5" height="20" rx="2"/></svg>`,
  sound: `<svg viewBox="0 0 32 32" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12v8h5l7 6V6l-7 6z" fill="#fff"/><path d="M21 11.5a6 6 0 0 1 0 9"/><path d="M24.5 8a11 11 0 0 1 0 16"/></svg>`,
  mute: `<svg viewBox="0 0 32 32" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12v8h5l7 6V6l-7 6z" fill="#fff"/><path d="M22 12l7 8M29 12l-7 8"/></svg>`,
  burst: `<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16 2l2.6 9.2L28 8l-6.4 7.2L30 20l-9.4 0.6L22 30l-6-7.4L10 30l1.4-9.4L2 20l8.4-4.8L4 8l9.4 3.2z"/></svg>`,
};

export interface UIHandlers {
  play(level: number): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  /** Leave a sub-screen (levels/settings) for the main menu. */
  back(): void;
  next(): void;
  burst(): void;
  pause(): void;
  toggleSound(): void;
  settingsChanged(s: Settings): void;
  click(): void;
}

export interface ResultData { level: number; score: number; accuracy: number; destroyed: number; stars: number; integrityLost: boolean; best: number }

/** DOM interface rendered on a 1920x1080 layer that is uniformly scaled into the 16:9 stage. */
export class UI {
  root: HTMLElement;
  scale = 1;
  private el: Record<string, HTMLElement> = {};
  private hintTimer = 0;
  private shownScore = 0;
  private targetScore = 0;
  private screens: Record<string, HTMLElement> = {};
  private current = '';
  private chargeCircle!: SVGCircleElement;

  constructor(root: HTMLElement, private h: UIHandlers) {
    this.root = root;
    this.build();
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string, scope: ParentNode = this.root) { return scope.querySelector(sel) as T; }

  private build() {
    this.root.innerHTML = `
      <div class="hud">
        <div class="panel hud-left">
          <div class="stat-row">${ICON.energy}<div class="energy-num">32</div><div class="bar energy-bar"><i style="width:35%"></i></div></div>
          <div class="integrity"><span class="lbl">Integrity</span><div class="pip"></div><div class="pip"></div><div class="pip"></div></div>
        </div>
        <div class="panel hud-center">
          <div class="lvl-name"><b>1</b><span>Peach Horizon</span></div>
          <div class="progress"><i style="width:0%"></i><em style="left:0%"></em></div>
        </div>
        <div class="panel hud-right">
          <div class="score-wrap"><div class="score-lbl">Score</div><div class="score">0</div><div class="combo">x1</div></div>
          <button class="icon-btn snd-btn" aria-label="Toggle sound">${ICON.sound}</button>
          <button class="icon-btn pause-btn" aria-label="Pause">${ICON.pause}</button>
        </div>
        <div class="panel pulse-panel">
          <span class="pulse-lbl">Pulse</span>
          <div class="pulse-bar"><i style="width:0%"></i></div>
          <button class="burst-btn" aria-label="Resonance Burst">${ICON.burst}<span>BURST</span><span class="key">E</span></button>
        </div>
        <div class="popups"></div>
        <div class="combo-pop"></div>
        <div class="reticle"><svg class="charge" viewBox="0 0 90 90"><circle cx="45" cy="45" r="40" stroke-dasharray="251.3" stroke-dashoffset="251.3"/></svg><div class="ring"></div><div class="dot"></div></div>
        <div class="hint"></div>
      </div>
      <div class="vignette"></div>

      <div class="screen menu" data-s="menu">
        <div class="stagger" style="display:flex;flex-direction:column;align-items:center">
          <div class="title-wrap"><h1 class="title">LUMA RIFT</h1><div class="title-sub">Shatter the glass · Restore the light</div></div>
          <div class="btns">
            <button class="btn primary big" data-a="play">Play</button>
            <button class="btn" data-a="levels">Level Select</button>
            <button class="btn" data-a="settings">Sound &amp; Settings</button>
          </div>
        </div>
        <div class="menu-hint"><span>🖱 Click / tap to launch orbs</span><span>Hold &amp; release to charge</span><span><b class="key">E</b> Resonance Burst</span><span><b class="key">Esc</b> Pause</span></div>
        <div class="version">v1.0</div>
      </div>

      <div class="screen dim" data-s="levels">
        <div class="card" style="padding:44px 50px">
          <h2>Choose a Pathway</h2>
          <div class="sub">Four sealed worlds. Each restored path unlocks the next.</div>
          <div class="levels"></div>
          <div class="btns"><button class="btn" data-a="back">Back</button></div>
        </div>
      </div>

      <div class="screen dim" data-s="settings">
        <div class="card">
          <h2>Settings</h2>
          <div class="settings">
            <label>Master volume</label><input type="range" min="0" max="100" data-k="master"><span class="val"></span>
            <label>Music</label><input type="range" min="0" max="100" data-k="music"><span class="val"></span>
            <label>Effects</label><input type="range" min="0" max="100" data-k="sfx"><span class="val"></span>
            <label>Sound</label><div class="seg" data-k="muted"><button data-v="false">On</button><button data-v="true">Muted</button></div>
            <label>Quality</label><div class="seg" data-k="quality"><button data-v="high">High</button><button data-v="balanced">Balanced</button><button data-v="performance">Performance</button></div>
            <label>Reduced motion</label><div class="seg" data-k="reducedMotion"><button data-v="false">Off</button><button data-v="true">On</button></div>
          </div>
          <div class="btns"><button class="btn primary" data-a="back">Done</button></div>
        </div>
      </div>

      <div class="screen dim" data-s="pause">
        <div class="card">
          <h2>Paused</h2>
          <div class="sub">Take a breath — the rift will wait.</div>
          <div class="btns" style="flex-direction:column;align-items:center">
            <button class="btn primary" data-a="resume" style="min-width:380px">Resume</button>
            <button class="btn" data-a="restart" style="min-width:380px">Restart Level</button>
            <button class="btn pause-sound" data-a="sound" style="min-width:380px">Sound: On</button>
            <button class="btn" data-a="settings" style="min-width:380px">Settings</button>
            <button class="btn" data-a="menu" style="min-width:380px">Main Menu</button>
          </div>
        </div>
      </div>

      <div class="screen dim" data-s="complete">
        <div class="card">
          <div class="sub" style="margin:0;letter-spacing:6px;text-transform:uppercase">Pathway restored</div>
          <h2 class="c-name">Peach Horizon</h2>
          <div class="big-stars"></div>
          <div class="star-key">★ Clear the level &nbsp;·&nbsp; ★ Accuracy 55%+ &nbsp;·&nbsp; ★ No integrity lost</div>
          <div class="result-stats">
            <div><b class="c-score">0</b><span>Score</span></div>
            <div><b class="c-acc">0%</b><span>Accuracy</span></div>
            <div><b class="c-dest">0</b><span>Shattered</span></div>
          </div>
          <div class="sub c-best" style="margin:6px 0 0;font-size:18px"></div>
          <div class="btns">
            <button class="btn" data-a="levels">Levels</button>
            <button class="btn" data-a="restart">Retry</button>
            <button class="btn primary" data-a="next">Next Level</button>
          </div>
        </div>
      </div>

      <div class="screen dim" data-s="gameover">
        <div class="card">
          <h2>Game Over</h2>
          <div class="sub go-reason">Your integrity was depleted.</div>
          <div class="score-total go-score">0</div>
          <div class="sub" style="font-size:16px;letter-spacing:3px;text-transform:uppercase">Score</div>
          <div class="btns">
            <button class="btn" data-a="levels">Level Select</button>
            <button class="btn primary" data-a="restart">Restart Level</button>
          </div>
        </div>
      </div>

      <div class="screen dim" data-s="victory">
        <div class="card" style="min-width:820px">
          <div class="sub" style="margin:0;letter-spacing:8px;text-transform:uppercase">All four pathways restored</div>
          <h2 style="font-size:84px">The Rift Shines Again</h2>
          <div class="sub">The Prism Core is whole. Light flows through every world.</div>
          <div class="score-total v-score">0</div>
          <div class="sub" style="font-size:16px;letter-spacing:3px;text-transform:uppercase">Final Score · Amethyst Nova</div>
          <div class="sub v-total" style="font-size:20px"></div>
          <div class="btns">
            <button class="btn" data-a="levels">Level Select</button>
            <button class="btn primary" data-a="replay">Replay Finale</button>
          </div>
        </div>
      </div>
      <div class="fader"></div>
    `;
    this.root.querySelectorAll<HTMLElement>('.screen').forEach((s) => { this.screens[s.dataset.s!] = s; });
    const names = ['hud', 'energy-num', 'energy-bar', 'lvl-name', 'progress', 'score', 'combo', 'pulse-panel', 'pulse-bar', 'burst-btn', 'popups', 'combo-pop', 'reticle', 'hint', 'vignette', 'fader', 'snd-btn', 'pause-btn', 'levels'];
    for (const n of names) this.el[n] = this.q('.' + n);
    this.chargeCircle = this.q<HTMLElement>('.reticle circle') as unknown as SVGCircleElement;

    // Event wiring. pointerdown on buttons must not reach the game input.
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, .interactive')) e.stopPropagation();
    });
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      this.h.click();
      const a = b.dataset.a;
      switch (a) {
        case 'play': this.h.play(Math.min(storage.data.unlocked, 4)); break;
        case 'levels': this.showLevels(); break;
        case 'settings': this.prevScreen = this.current; this.showSettings(); break;
        case 'back': if (this.prevScreen === 'pause') this.show('pause'); else this.h.back(); this.prevScreen = ''; break;
        case 'resume': this.h.resume(); break;
        case 'restart': this.h.restart(); break;
        case 'menu': this.h.toMenu(); break;
        case 'next': this.h.next(); break;
        case 'sound': this.h.toggleSound(); break;
        case 'replay': this.h.play(4); break;
      }
    });
    // HUD buttons drop focus straight away so Enter/Space keep firing orbs.
    this.el['snd-btn'].addEventListener('click', (e) => { this.h.toggleSound(); (e.currentTarget as HTMLElement).blur(); });
    this.el['pause-btn'].addEventListener('click', (e) => { this.h.pause(); (e.currentTarget as HTMLElement).blur(); });
    this.el['burst-btn'].addEventListener('click', (e) => { this.h.burst(); (e.currentTarget as HTMLElement).blur(); });
    this.bindSettings();
  }

  private prevScreen = '';

  // ------------------------------------------------------------- layout
  /** Letterbox the stage to 16:9 and scale the UI layer to match. */
  layout(stage: HTMLElement) {
    const W = window.innerWidth, H = window.innerHeight;
    let w = W, h = (W * DESIGN_H) / DESIGN_W;
    if (h > H) { h = H; w = (H * DESIGN_W) / DESIGN_H; }
    w = Math.floor(w); h = Math.floor(h);
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    this.scale = w / DESIGN_W;
    this.root.style.transform = `scale(${this.scale})`;
    return { w, h };
  }

  // ------------------------------------------------------------- screens
  show(name: string) {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('show', k === name);
    this.current = name;
    const scr = this.screens[name];
    const first = scr?.querySelector<HTMLButtonElement>('.btn.primary') ?? scr?.querySelector<HTMLButtonElement>('.btn');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  }
  hideScreens() {
    this.show('');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
  get screen() { return this.current; }

  showMenu(unlocked: number) {
    const play = this.q<HTMLButtonElement>('[data-a=play]');
    play.textContent = unlocked > 1 ? `Continue · Level ${Math.min(unlocked, 4)}` : 'Play';
    this.show('menu');
  }

  showLevels() {
    const wrap = this.el['levels'];
    wrap.innerHTML = '';
    for (const L of LEVELS) {
      const rec = storage.record(L.id);
      const locked = L.id > storage.data.unlocked;
      const [top, mid, bot] = L.palette.sky;
      const card = document.createElement('button');
      card.className = 'lvl-card' + (locked ? ' locked' : '');
      card.innerHTML = `
        <div class="art" style="background:
          radial-gradient(circle at 50% 42%, ${hex(L.palette.sun)}cc 0%, transparent 38%),
          repeating-linear-gradient(90deg, transparent 0 46px, ${hex(L.palette.swatch[1])}55 46px 52px),
          linear-gradient(180deg, ${hex(top)} 0%, ${hex(mid)} 55%, ${hex(bot)} 100%)"></div>
        ${locked ? '<div class="lock">LOCKED</div>' : ''}
        <div class="info">
          <div class="num">LEVEL ${L.id}</div>
          <div class="nm">${L.name}</div>
          <div class="tg">${L.tagline}</div>
          <div class="swatches">${L.palette.swatch.map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</div>
          <div class="meta"><span class="stars">${this.stars(rec.stars)}</span><span>${rec.best ? 'Best ' + rec.best.toLocaleString() : locked ? 'Restore level ' + (L.id - 1) : 'Not yet played'}</span></div>
        </div>`;
      card.addEventListener('click', (e) => { e.stopPropagation(); if (locked) { this.h.click(); return; } this.h.click(); this.h.play(L.id); });
      wrap.appendChild(card);
    }
    this.show('levels');
  }

  private stars(n: number) {
    return [0, 1, 2].map((i) => (i < n ? '★' : '<span class="off">★</span>')).join('');
  }

  // ------------------------------------------------------------- settings
  private bindSettings() {
    const s = this.screens['settings'];
    s.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as 'master' | 'music' | 'sfx';
        storage.settings[k] = Number(inp.value) / 100;
        (inp.nextElementSibling as HTMLElement).textContent = inp.value;
        this.h.settingsChanged(storage.settings);
      });
    });
    s.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.click();
        const k = seg.dataset.k as keyof Settings;
        const v = b.dataset.v!;
        (storage.settings as unknown as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : v;
        this.syncSettings();
        this.h.settingsChanged(storage.settings);
      }));
    });
  }

  syncSettings() {
    const st = storage.settings;
    const s = this.screens['settings'];
    s.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      const k = inp.dataset.k as 'master' | 'music' | 'sfx';
      inp.value = String(Math.round(st[k] * 100));
      (inp.nextElementSibling as HTMLElement).textContent = inp.value;
    });
    s.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const val = String((st as unknown as Record<string, unknown>)[seg.dataset.k!]);
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === val));
    });
    this.el['snd-btn'].innerHTML = st.muted ? ICON.mute : ICON.sound;
    this.q('.pause-sound').textContent = st.muted ? 'Sound: Off' : 'Sound: On';
    document.documentElement.classList.toggle('reduced-motion', st.reducedMotion);
  }

  showSettings() { this.syncSettings(); this.show('settings'); }

  // ------------------------------------------------------------- HUD
  showHud(on: boolean) { this.el['hud'].classList.toggle('show', on); }

  setLevel(id: number, name: string, burst: boolean) {
    this.el['lvl-name'].innerHTML = `<b>${id}</b><span>${name}</span>`;
    this.el['pulse-panel'].classList.toggle('hidden', !burst);
    this.shownScore = this.targetScore = 0;
    this.el['score'].textContent = '0';
  }

  setEnergy(e: number, bump = false) {
    const n = this.el['energy-num'];
    n.textContent = String(e);
    n.classList.toggle('low', e <= 5);
    if (bump) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); setTimeout(() => n.classList.remove('bump'), 160); }
    (this.el['energy-bar'].firstElementChild as HTMLElement).style.width = `${Math.min(100, (e / BALANCE.maxEnergy) * 100)}%`;
  }

  setIntegrity(n: number, hit = false) {
    this.root.querySelectorAll<HTMLElement>('.pip').forEach((p, i) => {
      const lost = i >= n;
      if (hit && lost && !p.classList.contains('lost')) { p.classList.add('hit'); setTimeout(() => p.classList.remove('hit'), 600); }
      p.classList.toggle('lost', lost);
    });
  }

  setScore(s: number) { this.targetScore = s; }
  setCombo(mult: number) {
    const c = this.el['combo'];
    c.textContent = `Combo ×${mult}`;
    c.classList.toggle('on', mult > 1);
  }
  comboPop(text: string) {
    const c = this.el['combo-pop'];
    c.textContent = text;
    c.classList.remove('go'); void c.offsetWidth; c.classList.add('go');
  }

  setProgress(p: number) {
    const pr = this.el['progress'];
    (pr.children[0] as HTMLElement).style.width = `${p * 100}%`;
    (pr.children[1] as HTMLElement).style.left = `${p * 100}%`;
  }

  setPulse(frac: number, ready: boolean) {
    (this.el['pulse-bar'].firstElementChild as HTMLElement).style.width = `${frac * 100}%`;
    this.el['burst-btn'].classList.toggle('ready', ready);
  }

  /** Reticle in design pixels. charge: -1 hidden, 0..1 fill. */
  setReticle(x: number, y: number, visible: boolean, charge: number) {
    const r = this.el['reticle'];
    r.style.transform = `translate(${x}px, ${y}px)`;
    r.style.opacity = visible ? '1' : '0';
    const c = Math.max(0, charge);
    this.chargeCircle.setAttribute('stroke-dashoffset', String(251.3 * (1 - c)));
    (this.chargeCircle.parentNode as SVGElement).style.opacity = charge > 0.05 ? '1' : '0';
    r.classList.toggle('charged', charge >= 1);
  }
  fireReticle() {
    const r = this.el['reticle'];
    r.classList.add('fire');
    setTimeout(() => r.classList.remove('fire'), 90);
  }

  /** seconds = 0 sets a persistent instruction; timed hints show briefly, then fall back to it. Empty text with 0 clears everything. */
  hint(text: string, seconds = 3) {
    const h = this.el['hint'];
    clearTimeout(this.hintTimer);
    if (seconds <= 0) this.baseHint = text;
    if (!text) { h.classList.remove('show'); return; }
    h.textContent = text;
    h.classList.add('show');
    if (seconds > 0) this.hintTimer = window.setTimeout(() => {
      if (this.baseHint) h.textContent = this.baseHint;
      else h.classList.remove('show');
    }, seconds * 1000);
  }
  private baseHint = '';

  popup(x: number, y: number, text: string, cls = '') {
    const p = document.createElement('div');
    p.className = 'popup ' + cls;
    p.textContent = text;
    p.style.left = x + 'px'; p.style.top = y + 'px';
    this.el['popups'].appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }

  /** Light motes flying from a hit point into the energy counter. */
  energyMotes(x: number, y: number, n: number) {
    const target = { x: 140, y: 80 };
    for (let i = 0; i < Math.min(n, 7); i++) {
      const m = document.createElement('div');
      m.className = 'mote';
      m.style.left = x + (Math.random() - 0.5) * 60 + 'px';
      m.style.top = y + (Math.random() - 0.5) * 60 + 'px';
      this.el['popups'].appendChild(m);
      setTimeout(() => { m.style.left = target.x + 'px'; m.style.top = target.y + 'px'; m.style.opacity = '0.2'; m.style.transform = 'scale(0.5)'; }, 30 + i * 45);
      setTimeout(() => m.remove(), 800 + i * 45);
    }
  }

  damage() {
    const v = this.el['vignette'];
    v.classList.add('on');
    setTimeout(() => v.classList.remove('on'), 160);
  }

  fade(on: boolean, color = '#ffffff', ms = 800) {
    const f = this.el['fader'];
    f.style.background = color;
    f.style.transitionDuration = ms + 'ms';
    f.classList.toggle('on', on);
  }

  tick(dt: number) {
    if (this.shownScore !== this.targetScore) {
      const d = this.targetScore - this.shownScore;
      this.shownScore += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * Math.min(1, dt * 10)));
      if (Math.abs(this.targetScore - this.shownScore) < 1) this.shownScore = this.targetScore;
      this.el['score'].textContent = this.shownScore.toLocaleString();
    }
  }

  // ------------------------------------------------------------- results
  showComplete(r: ResultData) {
    const L = LEVELS[r.level - 1];
    const s = this.screens['complete'];
    this.q('.c-name', s).textContent = L.name;
    this.q('.big-stars', s).innerHTML = [0, 1, 2].map((i) => `<span class="${i < r.stars ? '' : 'off'}">★</span>`).join('');
    this.q('.c-score', s).textContent = r.score.toLocaleString();
    this.q('.c-acc', s).textContent = Math.round(r.accuracy * 100) + '%';
    this.q('.c-dest', s).textContent = String(r.destroyed);
    this.q('.c-best', s).textContent = r.score >= r.best ? 'New personal best!' : `Personal best ${r.best.toLocaleString()}`;
    (this.q('[data-a=next]', s) as HTMLElement).style.display = r.level >= 4 ? 'none' : '';
    this.show('complete');
  }

  showGameOver(score: number, reason: string) {
    const s = this.screens['gameover'];
    this.q('.go-score', s).textContent = score.toLocaleString();
    this.q('.go-reason', s).textContent = reason;
    this.show('gameover');
  }

  showVictory(score: number) {
    const s = this.screens['victory'];
    this.q('.v-score', s).textContent = score.toLocaleString();
    const total = [1, 2, 3, 4].reduce((a, i) => a + storage.record(i).best, 0);
    const stars = [1, 2, 3, 4].reduce((a, i) => a + storage.record(i).stars, 0);
    this.q('.v-total', s).textContent = `Journey total ${total.toLocaleString()} · ${stars} / 12 stars`;
    this.show('victory');
  }

  setMenuMode(on: boolean) { this.root.parentElement?.classList.toggle('menu-mode', on); }
}
