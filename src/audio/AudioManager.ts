import { MusicPlayer, type SongId } from './Music';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Procedural sound design. Every sound is synthesised with Web Audio at runtime,
 * so the game ships no third-party recordings. The context is created on the
 * first user gesture to satisfy autoplay policies.
 */
export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private music: MusicPlayer | null = null;
  private chargeNodes: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  private vol = { master: 0.8, music: 0.55, sfx: 0.85, muted: false };
  private duck = 1;
  private lastShatter = 0;
  private pendingSong: SongId | null = null;

  /** Must be called from a user gesture handler. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.connect(comp);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.4);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.music = new MusicPlayer(ctx, this.musicBus, this.reverbSend);
    this.applyVolumes();
    if (this.pendingSong) { this.music.play(this.pendingSong); this.pendingSong = null; }
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setVolumes(v: { master: number; music: number; sfx: number; muted: boolean }) {
    this.vol = { ...v };
    this.applyVolumes();
  }
  setDuck(d: number) { this.duck = d; this.applyVolumes(); }
  get muted() { return this.vol.muted; }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5 * this.duck, t, 0.3);
  }

  playSong(id: SongId) {
    if (!this.music) { this.pendingSong = id; return; }
    this.music.play(id);
  }
  stopSong() { this.music?.stop(); this.pendingSong = null; }
  /** Number of musical beats elapsed since the last call (drives environment pulses). */
  consumeBeats() { return this.music ? this.music.consumeBeats() : 0; }

  // ------------------------------------------------------------ primitives
  private out(pan = 0, reverb = 0.0) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(this.sfx);
    if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; p.connect(s); s.connect(this.reverbSend); }
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, gain: number, dest: AudioNode, attack = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(t0: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, q: number, dest: AudioNode, f1?: number, attack = 0.002) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  }

  private get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  // ------------------------------------------------------------ game sounds
  launch(pan = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(pan * 0.5, 0.08);
    this.tone('sine', 1100, 380, t, 0.14, 0.22, o);
    this.tone('triangle', 2200, 900, t, 0.06, 0.05, o);
    this.noiseBurst(t, 0.16, 0.12, 'bandpass', 3000, 0.8, o, 900);
  }

  chargedLaunch(pan = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(pan * 0.5, 0.2);
    this.tone('sine', 520, 90, t, 0.45, 0.35, o);
    this.tone('sawtooth', 220, 55, t, 0.3, 0.06, o);
    this.tone('sine', 1760, 880, t, 0.25, 0.08, o);
    this.noiseBurst(t, 0.4, 0.18, 'bandpass', 1800, 0.7, o, 300);
  }

  chargeStart() {
    if (!this.ok || this.chargeNodes) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.07, t + 0.25);
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(330, t); osc.frequency.exponentialRampToValueAtTime(880, t + 0.6);
    const osc2 = ctx.createOscillator(); osc2.type = 'triangle'; osc2.frequency.setValueAtTime(663, t); osc2.frequency.exponentialRampToValueAtTime(1766, t + 0.6);
    osc.connect(gain); osc2.connect(gain); gain.connect(this.out(0, 0.15));
    osc.start(t); osc2.start(t);
    this.chargeNodes = { osc, osc2, gain };
  }
  chargeEnd() {
    if (!this.chargeNodes || !this.ctx) return;
    const t = this.ctx.currentTime, n = this.chargeNodes;
    n.gain.gain.cancelScheduledValues(t);
    n.gain.gain.setTargetAtTime(0.0001, t, 0.03);
    n.osc.stop(t + 0.2); n.osc2.stop(t + 0.2);
    this.chargeNodes = null;
  }
  chargeReady() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.2);
    this.tone('sine', mtof(93), mtof(93), t, 0.18, 0.08, o);
  }

  /** Layered glass break: transient, bright noise, crystalline partials and a body thump. */
  shatter(size = 1, pan = 0, reinforced = false) {
    if (!this.ok) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    // Rate-limit stacking so simultaneous breaks don't clip.
    const stack = t - this.lastShatter < 0.05 ? 0.55 : 1;
    this.lastShatter = t;
    const o = this.out(pan * 0.7, 0.35);
    const g = 0.5 * stack;
    this.noiseBurst(t, 0.05, g * 0.9, 'highpass', 1800, 0.5, o);
    this.noiseBurst(t, 0.35 + size * 0.15, g * 0.55, 'highpass', 4200, 0.6, o, 7000);
    this.noiseBurst(t, 0.18, g * 0.4, 'bandpass', reinforced ? 1300 : 2400, 1.2, o);
    this.tone('triangle', reinforced ? 160 : 230, reinforced ? 70 : 110, t, 0.18, g * 0.45, o);
    const n = 8 + Math.round(size * 6);
    for (let i = 0; i < n; i++) {
      const dt = Math.pow(Math.random(), 1.6) * (0.45 + size * 0.2);
      const f = 2400 + Math.random() * 5200;
      this.tone('sine', f, f * (0.98 + Math.random() * 0.03), t + dt, 0.04 + Math.random() * 0.22, g * (0.05 + Math.random() * 0.09) * (1 - dt), o, 0.001);
    }
  }

  crack(pan = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(pan * 0.7, 0.2);
    this.noiseBurst(t, 0.06, 0.4, 'bandpass', 3200, 1.6, o);
    this.noiseBurst(t + 0.015, 0.12, 0.2, 'highpass', 5000, 0.7, o);
    this.tone('triangle', 420, 180, t, 0.09, 0.2, o);
    this.tone('sine', 3800, 3700, t + 0.01, 0.2, 0.05, o, 0.001);
  }

  energy(rare = false, pan = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(pan * 0.6, 0.45);
    const notes = rare ? [76, 80, 83, 88] : [76, 80, 83];
    notes.forEach((m, i) => {
      this.tone('sine', mtof(m), mtof(m), t + i * 0.055, 0.5, 0.13, o);
      this.tone('triangle', mtof(m + 12), mtof(m + 12), t + i * 0.055, 0.2, 0.03, o);
    });
  }

  switchOn(step = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.5);
    const m = 72 + [0, 4, 7, 12][step % 4];
    this.tone('sine', mtof(m), mtof(m), t, 0.9, 0.16, o);
    this.tone('sine', mtof(m + 19), mtof(m + 19), t, 0.5, 0.04, o);
  }

  resonance(pan = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(pan * 0.5, 0.6);
    this.tone('sine', 180, 60, t, 0.7, 0.4, o);
    [64, 71, 76, 83].forEach((m, i) => this.tone('sine', mtof(m), mtof(m), t + i * 0.03, 1.1, 0.07, o));
    this.noiseBurst(t, 0.6, 0.15, 'bandpass', 600, 0.6, o, 4000, 0.15);
  }

  burst() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.7);
    this.tone('sine', 120, 38, t, 1.0, 0.55, o, 0.01);
    this.noiseBurst(t, 0.9, 0.3, 'bandpass', 300, 0.5, o, 6000, 0.25);
    [62, 69, 74, 78, 81].forEach((m, i) => this.tone('triangle', mtof(m), mtof(m), t + 0.05 + i * 0.04, 1.4, 0.05, o, 0.02));
  }

  collision() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.15);
    this.tone('sine', 110, 40, t, 0.4, 0.6, o);
    this.noiseBurst(t, 0.3, 0.45, 'lowpass', 900, 0.7, o, 200);
    this.shatter(0.6, 0);
  }

  portal() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.8);
    [62, 66, 69, 73, 78].forEach((m, i) => {
      this.tone('sine', mtof(m), mtof(m), t + i * 0.09, 2.2, 0.09, o, 0.3);
      this.tone('triangle', mtof(m + 12), mtof(m + 12), t + i * 0.09, 1.2, 0.025, o, 0.2);
    });
    this.noiseBurst(t, 1.6, 0.1, 'bandpass', 500, 0.4, o, 8000, 0.8);
  }

  levelComplete() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.6);
    [67, 71, 74, 79, 83, 86].forEach((m, i) => this.tone('sine', mtof(m), mtof(m), t + i * 0.11, 1.4, 0.13, o));
    [55, 62].forEach((m) => this.tone('triangle', mtof(m), mtof(m), t + 0.55, 2.2, 0.08, o, 0.2));
  }

  victory() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.8);
    const chord = [60, 64, 67, 71, 74, 79, 83];
    chord.forEach((m, i) => this.tone('sine', mtof(m), mtof(m), t + i * 0.14, 3, 0.1, o, 0.05));
    [48, 55].forEach((m) => this.tone('triangle', mtof(m), mtof(m), t + 0.9, 3.5, 0.1, o, 0.4));
  }

  gameOver() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.6);
    [69, 65, 62, 57].forEach((m, i) => this.tone('sine', mtof(m), mtof(m), t + i * 0.22, 1.1, 0.11, o));
  }

  damageWarn() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.1);
    this.tone('square', 220, 220, t, 0.08, 0.03, o);
  }

  ui(kind: 'click' | 'hover' | 'back' = 'click') {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(0, 0.1);
    if (kind === 'hover') this.tone('sine', 1800, 1800, t, 0.04, 0.025, o);
    else if (kind === 'back') this.tone('sine', 900, 600, t, 0.08, 0.08, o);
    else { this.tone('sine', 1250, 1500, t, 0.07, 0.1, o); this.tone('triangle', 2500, 2500, t, 0.03, 0.03, o); }
  }

  thud(pan = 0) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime, o = this.out(pan, 0.1);
    this.tone('sine', 300, 140, t, 0.08, 0.12, o);
    this.noiseBurst(t, 0.05, 0.08, 'bandpass', 1500, 1, o);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}
