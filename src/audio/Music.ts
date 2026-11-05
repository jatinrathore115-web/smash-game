export type SongId = 'menu' | 'peach' | 'aqua' | 'jade' | 'amethyst' | 'victory';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Song {
  bpm: number;
  /** chords as MIDI note lists; each chord lasts `barsPerChord` bars of 4 beats */
  chords: number[][];
  barsPerChord: number;
  bass: boolean;
  /** arpeggio steps per beat (0 = none) */
  arpRate: 0 | 1 | 2 | 4;
  arpWave: OscillatorType;
  arpOctave: number;
  arpGain: number;
  kick: 0 | 1 | 2;   // 0 none, 1 on beats 1&3, 2 every beat
  hat: boolean;
  padCutoff: number;
  padGain: number;
  bell?: boolean;
}

// Original progressions written for this game.
const SONGS: Record<SongId, Song> = {
  menu: { bpm: 64, chords: [[50, 57, 61, 66], [47, 54, 57, 62], [43, 50, 57, 59], [45, 52, 57, 61]], barsPerChord: 2, bass: false, arpRate: 0, arpWave: 'sine', arpOctave: 24, arpGain: 0.03, kick: 0, hat: false, padCutoff: 900, padGain: 0.06, bell: true },
  peach: { bpm: 74, chords: [[50, 57, 61, 66], [47, 54, 57, 62], [43, 50, 54, 59], [45, 52, 57, 61]], barsPerChord: 1, bass: true, arpRate: 1, arpWave: 'sine', arpOctave: 24, arpGain: 0.045, kick: 0, hat: false, padCutoff: 1100, padGain: 0.055, bell: true },
  aqua: { bpm: 84, chords: [[52, 59, 63, 68], [49, 56, 59, 64], [45, 52, 56, 61], [47, 54, 56, 61]], barsPerChord: 1, bass: true, arpRate: 2, arpWave: 'triangle', arpOctave: 24, arpGain: 0.035, kick: 0, hat: true, padCutoff: 1500, padGain: 0.05 },
  jade: { bpm: 100, chords: [[45, 52, 55, 59, 62], [50, 54, 57, 60, 64], [41, 48, 52, 57, 60], [43, 50, 55, 57, 62]], barsPerChord: 1, bass: true, arpRate: 4, arpWave: 'triangle', arpOctave: 12, arpGain: 0.03, kick: 1, hat: true, padCutoff: 1300, padGain: 0.045 },
  amethyst: { bpm: 92, chords: [[42, 49, 52, 57, 61], [38, 45, 50, 54, 57], [45, 52, 57, 61, 64], [44, 52, 56, 59, 64]], barsPerChord: 1, bass: true, arpRate: 2, arpWave: 'sawtooth', arpOctave: 24, arpGain: 0.02, kick: 2, hat: true, padCutoff: 1800, padGain: 0.055, bell: true },
  victory: { bpm: 80, chords: [[48, 55, 59, 64, 67], [45, 52, 55, 60, 64], [41, 48, 53, 57, 60], [43, 50, 55, 59, 62]], barsPerChord: 1, bass: true, arpRate: 2, arpWave: 'sine', arpOctave: 24, arpGain: 0.04, kick: 0, hat: false, padCutoff: 1600, padGain: 0.06, bell: true },
};

/** Lookahead step sequencer producing ambient electronic music per level. */
export class MusicPlayer {
  private song: Song | null = null;
  private id: SongId | null = null;
  private bus: GainNode | null = null;
  private timer: number | null = null;
  private nextStep = 0;
  private step = 0;
  private beatTimes: number[] = [];
  private noise: AudioBuffer;
  private delay: DelayNode;
  private delayFb: GainNode;

  constructor(private ctx: AudioContext, private out: AudioNode, private reverb: AudioNode) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Shared tempo-free echo for plucks (watery, spacious).
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.36;
    this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 3200;
    this.delay.connect(dl); dl.connect(this.delayFb); this.delayFb.connect(this.delay);
    dl.connect(out);
  }

  play(id: SongId) {
    if (this.id === id) return;
    this.fadeOut();
    this.id = id;
    this.song = SONGS[id];
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(1, this.ctx.currentTime + 2.5);
    bus.connect(this.out);
    const send = this.ctx.createGain(); send.gain.value = 0.6; bus.connect(send); send.connect(this.reverb);
    this.bus = bus;
    this.delay.delayTime.setValueAtTime(60 / this.song.bpm * 0.75, this.ctx.currentTime);
    this.step = 0;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.beatTimes.length = 0;
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 30);
  }

  stop() {
    this.fadeOut();
    this.id = null; this.song = null;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  private fadeOut() {
    if (!this.bus) return;
    const b = this.bus, t = this.ctx.currentTime;
    b.gain.cancelScheduledValues(t);
    b.gain.setValueAtTime(Math.max(b.gain.value, 0.0001), t);
    b.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    setTimeout(() => b.disconnect(), 2000);
    this.bus = null;
  }

  consumeBeats() {
    const now = this.ctx.currentTime;
    let n = 0;
    while (this.beatTimes.length && this.beatTimes[0] <= now) { this.beatTimes.shift(); n++; }
    return n;
  }

  private schedule() {
    const s = this.song;
    if (!s || !this.bus) return;
    const spb = 60 / s.bpm;
    const stepDur = spb / 4; // 16th notes
    while (this.nextStep < this.ctx.currentTime + 0.15) {
      this.playStep(s, this.step, this.nextStep, spb);
      this.nextStep += stepDur;
      this.step++;
    }
  }

  private playStep(s: Song, step: number, t: number, spb: number) {
    const bus = this.bus!;
    const stepsPerChord = 16 * s.barsPerChord;
    const chordIdx = Math.floor(step / stepsPerChord) % s.chords.length;
    const chord = s.chords[chordIdx];
    const inChord = step % stepsPerChord;
    const beat = step % 4 === 0;
    if (beat) this.beatTimes.push(t);

    if (inChord === 0) {
      this.pad(chord, t, spb * 4 * s.barsPerChord, s, bus);
      if (s.bass) this.bassNote(chord[0] - 12, t, spb * 3.5, bus);
    }
    if (s.bass && s.kick === 2 && inChord === 8) this.bassNote(chord[0] - 12, t, spb * 1.5, bus);

    if (s.arpRate > 0) {
      const every = 4 / s.arpRate;
      if (step % every === 0) {
        const i = Math.floor(step / every);
        const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
        const note = chord[pattern[i % pattern.length] % chord.length] + s.arpOctave;
        const accent = (i % 4 === 0) ? 1.25 : 0.85;
        this.pluck(note, t, Math.min(spb * 1.5, 0.9), s.arpWave, s.arpGain * accent, bus);
      }
    }
    if (s.bell && inChord === 0 && (step / stepsPerChord) % 2 === 1) {
      this.pluck(chord[chord.length - 1] + 24, t + spb * 2, 2.5, 'sine', 0.04, bus);
    }
    if (s.kick && beat && (s.kick === 2 || step % 8 === 0)) this.kick(t, bus);
    if (s.hat && step % 4 === 2) this.hat(t, bus, 0.035);
    if (s.hat && s.kick === 2 && step % 2 === 1) this.hat(t, bus, 0.012);
  }

  private pad(chord: number[], t: number, dur: number, s: Song, bus: AudioNode) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.6;
    f.frequency.setValueAtTime(s.padCutoff * 0.5, t);
    f.frequency.linearRampToValueAtTime(s.padCutoff, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(s.padCutoff * 0.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(s.padGain, t + Math.min(1.4, dur * 0.3));
    g.gain.setValueAtTime(s.padGain, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.8);
    f.connect(g); g.connect(bus);
    for (const m of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 1);
      }
    }
  }

  private bassNote(m: number, t: number, dur: number, bus: AudioNode) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.1);
  }

  private pluck(m: number, t: number, dur: number, wave: OscillatorType, gain: number, bus: AudioNode) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = wave; o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(bus); g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private kick(t: number, bus: AudioNode) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.4);
  }

  private hat(t: number, bus: AudioNode, gain: number) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + 0.08);
  }
}
