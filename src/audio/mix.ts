/**
 * The mix: buses, generated reverb, positional emitters, ducking, and the node-level primitives
 * every sound is built from.
 *
 *   emitters (player / boss / centre; sfx + voice) ─ gain (distance) ─ StereoPanner ─┐
 *   sfx 0.9 ───────────────┐                                                          │
 *   voice 0.5 ─────────────┤                                                          │
 *   music 0.22 ─ duck ─────┼─ master 0.8 ─ glue comp ─ limiter ─ safety clip ─ out   │
 *   ambience 0.34 ─ duck ──┤                                                          │
 *   reverb (22 ms pre-delay, rooftop IR) 0.42┘                                        │
 *
 * Every one-shot disconnects itself when its source ends; nothing here allocates per frame.
 */
import { makeNoise, makePink, makeRooftopIR, safetyCurve } from "./synth";

export const LEVELS = { master: 0.8, sfx: 0.9, voice: 0.5, music: 0.22, amb: 0.34, verbReturn: 0.42 };

export interface Emitter {
  /** Dry input for this emitter (panned + distance attenuated). */
  in: GainNode;
  pan: StereoPannerNode;
  lastPan: number;
  lastGain: number;
}

type Dest = AudioNode;

export class Mix {
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly voice: GainNode;
  readonly music: GainNode;
  readonly amb: GainNode;
  readonly verb: GainNode;
  readonly musicVerb: GainNode;
  /** Sidechain-style hit duck (music + ambience). */
  private readonly hitDuck: GainNode;
  /** Scene duck (finisher / deathblow cinematics), set by the game. */
  private readonly sceneDuck: GainNode;
  private readonly mute: GainNode;
  readonly noise: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly em: { p: Emitter; b: Emitter; c: Emitter; pv: Emitter; bv: Emitter };
  muted = false;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    const g = (v: number) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.noise = makeNoise(ctx, 3, 1);
    this.pink = makePink(ctx, 6, 2);

    this.mute = g(1);
    this.master = g(LEVELS.master);
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 10;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    // The compressor can overshoot on its attack; the shaper keeps the output under ±0.98.
    const pre = g(1 / 1.6);
    const clip = ctx.createWaveShaper();
    clip.curve = safetyCurve();
    clip.oversample = "2x";
    // Nothing useful below 30 Hz: keep it from pumping the compressor.
    const sub = ctx.createBiquadFilter();
    sub.type = "highpass";
    sub.frequency.value = 30;
    this.master.connect(sub).connect(glue).connect(lim).connect(pre).connect(clip).connect(this.mute).connect(dest);

    this.sfx = g(LEVELS.sfx);
    this.voice = g(LEVELS.voice);
    this.music = g(LEVELS.music);
    this.amb = g(LEVELS.amb);
    this.hitDuck = g(1);
    this.sceneDuck = g(1);
    this.sfx.connect(this.master);
    this.voice.connect(this.master);
    // Taiko sub sits under the steel: −6 dB shelf at 90 Hz on the music.
    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf";
    shelf.frequency.value = 90;
    shelf.gain.value = -6;
    this.music.connect(shelf).connect(this.hitDuck);
    this.amb.connect(this.hitDuck);
    this.hitDuck.connect(this.sceneDuck).connect(this.master);

    const conv = ctx.createConvolver();
    conv.buffer = makeRooftopIR(ctx);
    const predelay = ctx.createDelay(0.1);
    predelay.delayTime.value = 0.022;
    // Keep mud out of the tail.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;
    this.verb = g(1);
    this.verb.connect(predelay).connect(hp).connect(conv);
    const ret = g(LEVELS.verbReturn);
    conv.connect(ret).connect(this.master);
    // Music reverb shares the IR but is ducked with the music.
    this.musicVerb = g(0.55);
    const conv2 = ctx.createConvolver();
    conv2.buffer = conv.buffer;
    this.musicVerb.connect(conv2).connect(this.music);

    const mk = (bus: GainNode): Emitter => {
      const i = g(1);
      const pan = ctx.createStereoPanner();
      i.connect(pan).connect(bus);
      return { in: i, pan, lastPan: 0, lastGain: 1 };
    };
    this.em = { p: mk(this.sfx), b: mk(this.sfx), c: mk(this.sfx), pv: mk(this.voice), bv: mk(this.voice) };
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.mute.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  setSceneDuck(v: number): void {
    this.sceneDuck.gain.setTargetAtTime(v, this.ctx.currentTime, 0.25);
  }

  /** Pull music + ambience down to `depth` fast, hold, then recover. */
  duck(depth: number, hold = 0.08, release = 0.5): void {
    const t = this.ctx.currentTime;
    const p = this.hitDuck.gain;
    const cur = Math.min(p.value, 1);
    const to = Math.min(cur, depth);
    p.cancelScheduledValues(t);
    p.setValueAtTime(cur, t);
    p.linearRampToValueAtTime(to, t + 0.012);
    p.setValueAtTime(to, t + 0.012 + hold);
    p.setTargetAtTime(1, t + 0.012 + hold, release / 3);
  }

  /** Place an emitter: `pan` −1..1, `gain` from distance. */
  place(e: Emitter, pan: number, gain: number): void {
    // Only schedule when it moved: keeps the automation timeline short.
    if (Math.abs(pan - e.lastPan) < 0.01 && Math.abs(gain - e.lastGain) < 0.01) return;
    e.lastPan = pan;
    e.lastGain = gain;
    const t = this.ctx.currentTime;
    e.pan.pan.setTargetAtTime(pan, t, 0.04);
    e.in.gain.setTargetAtTime(gain, t, 0.04);
  }

  // ------------------------------------------------------------------ primitives

  private finish(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    src.onended = () => {
      src.disconnect();
      for (const n of nodes) n.disconnect();
    };
  }

  /**
   * Filtered noise burst. `shape`: 0 = hit (fast attack, exponential decay), 0..1 = swell (the peak
   * sits at that fraction of the duration: whooshes).
   */
  noiseHit(
    dest: Dest,
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    gain: number,
    o: { to?: number; verb?: number; shape?: number; pink?: boolean; attack?: number } = {},
  ): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = o.pink ? this.pink : this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    const env = ctx.createGain();
    const shape = o.shape ?? 0;
    env.gain.setValueAtTime(0, t);
    if (shape > 0) {
      const pk = t + dur * shape;
      if (o.to) {
        // Swept whoosh: rises to the peak frequency, then falls away (Doppler-ish).
        f.frequency.exponentialRampToValueAtTime(o.to, pk);
        f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.8), t + dur);
      }
      env.gain.linearRampToValueAtTime(gain * 0.25, t + dur * shape * 0.6);
      env.gain.linearRampToValueAtTime(gain, pk);
      env.gain.exponentialRampToValueAtTime(0.0003, t + dur);
    } else {
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      env.gain.linearRampToValueAtTime(gain, t + (o.attack ?? 0.002));
      env.gain.exponentialRampToValueAtTime(0.0003, t + dur);
    }
    src.connect(f).connect(env).connect(dest);
    let send: GainNode | null = null;
    if (o.verb) {
      send = ctx.createGain();
      send.gain.value = o.verb;
      env.connect(send).connect(this.verb);
    }
    const off = Math.random() * (src.buffer.duration - dur - 0.1);
    src.start(t, Math.max(0, off));
    src.stop(t + dur + 0.02);
    if (send) this.finish(src, f, env, send);
    else this.finish(src, f, env);
  }

  /** Pitched hit: oscillator with a pitch glide f0 → f1 and exponential decay. */
  osc(
    dest: Dest,
    t: number,
    f0: number,
    f1: number,
    dur: number,
    gain: number,
    o: { type?: OscillatorType; attack?: number; verb?: number; glide?: number; detune?: number } = {},
  ): void {
    const ctx = this.ctx;
    const src = ctx.createOscillator();
    src.type = o.type ?? "sine";
    src.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) src.frequency.exponentialRampToValueAtTime(f1, t + (o.glide ?? dur));
    if (o.detune) src.detune.value = o.detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + (o.attack ?? 0.002));
    env.gain.exponentialRampToValueAtTime(0.0002, t + dur);
    src.connect(env).connect(dest);
    let send: GainNode | null = null;
    if (o.verb) {
      send = ctx.createGain();
      send.gain.value = o.verb;
      env.connect(send).connect(this.verb);
    }
    src.start(t);
    src.stop(t + dur + 0.02);
    if (send) this.finish(src, env, send);
    else this.finish(src, env);
  }

  /** Buffer playback (strings), with rate and optional reverb send. */
  play(dest: Dest, t: number, buf: AudioBuffer, rate: number, gain: number, verb = 0, verbBus: GainNode = this.verb): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    env.gain.value = gain;
    src.connect(env).connect(dest);
    let send: GainNode | null = null;
    if (verb) {
      send = ctx.createGain();
      send.gain.value = verb;
      env.connect(send).connect(verbBus);
    }
    src.start(t);
    if (send) this.finish(src, env, send);
    else this.finish(src, env);
  }

  /** A little granular spray: `n` tiny filtered noise ticks scattered over `spread` s (snow, ink, grit). */
  grains(dest: Dest, t: number, n: number, spread: number, freq: number, gain: number, q = 1.2, verb = 0): void {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const at = t + spread * u * u;
      const g = gain * (1 - u * 0.7) * (0.5 + Math.random() * 0.5);
      this.noiseHit(dest, at, 0.008 + Math.random() * 0.02, "bandpass", freq * (0.7 + Math.random() * 0.6), q, g, { verb });
    }
  }
}
