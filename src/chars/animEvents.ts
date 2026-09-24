/**
 * Per-clip animation event tables: the single place combat timing comes from.
 *
 * Boss attacks and player swings read their active windows (hitStart/hitEnd), the expected
 * blade contact, wind-up glints, tracking/lunge windows and so on from the table of whichever
 * body is driving the fighter, so hitboxes and deflect timing follow the real animation frames.
 * The procedural tables reproduce the tuned numbers exactly. The Mixamo tables are first
 * estimates in normalized clip time (0..1) and are meant to be tuned with `?debug=anim`.
 *
 * Times are clip seconds, or normalized when the clip entry sets `norm: true`.
 */

export interface HitWindow {
  /** Active window: the blade can connect between start and end. */
  start: number;
  end: number;
  /** Where the blade is expected to meet the target (deflect bot / stats). */
  contact?: number;
}

export interface ClipEvents {
  norm?: boolean;
  /**
   * Skinned bodies: hit windows / contact / wind-up / plunge of an attack clip are found from the
   * blade's motion at load unless the table is marked tuned (then the numbers here are used).
   */
  tuned?: boolean;
  /** Logical length of the move (defaults to the clip length). */
  end?: number;
  hits?: HitWindow[];
  /** Wind-up peak: the glint. */
  windupPeak?: number[];
  /** Swing sound (defaults to each hit start). */
  whoosh?: number[];
  /** Boss turns to follow the target inside these windows. */
  track?: [number, number][];
  /** Boss lunges (distance/stop come from the attack's gameplay data). */
  lunge?: [number, number][];
  /** Player: when the next combo press may fire. */
  chain?: number;
  /** Footfalls (looping locomotion, skinned bodies). */
  footsteps?: number[];
  /** Leap: takeoff and landing. */
  leapOff?: number;
  slam?: number;
  /** Finisher: blade driven in, blade drawn out. */
  plunge?: number;
  withdraw?: number;
  /**
   * Named moments of a move: `sip` (gourd drink takes effect), `stomp` (mikiri foot lands on the
   * blade), `clamp` (grab closes), `slam` / `release` (throw), `up` (get-up regains control).
   */
  cue?: Record<string, number>;
}

export type EventTable = Record<string, ClipEvents>;

/** Resolved events in seconds. */
export type Timeline = Omit<Required<ClipEvents>, "norm" | "hits" | "tuned"> & { hits: Required<HitWindow>[] };

export function resolveEvents(ev: ClipEvents | undefined, clipDur: number, speed = 1): Timeline {
  const e = ev ?? {};
  const k = (e.norm ? clipDur : 1) / speed;
  const s = (v: number) => v * k;
  const hits = (e.hits ?? []).map((h) => ({ start: s(h.start), end: s(h.end), contact: s(h.contact ?? (h.start + h.end) / 2) }));
  return {
    end: e.end !== undefined ? s(e.end) : clipDur / speed,
    hits,
    windupPeak: (e.windupPeak ?? []).map(s),
    whoosh: (e.whoosh ?? hits.map((h) => h.start / k)).map(s),
    track: (e.track ?? []).map(([a, b]) => [s(a), s(b)] as [number, number]),
    lunge: (e.lunge ?? []).map(([a, b]) => [s(a), s(b)] as [number, number]),
    chain: e.chain !== undefined ? s(e.chain) : clipDur / speed,
    footsteps: (e.footsteps ?? []).map(s),
    leapOff: e.leapOff !== undefined ? s(e.leapOff) : -1,
    slam: e.slam !== undefined ? s(e.slam) : -1,
    plunge: e.plunge !== undefined ? s(e.plunge) : -1,
    withdraw: e.withdraw !== undefined ? s(e.withdraw) : -1,
    cue: Object.fromEntries(Object.entries(e.cue ?? {}).map(([n, v]) => [n, s(v)])),
  };
}

/** A named cue of a timeline, or `fallback` when the table doesn't define it. */
export function cueOf(t: Timeline, name: string, fallback: number): number {
  return t.cue[name] ?? fallback;
}

/** Shift every time in a timeline (used to concatenate clip segments into one attack). */
export function offsetTimeline(t: Timeline, off: number, after = -Infinity, hold = 0): Timeline {
  const f = (v: number) => (v < 0 ? v : v + off + (v > after ? hold : 0));
  return {
    end: f(t.end),
    hits: t.hits.map((h) => ({ start: f(h.start), end: f(h.end), contact: f(h.contact) })),
    windupPeak: t.windupPeak.map(f),
    whoosh: t.whoosh.map(f),
    track: t.track.map(([a, b]) => [f(a), f(b)] as [number, number]),
    lunge: t.lunge.map(([a, b]) => [f(a), f(b)] as [number, number]),
    chain: f(t.chain),
    footsteps: t.footsteps.map(f),
    leapOff: f(t.leapOff),
    slam: f(t.slam),
    plunge: f(t.plunge),
    withdraw: f(t.withdraw),
    cue: Object.fromEntries(Object.entries(t.cue).map(([n, v]) => [n, f(v)])),
  };
}

export function mergeTimelines(parts: Timeline[]): Timeline {
  const last = parts[parts.length - 1];
  const pick = (k: "leapOff" | "slam" | "plunge" | "withdraw") => parts.map((p) => p[k]).find((v) => v >= 0) ?? -1;
  return {
    end: last.end,
    hits: parts.flatMap((p) => p.hits),
    windupPeak: parts.flatMap((p) => p.windupPeak),
    whoosh: parts.flatMap((p) => p.whoosh),
    track: parts.flatMap((p) => p.track),
    lunge: parts.flatMap((p) => p.lunge),
    chain: last.chain,
    footsteps: parts.flatMap((p) => p.footsteps),
    leapOff: pick("leapOff"),
    slam: pick("slam"),
    plunge: pick("plunge"),
    withdraw: pick("withdraw"),
    cue: Object.assign({}, ...parts.map((p) => p.cue)),
  };
}

// ---------------------------------------------------------------------------- procedural rig

export const PROCEDURAL_PLAYER: EventTable = {
  attack1: { hits: [{ start: 0.12, end: 0.27 }], chain: 0.3, end: 0.6 },
  attack2: { hits: [{ start: 0.1, end: 0.26 }], chain: 0.3, end: 0.6 },
  attack3: { hits: [{ start: 0.21, end: 0.38 }], chain: 0.62, end: 0.9 },
  // Held attack: the light cut flows into a slow two-handed cut that his guard can't turn aside.
  attackC: { hits: [{ start: 0.4, end: 0.58 }], chain: 0.95, end: 1.0 },
  // Airborne downward cut; the state ends on landing (end = worst case).
  jumpAtk: { hits: [{ start: 0.16, end: 0.34 }], end: 0.6 },
  // Kick off his body / head in the air.
  kick: { cue: { hit: 0.07 }, end: 0.3 },
  heal: { cue: { sip: 0.45 }, end: 1.0 },
  mikiri: { cue: { stomp: 0.16 }, end: 1.05 },
  revive: { cue: { up: 1.35 }, end: 1.7 },
  thrown: { cue: { slam: 0.72, up: 1.65 }, end: 1.9 },
  // First-marker deathblow: a shorter plunge (no cinematic).
  deathblow: { plunge: 0.3, withdraw: 0.85, end: 1.45 },
  finisher: { plunge: 0.43, withdraw: 1.5, end: 2.7 },
};

export const PROCEDURAL_BOSS: EventTable = {
  combo: {
    end: 2.2,
    hits: [
      { start: 0.52, end: 0.68, contact: 0.585 },
      { start: 0.9, end: 1.05, contact: 0.955 },
      { start: 1.27, end: 1.43, contact: 1.325 },
    ],
    windupPeak: [0.3],
    track: [[0, 0.46], [0.68, 0.84], [1.06, 1.2]],
    lunge: [[0.45, 0.62], [0.84, 0.98], [1.2, 1.36]],
  },
  comboDelay: {
    end: 2.7,
    hits: [
      { start: 0.52, end: 0.68, contact: 0.585 },
      { start: 0.9, end: 1.05, contact: 0.955 },
      { start: 1.75, end: 1.91, contact: 1.805 },
    ],
    windupPeak: [0.3, 1.62],
    track: [[0, 0.46], [0.68, 0.84], [1.06, 1.68]],
    lunge: [[0.45, 0.62], [0.84, 0.98], [1.7, 1.85]],
  },
  overhead: {
    end: 2.25,
    hits: [{ start: 1.22, end: 1.38, contact: 1.275 }],
    windupPeak: [0.42, 1.02],
    track: [[0, 1.18]],
    lunge: [[0.0, 0.45], [1.2, 1.32]],
  },
  thrust: {
    end: 1.85,
    hits: [{ start: 0.84, end: 1.04, contact: 0.9 }],
    track: [[0, 0.72]],
    lunge: [[0.75, 0.95]],
  },
  leap: {
    end: 2.25,
    hits: [{ start: 1.14, end: 1.32, contact: 1.22 }],
    windupPeak: [0.36],
    track: [[0, 0.42]],
    leapOff: 0.42,
    slam: 1.24,
  },
  // Perilous sweep at the ankles: low, wide, right to left. The glyph shows at t = 0.
  sweep: {
    end: 1.95,
    hits: [{ start: 0.74, end: 0.92, contact: 0.8 }],
    track: [[0, 0.6]],
    lunge: [[0.6, 0.8]],
  },
  // Perilous grab: sword drawn back to the hip, free hand lunges.
  grab: {
    end: 2.3,
    hits: [{ start: 0.72, end: 0.92, contact: 0.8 }],
    track: [[0, 0.62]],
    lunge: [[0.55, 0.85]],
    cue: { clamp: 0.8 },
  },
  grabThrow: { cue: { slam: 0.72 }, end: 1.9 },
  // Five swipes (phase 2 and the answer to a deflected spam); the last hangs.
  flurry: {
    end: 2.9,
    hits: [
      { start: 0.34, end: 0.5, contact: 0.405 },
      { start: 0.64, end: 0.8, contact: 0.705 },
      { start: 0.94, end: 1.1, contact: 1.005 },
      { start: 1.24, end: 1.4, contact: 1.305 },
      { start: 1.8, end: 1.96, contact: 1.865 },
    ],
    windupPeak: [0.18, 1.62],
    track: [[0, 0.3], [0.5, 0.6], [0.8, 0.9], [1.1, 1.2], [1.4, 1.72]],
    lunge: [[0.28, 0.44], [0.6, 0.72], [0.9, 1.02], [1.2, 1.32], [1.72, 1.86]],
  },
  mikiried: { end: 1.6 },
  kicked: { end: 1.0 },
  rise: { end: 1.6 },
  deathblown: { end: 1.5 },
};

// ---------------------------------------------------------------------------- Mixamo (estimates)
// First guesses for typical Mixamo sword clips at 30 fps. TUNE with ?debug=anim once the files
// are in: scrub each clip, read the time where the blade starts / stops cutting, paste it here.

export const MIXAMO_PLAYER: EventTable = {
  attack1: { norm: true, hits: [{ start: 0.3, end: 0.5 }], chain: 0.5, end: 0.9 },
  attack2: { norm: true, hits: [{ start: 0.28, end: 0.48 }], chain: 0.5, end: 0.9 },
  attack3: { norm: true, hits: [{ start: 0.35, end: 0.55 }], chain: 0.7, end: 0.95 },
  finisher: { norm: true, plunge: 0.3, withdraw: 0.65, end: 1 },
  attack_charged: { norm: true, hits: [{ start: 0.42, end: 0.6 }], chain: 0.85, end: 0.95 },
  jump_attack: { norm: true, hits: [{ start: 0.3, end: 0.6 }], end: 1 },
  kick: { norm: true, cue: { hit: 0.3 }, end: 1 },
  drink: { norm: true, cue: { sip: 0.45 }, end: 1 },
  mikiri: { norm: true, cue: { stomp: 0.2 }, end: 1 },
  get_up: { norm: true, cue: { up: 0.8 }, end: 1 },
  thrown: { norm: true, cue: { slam: 0.4, up: 0.9 }, end: 1 },
  deathblow: { norm: true, plunge: 0.25, withdraw: 0.6, end: 1 },
  walk: { norm: true, footsteps: [0, 0.5] },
  walk_back: { norm: true, footsteps: [0, 0.5] },
  strafe_left: { norm: true, footsteps: [0, 0.5] },
  strafe_right: { norm: true, footsteps: [0, 0.5] },
  run: { norm: true, footsteps: [0, 0.5] },
};

export const MIXAMO_BOSS: EventTable = {
  attack1: { norm: true, hits: [{ start: 0.32, end: 0.5, contact: 0.4 }], windupPeak: [0.2], track: [[0, 0.28]], lunge: [[0.25, 0.42]], end: 0.8 },
  combo2: { norm: true, hits: [{ start: 0.3, end: 0.5, contact: 0.38 }], windupPeak: [0.18], track: [[0, 0.26]], lunge: [[0.22, 0.4]], end: 0.8 },
  combo3: { norm: true, hits: [{ start: 0.4, end: 0.58, contact: 0.47 }], windupPeak: [0.3], track: [[0, 0.36]], lunge: [[0.3, 0.48]] },
  overhead: { norm: true, hits: [{ start: 0.5, end: 0.62, contact: 0.55 }], windupPeak: [0.2, 0.42], track: [[0, 0.48]], lunge: [[0, 0.2], [0.48, 0.58]] },
  thrust: { norm: true, hits: [{ start: 0.45, end: 0.58, contact: 0.49 }], track: [[0, 0.38]], lunge: [[0.4, 0.52]] },
  leap: { norm: true, hits: [{ start: 0.5, end: 0.6, contact: 0.55 }], windupPeak: [0.12], track: [[0, 0.18]], leapOff: 0.18, slam: 0.56 },
  sweep: { norm: true, hits: [{ start: 0.4, end: 0.5, contact: 0.44 }], track: [[0, 0.32]], lunge: [[0.32, 0.44]] },
  grab: { norm: true, tuned: true, hits: [{ start: 0.32, end: 0.42, contact: 0.36 }], track: [[0, 0.28]], lunge: [[0.25, 0.38]], cue: { clamp: 0.36 } },
  grab_throw: { norm: true, cue: { slam: 0.4 }, end: 1 },
  stumble: { norm: true, end: 1 },
  get_up: { norm: true, end: 1 },
  walk: { norm: true, footsteps: [0, 0.5] },
};

/**
 * Boss attacks on a skinned body are sequences of clip segments. `hold` pauses the segment at
 * its first wind-up peak for that many seconds (the delayed third blow of comboDelay).
 */
export interface Segment {
  clip: string;
  /** Clip time range to play (normalized 0..1). */
  from?: number;
  to?: number;
  speed?: number;
  hold?: number;
}

export const MIXAMO_BOSS_PLANS: Record<string, Segment[]> = {
  combo: [{ clip: "attack1", to: 0.8 }, { clip: "combo2", to: 0.8 }, { clip: "combo3" }],
  comboDelay: [{ clip: "attack1", to: 0.8 }, { clip: "combo2", to: 0.8 }, { clip: "combo3", hold: 0.45 }],
  overhead: [{ clip: "overhead" }],
  thrust: [{ clip: "thrust" }],
  leap: [{ clip: "leap" }],
  // Finished: he stays on the knee through the plunge, then pitches forward (Falling Forward Death
  // from where it is already down on its knees).
  finished: [{ clip: "kneel_idle", to: 0.4 }, { clip: "death_forward", from: 0.45 }],
  // Grab And Slam: the reach is `grab`; the throw replays its second half.
  grabThrow: [{ clip: "grab_throw", from: 0.45 }],
  flurry: [
    { clip: "attack1", to: 0.7, speed: 1.2 },
    { clip: "combo2", to: 0.7, speed: 1.2 },
    { clip: "attack1", to: 0.7, speed: 1.2 },
    { clip: "combo2", to: 0.7, speed: 1.2 },
    { clip: "combo3", hold: 0.3 },
  ],
};
