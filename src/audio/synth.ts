/**
 * Buffers generated once at start-up: noise, the rooftop impulse response, Karplus-Strong strings
 * (shamisen with a sawari bridge + body, koto), and wave-shaper curves. No samples are loaded.
 */

/** Deterministic PRNG so every run builds the same buffers (and renders compare run to run). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(ctx: BaseAudioContext, secs: number, seed = 1): AudioBuffer {
  const r = rng(seed);
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return buf;
}

/** Pink noise (Paul Kellet's filter), normalised to ~0.5 peak. Loops cleanly enough at 6 s. */
export function makePink(ctx: BaseAudioContext, secs: number, seed = 2): AudioBuffer {
  const r = rng(seed);
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    d[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  // Crossfade the last 50 ms into the start so the loop point doesn't click.
  const xf = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    d[len - xf + i] = d[len - xf + i] * (1 - k) + d[i] * k;
  }
  for (let i = 0; i < len; i++) d[i] *= 0.5 / peak;
  return buf;
}

/**
 * Open rooftop at dusk: no ceiling, so a few sparse early reflections (the keep walls, the
 * ridge, the eaves below) then a long, airy, darkening tail. Stereo channels are decorrelated.
 */
export function makeRooftopIR(ctx: BaseAudioContext, secs = 2.4): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * secs);
  const ir = ctx.createBuffer(2, len, sr);
  const taps = [
    [0.011, 0.34, -0.3],
    [0.019, 0.22, 0.4],
    [0.031, 0.26, 0.1],
    [0.036, 0.2, -0.1],
    [0.047, 0.16, -0.5],
    [0.068, 0.12, 0.6],
    [0.093, 0.09, -0.2],
  ];
  for (let c = 0; c < 2; c++) {
    const r = rng(11 + c * 7);
    const ch = ir.getChannelData(c);
    let lp = 0;
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // Air absorption: the tail loses highs quickly (cutoff coefficient rises with time).
      const k = Math.min(0.93, 0.18 + t * 0.34);
      lp = lp * k + (r() * 2 - 1) * (1 - k);
      // Diffuse build-up over the first 60 ms, then exponential decay (RT60 ≈ 1.8 s: open air).
      const build = Math.min(1, t / 0.06);
      const v = lp * build * Math.exp(-t * 3.8) * 0.9;
      ch[i] = v;
      energy += v * v;
    }
    for (const [at, g, side] of taps) {
      const i0 = Math.floor(at * sr * (1 + c * 0.04));
      const gg = g * (c === 0 ? 1 - side * 0.5 : 1 + side * 0.5);
      for (let j = 0; j < 24 && i0 + j < len; j++) ch[i0 + j] += gg * (r() * 2 - 1) * Math.exp(-j / 6);
    }
    const norm = 1 / Math.sqrt(energy + 1e-9) * 0.9;
    for (let i = 0; i < len; i++) ch[i] *= norm;
  }
  return ir;
}

export interface StringOpts {
  /** Loop brightness 0..1 (loop low-pass mix). */
  bright: number;
  /** Per-period loss (closer to 1 = longer sustain). */
  loss: number;
  /** Sawari barrier depth (0 = off): the string buzzes against the bridge while it's loud. */
  sawari: number;
  /** Body resonances [freq, decay s, gain]. */
  body: [number, number, number][];
  /** Skin thwack of the plectrum on a skin-covered body (shamisen), 0..1. */
  skin: number;
  secs: number;
  seed: number;
}

/**
 * Karplus-Strong string with a fractional-delay loop (linear interpolation), a one-pole loop filter,
 * a one-sided sawari barrier at the bridge (folds the wave back when it swings past the barrier,
 * so the buzz is strongest in the loud attack and fades with the note) and parallel two-pole body modes.
 */
export function makeString(ctx: BaseAudioContext, freq: number, o: StringOpts): AudioBuffer {
  const sr = ctx.sampleRate;
  const r = rng(o.seed);
  const len = Math.floor(sr * o.secs);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  const period = sr / freq;
  const n = Math.ceil(period) + 2;
  const line = new Float32Array(n);
  // Plectrum near the bridge: bright, slightly one-sided excitation.
  for (let i = 0; i < n; i++) {
    const pos = i / n;
    line[i] = (r() * 2 - 1) * 0.8 + (pos < 0.18 ? 0.5 * (1 - pos / 0.18) : 0);
  }
  let w = 0;
  const frac = period - Math.floor(period);
  let lpPrev = 0;
  const a = 0.5 + o.bright * 0.45;
  const barrier = -0.32;
  for (let i = 0; i < len; i++) {
    // Read `period` samples behind the write head.
    const rp = w - Math.floor(period);
    const i0 = (rp + n * 4) % n;
    const i1 = (i0 - 1 + n) % n;
    const y = line[i0] * (1 - frac) + line[i1] * frac;
    let v = a * y + (1 - a) * lpPrev;
    lpPrev = v;
    v *= o.loss;
    if (o.sawari > 0 && v < barrier) v = barrier - (v - barrier) * o.sawari;
    line[w % n] = v;
    out[i] = y;
    w++;
  }
  // Body: parallel resonators driven by the string (two-pole band-pass).
  if (o.body.length) {
    const src = out.slice();
    for (const [f, dec, g] of o.body) {
      const rr = Math.exp(-1 / (dec * sr));
      const c1 = 2 * rr * Math.cos((2 * Math.PI * f) / sr);
      const c2 = -rr * rr;
      let y1 = 0, y2 = 0;
      const gain = g * (1 - rr);
      for (let i = 0; i < len; i++) {
        const y = src[i] * gain + c1 * y1 + c2 * y2;
        y2 = y1;
        y1 = y;
        out[i] += y * 6;
      }
    }
  }
  // Skin thwack (bachi hitting the skin) and plectrum click.
  if (o.skin > 0) {
    const rr = Math.exp(-1 / (0.035 * sr));
    const c1 = 2 * rr * Math.cos((2 * Math.PI * 230) / sr);
    let y1 = 0, y2 = 0;
    for (let i = 0; i < Math.min(len, sr * 0.15); i++) {
      const x = i < sr * 0.004 ? (r() * 2 - 1) : 0;
      const y = x * 0.5 + c1 * y1 - rr * rr * y2;
      y2 = y1;
      y1 = y;
      out[i] += y * o.skin * 2.2;
    }
  }
  for (let i = 0; i < 90; i++) out[i] += (r() * 2 - 1) * (1 - i / 90) * 0.35;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fade = sr * 0.25;
  for (let i = 0; i < len; i++) out[i] = (out[i] / peak) * 0.8 * Math.min(1, (len - i) / fade);
  return buf;
}

export const SHAMISEN: StringOpts = {
  bright: 0.85,
  loss: 0.9985,
  sawari: 0.55,
  body: [
    [185, 0.05, 1],
    [410, 0.04, 0.8],
    [760, 0.03, 0.6],
    [1320, 0.02, 0.45],
    [2650, 0.012, 0.3],
  ],
  skin: 1,
  secs: 3.4,
  seed: 5,
};

export const KOTO: StringOpts = {
  bright: 0.6,
  loss: 0.9992,
  sawari: 0,
  body: [
    [240, 0.06, 0.7],
    [520, 0.05, 0.5],
    [1100, 0.03, 0.3],
  ],
  skin: 0,
  secs: 3.6,
  seed: 9,
};

/** Wave-shaper curves. */
export function tanhCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
}

/** Safety clipper: linear to ±0.85, then a soft knee that never exceeds ±0.98. */
export function safetyCurve(n = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 1.6;
    const ax = Math.abs(x);
    const y = ax <= 0.85 ? ax : 0.85 + 0.13 * Math.tanh((ax - 0.85) / 0.13);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
