/**
 * Adaptive score, scheduled ahead on the audio clock (16th-note grid):
 *   title    — no drums; a sparse shakuhachi phrase over a low drone, the wind and the bell.
 *   fight    — taiko ensemble in layers by `intensity` (0..1: boss vitality, posture pressure, phase 2):
 *              o-daiko on the downbeats → nagado-daiko syncopation → shime-daiko 8ths / rolls;
 *              the shakuhachi (and a few koto notes) get sparser as the drums thicken.
 *   stings   — victory, death, defeat (the drums stop first).
 * Scale: miyako-bushi on D (D Eb G A Bb) — the melancholic in-scale.
 */
import type { Mix } from "./mix";
import { KOTO, makeString } from "./synth";

const SCALE = [0, 1, 5, 7, 8]; // semitones from D
const D4 = 293.66;
const note = (deg: number) => D4 * Math.pow(2, (SCALE[((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5)) / 12);

// 16-step patterns; values = velocity.
const ODAIKO = [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0.45, 0];
const ODAIKO2 = [1, 0, 0, 0.5, 0, 0, 0.7, 0, 0.9, 0, 0, 0.45, 0, 0, 0.75, 0.5];
const NAGADO = [0, 0, 0.6, 0, 0.8, 0, 0, 0.5, 0, 0, 0.6, 0, 0.8, 0, 0, 0];
const SHIME = [0.7, 0, 0.35, 0, 0.6, 0, 0.35, 0.3, 0.7, 0, 0.35, 0, 0.6, 0.3, 0.45, 0.35];
const KA = [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0.35, 0];

export type Scene = "title" | "fight" | "dying" | "defeat" | "deathblow" | "finisher" | "victory" | string;

export class Music {
  private out: GainNode;
  private drums: GainNode;
  private flute: GainNode;
  private koto: AudioBuffer;
  private drone: GainNode;
  private droneOsc: OscillatorNode[] = [];
  private next = 0;
  private step = 0;
  private phraseAt = 0;
  private lastDeg = 5;
  private scene: Scene = "";
  tempo = 76;
  intensity = 0;
  phase = 1;

  constructor(private readonly mix: Mix) {
    const ctx = mix.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(mix.music);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0;
    this.drums.connect(this.out);
    const dv = ctx.createGain();
    dv.gain.value = 0.25;
    this.drums.connect(dv).connect(mix.musicVerb);
    this.flute = ctx.createGain();
    this.flute.gain.value = 0.8;
    this.flute.connect(this.out);
    this.koto = makeString(ctx, 293.66, KOTO);
    // Drone: D2 + A2, slowly beating, low-passed; swells under the title / defeat.
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    this.drone.connect(lp).connect(this.out);
    for (const [f, d] of [[73.42, 0], [73.42, 7], [110, -4], [146.8, 3]] as const) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(this.drone);
      o.start();
      this.droneOsc.push(o);
    }
  }

  setScene(s: Scene): void {
    if (s === this.scene) return;
    const prev = this.scene;
    this.scene = s;
    const t = this.mix.now;
    const fight = s === "fight";
    // Stings play with the fight over: nothing to sit under, so they come up.
    this.out.gain.setTargetAtTime(s === "victory" || s === "defeat" || s === "dying" ? 2 : 1, t, 0.05);
    this.drums.gain.setTargetAtTime(fight ? 1 : 0, t, fight ? 0.3 : 0.12);
    const drone = s === "title" ? 0.06 : s === "defeat" ? 0.08 : s === "fight" ? 0.035 : 0.02;
    this.drone.gain.setTargetAtTime(drone, t, 1.2);
    if (fight && prev !== "fight") {
      this.next = t + 0.12;
      this.step = 0;
      this.phraseAt = t + 5 + Math.random() * 4;
    }
    if (s === "title") this.phraseAt = t + 2.5;
    if (s === "victory") this.victory(t + 0.35);
    if (s === "defeat") this.defeat(t + 0.2);
  }

  update(): void {
    const t = this.mix.now;
    const ahead = t + 0.16;
    if (this.scene === "fight") {
      if (this.next < t - 0.3) this.next = t + 0.02; // resumed after a stall: don't burst-schedule
      while (this.next < ahead) {
        this.drumStep(this.next, this.step);
        this.step++;
        this.next += 60 / this.tempo / 4;
      }
    }
    if ((this.scene === "title" || this.scene === "fight") && t >= this.phraseAt) {
      const busy = this.scene === "fight" ? this.intensity : 0;
      // Fewer, shorter phrases as the drums thicken; none at full pressure.
      if (busy < 0.85 && Math.random() > busy * 0.6) this.phrase(t + 0.05, busy);
      this.phraseAt = t + (this.scene === "title" ? 7 : 9) + Math.random() * (5 + busy * 8);
    }
  }

  // ------------------------------------------------------------------ drums

  private drumStep(t: number, i: number): void {
    const s = i % 16;
    const bar = Math.floor(i / 16);
    const L = this.intensity;
    const hum = () => t + (Math.random() - 0.5) * 0.008;
    // Denser drums play a little softer each, so the ensemble thickens without swamping the steel.
    const k = 1 - 0.25 * L;
    const od = L > 0.62 || this.phase === 2 ? ODAIKO2 : ODAIKO;
    if (od[s]) this.odaiko(hum(), od[s] * (0.75 + L * 0.3) * k);
    if (L > 0.5 && NAGADO[s]) this.nagado(hum(), NAGADO[s] * Math.min(1, (L - 0.5) * 3) * k);
    if (L > 0.68 && SHIME[s]) this.shime(hum(), SHIME[s] * Math.min(1, (L - 0.68) * 3.5) * k);
    if (L > 0.45 && KA[s]) this.ka(hum(), KA[s]);
    // Every 4th bar ends with a fill once the fight heats up.
    if (L > 0.72 && bar % 4 === 3 && s >= 12) this.shime(hum() + 60 / this.tempo / 8, 0.4);
  }

  /** O-daiko: huge low membrane (fundamental + 1.59 / 2.14 modes), skin slap, stick. */
  odaiko(t: number, v: number, big = false): void {
    const m = this.mix;
    const f = big ? 52 : 62 + Math.random() * 4;
    const d = this.drums;
    const g = 0.55 * v * (big ? 1.4 : 1);
    m.osc(d, t, f * 1.7, f, big ? 1.8 : 1.1, g, { glide: 0.04 });
    m.osc(d, t, f * 1.59 * 1.3, f * 1.59, 0.35, g * 0.35, { glide: 0.03 });
    m.osc(d, t, f * 2.14, f * 2.1, 0.18, g * 0.2);
    m.noiseHit(d, t, 0.09, "lowpass", 900, 0.7, g * 0.5);
    m.noiseHit(d, t, 0.012, "bandpass", 2600, 1.2, g * 0.25);
  }

  private nagado(t: number, v: number): void {
    const m = this.mix;
    const f = 118 + Math.random() * 6;
    const g = 0.32 * v;
    m.osc(this.drums, t, f * 1.5, f, 0.4, g, { glide: 0.025 });
    m.osc(this.drums, t, f * 1.59, f * 1.57, 0.14, g * 0.3);
    m.noiseHit(this.drums, t, 0.05, "bandpass", 1100, 0.8, g * 0.45);
  }

  private shime(t: number, v: number): void {
    const m = this.mix;
    const g = 0.2 * v;
    m.osc(this.drums, t, 520, 430, 0.1, g, { glide: 0.01 });
    m.noiseHit(this.drums, t, 0.035, "bandpass", 3200, 1.4, g * 0.9);
  }

  /** Rim "ka": dry wood click. */
  private ka(t: number, v: number): void {
    this.mix.noiseHit(this.drums, t, 0.022, "bandpass", 2300, 5, 0.22 * v);
    this.mix.osc(this.drums, t, 1850, 1700, 0.03, 0.05 * v);
  }

  // ------------------------------------------------------------------ melody

  /** A 2-5 note phrase moving mostly by step, ending low; long notes with meri bends. */
  private phrase(t: number, busy: number): void {
    const n = 2 + Math.floor(Math.random() * (busy > 0.5 ? 2 : 4));
    let at = t;
    let deg = this.lastDeg;
    for (let i = 0; i < n; i++) {
      deg += [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
      deg = Math.max(2, Math.min(9, deg));
      if (i === n - 1) deg = Math.max(2, deg - 1);
      const len = (i === n - 1 ? 2.2 : 0.9 + Math.random() * 0.9) * (busy > 0.5 ? 0.8 : 1);
      if (Math.random() < 0.3 && busy < 0.6) this.kotoNote(at, deg - 5, 0.45);
      this.shakuhachi(at, note(deg), len, 0.24 - busy * 0.08);
      at += len * (0.85 + Math.random() * 0.2);
    }
    this.lastDeg = deg;
  }

  /**
   * Shakuhachi: sine + a little 2nd/3rd harmonic, breath noise band-passed at the pitch, a chiff,
   * a scoop up from below (meri → kari), delayed vibrato and a breathy release.
   */
  shakuhachi(t: number, f: number, dur: number, gain: number): void {
    const ctx = this.mix.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.12);
    env.gain.setTargetAtTime(gain * 0.75, t + 0.12, dur * 0.5);
    env.gain.setTargetAtTime(0, t + dur, 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    env.connect(lp).connect(this.flute);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    lp.connect(send).connect(this.mix.musicVerb);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.16);
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.setValueAtTime(f * 0.94 * 2, t);
    o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.16);
    const o2g = ctx.createGain();
    o2g.gain.value = 0.12;
    o.connect(env);
    o2.connect(o2g).connect(env);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.8 + Math.random();
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(0, t + Math.min(0.5, dur * 0.4));
    lg.gain.linearRampToValueAtTime(14, t + dur);
    lfo.connect(lg);
    lg.connect(o.detune);
    lg.connect(o2.detune);
    const n = ctx.createBufferSource();
    n.buffer = this.mix.noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = 9;
    const ng = ctx.createGain();
    ng.gain.value = 1.6;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const hg = ctx.createGain();
    hg.gain.value = 0.05;
    n.connect(bp).connect(ng).connect(env);
    n.connect(hp).connect(hg).connect(env);
    // Chiff.
    this.mix.noiseHit(this.flute, t, 0.08, "bandpass", f * 3, 3, gain * 0.35);
    const end = t + dur + 0.7;
    for (const s of [o, o2, lfo, n]) {
      s.start(t);
      s.stop(end);
    }
    o.onended = () => {
      for (const x of [o, o2, lfo, n, o2g, lg, bp, ng, hp, hg, env, lp, send]) x.disconnect();
    };
  }

  kotoNote(t: number, deg: number, gain: number): void {
    this.mix.play(this.flute, t, this.koto, note(deg) / 293.66, gain, 0.7, this.mix.musicVerb);
  }

  // ------------------------------------------------------------------ stings

  private victory(t: number): void {
    // Rolling o-daiko crescendo into one huge hit, koto rising on the in-scale, a held flute note.
    for (let i = 0; i < 7; i++) this.odaiko(t + i * 0.11 * (1 - i * 0.06), 0.35 + i * 0.08);
    const hit = t + 0.72;
    this.odaiko(hit, 1.2, true);
    for (let i = 0; i < 5; i++) this.kotoNote(hit + 0.15 + i * 0.13, [0, 2, 3, 4, 5][i], 0.5);
    this.shakuhachi(hit + 0.8, note(7), 3.2, 0.22);
    this.shakuhachi(hit + 0.82, note(5), 3.0, 0.1);
  }

  private defeat(t: number): void {
    this.odaiko(t, 0.8, true);
    this.shakuhachi(t + 0.6, note(4), 1.6, 0.16);
    this.shakuhachi(t + 2.1, note(2) * 0.985, 3, 0.14);
  }

  /** The death moment: a falling bend on the flute over a deep drum (the "死" beat). */
  death(t: number): void {
    this.odaiko(t, 1, true);
    const ctx = this.mix.ctx;
    // Two detuned saw pads falling a minor third, dark.
    for (const d of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(146.8, t);
      o.frequency.exponentialRampToValueAtTime(123.5, t + 2.2);
      o.detune.value = d;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 2.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 2.8);
      o.connect(lp).connect(g).connect(this.out);
      g.connect(this.mix.musicVerb);
      o.start(t);
      o.stop(t + 2.9);
      o.onended = () => {
        o.disconnect();
        lp.disconnect();
        g.disconnect();
      };
    }
    this.shakuhachi(t + 0.3, note(6), 0.5, 0.18);
    this.shakuhachi(t + 0.8, note(4) * 0.97, 1.8, 0.16);
  }
}
