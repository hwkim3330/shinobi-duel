/**
 * Rooftop ambience on the ambience bus: a wide low wind howl (two decorrelated pink-noise beds,
 * breathing band-passes), random gusts with a whistle, a snow hush, a distant temple bell
 * (bonshō: detuned inharmonic partials, long beating decay) and the odd lantern creak.
 * `intensity` (0..1) lifts the wind as the fight heats up.
 */
import type { Mix } from "./mix";

export class Ambience {
  private howl: GainNode;
  private howlF: BiquadFilterNode[] = [];
  private gust: GainNode;
  private gustF: BiquadFilterNode;
  private whistle: GainNode;
  private whistleF: BiquadFilterNode;
  private hush: GainNode;
  private nextGust = 0;
  private nextBell = 0;
  private nextCreak = 0;
  private level = 0;
  private retarget = 0;
  intensity = 0.1;
  on = true;

  constructor(private readonly mix: Mix) {
    const ctx = mix.ctx;
    const loop = (buf: AudioBuffer, off: number) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, off);
      return s;
    };
    const g = (v: number) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.howl = g(0);
    this.howl.connect(mix.amb);
    for (const [pan, off, rate] of [[-0.7, 0, 0.09], [0.7, 2.7, 0.13]] as const) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 300;
      bp.Q.value = 1.1;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      loop(mix.pink, off).connect(lp).connect(bp).connect(p).connect(this.howl);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = g(120);
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
      this.howlF.push(bp);
    }
    this.gust = g(0);
    this.gustF = ctx.createBiquadFilter();
    this.gustF.type = "bandpass";
    this.gustF.frequency.value = 700;
    this.gustF.Q.value = 0.8;
    loop(mix.pink, 1.3).connect(this.gustF).connect(this.gust).connect(mix.amb);
    this.whistle = g(0);
    this.whistleF = ctx.createBiquadFilter();
    this.whistleF.type = "bandpass";
    this.whistleF.frequency.value = 1150;
    this.whistleF.Q.value = 22;
    const wp = ctx.createStereoPanner();
    wp.pan.value = 0.35;
    loop(mix.noise, 0.4).connect(this.whistleF).connect(this.whistle).connect(wp).connect(mix.amb);
    // Snow hush: soft high band, wide.
    this.hush = g(0);
    this.hush.connect(mix.amb);
    for (const [pan, off] of [[-0.8, 0.5], [0.8, 3.1]] as const) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3200;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 9000;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      loop(mix.pink, off).connect(hp).connect(lp).connect(p).connect(this.hush);
    }
    const t = ctx.currentTime;
    this.nextGust = t + 2;
    this.nextBell = t + 6;
    this.nextCreak = t + 4;
  }

  update(dt: number): void {
    const m = this.mix;
    const t = m.now;
    const I = this.intensity;
    const target = this.on ? 0.55 + I * 0.55 : 0;
    this.level += (target - this.level) * Math.min(1, dt * 2);
    // Re-target a few times a second, not every frame.
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.25;
      this.howl.gain.setTargetAtTime(this.level, t, 0.2);
      this.hush.gain.setTargetAtTime(this.on ? 0.22 : 0, t, 0.3);
      for (const f of this.howlF) f.Q.setTargetAtTime(1.1 + I * 1.2, t, 0.5);
    }
    if (!this.on) return;
    if (t >= this.nextGust) {
      // A gust: swell over 1-2 s, a whistle riding it, fade over 2-3 s.
      const up = 0.9 + Math.random() * 1.2;
      const down = 1.8 + Math.random() * 1.6;
      const peak = (0.35 + Math.random() * 0.35) * (0.6 + I * 0.8);
      const gg = this.gust.gain;
      gg.cancelScheduledValues(t);
      gg.setValueAtTime(gg.value, t);
      gg.linearRampToValueAtTime(peak, t + up);
      gg.linearRampToValueAtTime(0.02, t + up + down);
      const f = 500 + Math.random() * 500 + I * 300;
      this.gustF.frequency.cancelScheduledValues(t);
      this.gustF.frequency.setValueAtTime(this.gustF.frequency.value, t);
      this.gustF.frequency.linearRampToValueAtTime(f * 1.5, t + up);
      this.gustF.frequency.linearRampToValueAtTime(f, t + up + down);
      const wg = this.whistle.gain;
      wg.cancelScheduledValues(t);
      wg.setValueAtTime(wg.value, t);
      wg.linearRampToValueAtTime(peak * 0.1, t + up);
      wg.linearRampToValueAtTime(0, t + up + down);
      this.whistleF.frequency.setTargetAtTime(900 + Math.random() * 700, t, up);
      this.nextGust = t + up + down + 1 + Math.random() * (6 - I * 4);
    }
    if (t >= this.nextBell) {
      this.bell(t + 0.05);
      this.nextBell = t + 26 + Math.random() * 22;
    }
    if (t >= this.nextCreak) {
      this.creak(t + 0.02);
      this.nextCreak = t + 6 + Math.random() * 10;
    }
  }

  /** Distant bonshō: low hum partial + inharmonic strike partials in detuned pairs, far and dark. */
  bell(t: number, gain = 1): void {
    const m = this.mix;
    const ctx = m.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.5 * gain;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1500;
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.45;
    out.connect(lp).connect(pan).connect(m.amb);
    const send = ctx.createGain();
    send.gain.value = 1.4;
    lp.connect(send).connect(m.verb);
    const f = 92;
    const partials: [number, number, number][] = [
      [0.5, 0.2, 9],
      [1, 0.28, 8],
      [1.19, 0.14, 5],
      [1.51, 0.12, 4.5],
      [2.03, 0.1, 3.5],
      [2.7, 0.06, 2.6],
      [3.37, 0.05, 2],
      [4.1, 0.03, 1.4],
    ];
    for (const [r, g, d] of partials) {
      m.osc(out, t, f * r, f * r, d, g, { attack: 0.004 });
      m.osc(out, t, f * r * 1.004, f * r * 1.004, d * 0.9, g * 0.7, { attack: 0.004 });
    }
    m.noiseHit(out, t, 0.08, "lowpass", 600, 0.7, 0.2);
    setTimeoutFree(ctx, t + 10, () => {
      out.disconnect();
      lp.disconnect();
      pan.disconnect();
      send.disconnect();
    });
  }

  /** Lantern creak: stick-slip friction — a short, pitch-wobbling pulse train through a wood band. */
  creak(t: number): void {
    const m = this.mix;
    const ctx = m.ctx;
    const dur = 0.35 + Math.random() * 0.4;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    const f0 = 38 + Math.random() * 30;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (1.4 + Math.random() * 0.6), t + dur * 0.6);
    o.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 700;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(bp).connect(g).connect(p).connect(m.amb);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      bp.disconnect();
      g.disconnect();
      p.disconnect();
    };
  }
}

/** Run `fn` once the audio clock passes `at` (a silent, self-disposing source as the timer). */
export function setTimeoutFree(ctx: BaseAudioContext, at: number, fn: () => void): void {
  const s = ctx.createConstantSource();
  s.offset.value = 0;
  s.onended = () => {
    s.disconnect();
    fn();
  };
  // Must be connected in some engines for onended to fire.
  s.connect(ctx.destination);
  s.start(at);
  s.stop(at + 0.01);
}
