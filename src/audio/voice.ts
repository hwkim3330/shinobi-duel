/**
 * Synthesised voices: a soft glottal source (band-limited, harmonics falling 1/n^1.6) plus breath
 * noise, through three parallel formant band-passes. Kept short and low in the mix: exertion
 * breaths for the kunoichi, chest grunts / kiai for the general, one battle cry at his rise.
 */
import type { Emitter, Mix } from "./mix";
import { tanhCurve } from "./synth";

interface Vowel {
  f: [number, number, number];
  g: [number, number, number];
}

// Female "ha" / "hu" / "a" and male "o" / "a" / "e" (formants in Hz).
const V = {
  fHa: { f: [820, 1580, 2900], g: [1, 0.55, 0.25] } as Vowel,
  fHu: { f: [460, 1150, 2700], g: [1, 0.35, 0.18] } as Vowel,
  fA: { f: [900, 1450, 3000], g: [1, 0.6, 0.3] } as Vowel,
  mO: { f: [500, 850, 2400], g: [1, 0.5, 0.18] } as Vowel,
  mA: { f: [700, 1150, 2500], g: [1, 0.55, 0.22] } as Vowel,
  mE: { f: [480, 1750, 2500], g: [1, 0.45, 0.2] } as Vowel,
};

export interface VoiceSpec {
  vowel: Vowel;
  /** f0 contour: start, peak, end (Hz). */
  f0: [number, number, number];
  dur: number;
  gain: number;
  /** 0 = voiced only, 1 = whisper. */
  breath: number;
  /** Saturation for kiai grit (0 = clean). */
  grit?: number;
  vibrato?: number;
  verb?: number;
  /** Morph to a second vowel over the duration. */
  to?: Vowel;
}

export class Voices {
  private glottal: PeriodicWave;
  private lastP = -1;
  private lastB = -1;

  constructor(private readonly mix: Mix) {
    const n = 40;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = 1 / Math.pow(k, 1.6);
    this.glottal = mix.ctx.createPeriodicWave(re, im);
  }

  private say(em: Emitter, t0: number, s: VoiceSpec): void {
    const ctx = this.mix.ctx;
    const t = Math.max(t0, ctx.currentTime);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    const att = Math.min(0.03, s.dur * 0.2);
    out.gain.linearRampToValueAtTime(s.gain, t + att);
    out.gain.setTargetAtTime(s.gain * 0.7, t + att, s.dur * 0.3);
    out.gain.exponentialRampToValueAtTime(0.0003, t + s.dur);
    let dest: AudioNode = out;
    let shaper: WaveShaperNode | null = null;
    if (s.grit) {
      shaper = ctx.createWaveShaper();
      shaper.curve = tanhCurve(1 + s.grit * 4);
      shaper.connect(out);
      dest = shaper;
    }
    const nodes: AudioNode[] = [out];
    if (shaper) nodes.push(shaper);
    // Formant bank.
    const bank: BiquadFilterNode[] = [];
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(s.vowel.f[i], t);
      if (s.to) bp.frequency.linearRampToValueAtTime(s.to.f[i], t + s.dur * 0.8);
      bp.Q.value = 5 + i * 3;
      const fg = ctx.createGain();
      fg.gain.value = s.vowel.g[i] * (3 + i * 2.5);
      bp.connect(fg).connect(dest);
      bank.push(bp);
      nodes.push(bp, fg);
    }
    const srcIn = ctx.createGain();
    for (const b of bank) srcIn.connect(b);
    nodes.push(srcIn);
    // Voiced source.
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.glottal);
    const [a, pk, e] = s.f0;
    o.frequency.setValueAtTime(a, t);
    o.frequency.linearRampToValueAtTime(pk, t + s.dur * 0.25);
    o.frequency.exponentialRampToValueAtTime(e, t + s.dur);
    const og = ctx.createGain();
    og.gain.value = (1 - s.breath) * 0.6;
    o.connect(og).connect(srcIn);
    nodes.push(og);
    // Jitter: low-passed noise wobbling the pitch ±~12 cents so the source isn't machine-periodic.
    const jn = ctx.createBufferSource();
    jn.buffer = this.mix.noise;
    jn.loop = true;
    const jlp = ctx.createBiquadFilter();
    jlp.type = "lowpass";
    jlp.frequency.value = 25;
    const jg = ctx.createGain();
    jg.gain.value = 60;
    jn.connect(jlp).connect(jg).connect(o.detune);
    jn.start(t, Math.random() * 2);
    jn.stop(t + s.dur + 0.05);
    nodes.push(jn, jlp, jg);
    let lfo: OscillatorNode | null = null;
    if (s.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const lg = ctx.createGain();
      lg.gain.value = s.vibrato;
      lfo.connect(lg).connect(o.detune);
      lfo.start(t);
      lfo.stop(t + s.dur + 0.05);
      nodes.push(lg);
    }
    // Breath.
    const n = ctx.createBufferSource();
    n.buffer = this.mix.noise;
    n.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = s.breath * 0.9 + 0.05;
    n.connect(ng).connect(srcIn);
    nodes.push(ng);
    // Soften everything above the 3rd formant.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    out.connect(lp).connect(em.in);
    nodes.push(lp);
    if (s.verb) {
      const send = ctx.createGain();
      send.gain.value = s.verb;
      lp.connect(send).connect(this.mix.verb);
      nodes.push(send);
    }
    o.start(t);
    n.start(t, Math.random() * 2);
    const end = t + s.dur + 0.05;
    o.stop(end);
    n.stop(end);
    o.onended = () => {
      o.disconnect();
      n.disconnect();
      lfo?.disconnect();
      for (const x of nodes) x.disconnect();
    };
  }

  // ------------------------------------------------------------------ kunoichi

  /** Attack exertion: a short breathy "ha" (quiet; `heavy` a touch fuller). */
  playerAttack(t: number, heavy: boolean): void {
    if (t - this.lastP < 0.45) return;
    this.lastP = t;
    const f = 300 + Math.random() * 40;
    this.say(this.mix.em.pv, t, {
      vowel: heavy ? V.fA : V.fHa,
      to: V.fHu,
      f0: [f * 1.05, f * 1.12, f * 0.82],
      dur: heavy ? 0.24 : 0.15,
      gain: heavy ? 0.5 : 0.34,
      breath: heavy ? 0.8 : 0.88,
      verb: 0.1,
    });
  }

  /** Dodge / jump: a clipped intake-ish "hu". */
  playerEffort(t: number): void {
    if (t - this.lastP < 0.6) return;
    this.lastP = t;
    const f = 320 + Math.random() * 30;
    this.say(this.mix.em.pv, t, { vowel: V.fHu, f0: [f, f * 1.05, f * 0.9], dur: 0.12, gain: 0.26, breath: 0.85 });
  }

  /** Hurt: a sharp, pained "ah" (bigger when `big`). */
  playerHurt(t: number, big = false): void {
    this.lastP = t;
    const f = 340 + Math.random() * 50;
    this.say(this.mix.em.pv, t, {
      vowel: V.fA,
      to: V.fHu,
      f0: [f * 1.15, f * 1.0, f * 0.7],
      dur: big ? 0.42 : 0.26,
      gain: big ? 0.34 : 0.26,
      breath: 0.6,
      grit: 0.15,
      verb: 0.12,
    });
  }

  /** After the gourd: a relieved exhale. */
  playerExhale(t: number): void {
    this.say(this.mix.em.pv, t, { vowel: V.fHa, to: V.fHu, f0: [250, 240, 200], dur: 0.5, gain: 0.26, breath: 0.92 });
  }

  // ------------------------------------------------------------------ general

  /** Chest grunt / kiai on a heavy blow. */
  bossKiai(t: number, big: boolean): void {
    if (t - this.lastB < 0.8) return;
    this.lastB = t;
    const f = 105 + Math.random() * 18;
    this.say(this.mix.em.bv, t, {
      vowel: big ? V.mE : V.mO,
      to: V.mA,
      f0: [f * 1.1, f * 1.2, f * 0.8],
      dur: big ? 0.42 : 0.24,
      gain: big ? 0.42 : 0.3,
      breath: 0.3,
      grit: big ? 0.7 : 0.4,
      verb: 0.2,
    });
  }

  /** Hurt / effort grunt. */
  bossGrunt(t: number): void {
    if (t - this.lastB < 0.6) return;
    this.lastB = t;
    const f = 95 + Math.random() * 15;
    this.say(this.mix.em.bv, t, { vowel: V.mO, f0: [f, f * 1.1, f * 0.8], dur: 0.2, gain: 0.3, breath: 0.4, grit: 0.35, verb: 0.12 });
  }

  /** Phase-2 rise: a long roar "oo-aaah" swelling, vibrato and grit, into the reverb. */
  bossBattleCry(t: number): void {
    this.lastB = t + 1.6;
    const bv = this.mix.em.bv;
    this.say(bv, t, {
      vowel: V.mO,
      to: V.mA,
      f0: [92, 138, 104],
      dur: 1.7,
      gain: 0.6,
      breath: 0.25,
      grit: 0.8,
      vibrato: 28,
      verb: 0.5,
    });
    // A lower octave double gives the chest weight.
    this.say(bv, t + 0.02, { vowel: V.mO, to: V.mA, f0: [60, 70, 55], dur: 1.6, gain: 0.25, breath: 0.1, grit: 0.5, verb: 0.3 });
  }
}
