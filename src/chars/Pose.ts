/**
 * Poses are flat float arrays in the character's body space (+z forward, +y up, right hand on
 * -x). Authoring uses (right, up, forward) triples so numbers read naturally.
 *
 * A pose describes intent, not joint angles: where the sword grip is, which way the blade
 * points, where the free hand goes, how the torso twists/bends and where the feet stand. The
 * rig turns that into limbs with two-bone IK, so every swing arc stays physically connected.
 */

export const I = {
  gx: 0, gy: 1, gz: 2, // right-hand grip
  dx: 3, dy: 4, dz: 5, // blade direction
  lx: 6, ly: 7, lz: 8, // left-hand target
  two: 9, // 0..1 left hand on the handle
  hipY: 10,
  hipYaw: 11,
  cYaw: 12,
  cPitch: 13,
  cRoll: 14,
  head: 15,
  lean: 16, // hips forward shift (m)
  flx: 17, fly: 18, flz: 19,
  frx: 20, fry: 21, frz: 22,
  rootY: 23,
  gait: 24, // how much the procedural walk cycle may move the feet
  bPitch: 25,
  bRoll: 26,
  tremble: 27,
} as const;
export const POSE_N = 28;
export type Pose = Float32Array;
type V = [number, number, number];

export interface PoseSpec {
  grip?: V;
  dir?: V;
  lhand?: V;
  two?: number;
  hipY?: number;
  hipYaw?: number;
  chestYaw?: number;
  chestPitch?: number;
  chestRoll?: number;
  head?: number;
  lean?: number;
  footL?: V;
  footR?: V;
  rootY?: number;
  gait?: number;
  bodyPitch?: number;
  bodyRoll?: number;
  tremble?: number;
}

const setRUF = (p: Pose, i: number, v: V) => {
  p[i] = -v[0];
  p[i + 1] = v[1];
  p[i + 2] = v[2];
};

export function pose(base: Pose | null, s: PoseSpec): Pose {
  const p = base ? new Float32Array(base) : new Float32Array(POSE_N);
  if (!base) {
    p[I.gait] = 1;
  }
  if (s.grip) setRUF(p, I.gx, s.grip);
  if (s.dir) {
    const l = Math.hypot(...s.dir) || 1;
    setRUF(p, I.dx, [s.dir[0] / l, s.dir[1] / l, s.dir[2] / l]);
  }
  if (s.lhand) setRUF(p, I.lx, s.lhand);
  if (s.footL) setRUF(p, I.flx, s.footL);
  if (s.footR) setRUF(p, I.frx, s.footR);
  if (s.two !== undefined) p[I.two] = s.two;
  if (s.hipY !== undefined) p[I.hipY] = s.hipY;
  if (s.hipYaw !== undefined) p[I.hipYaw] = s.hipYaw;
  if (s.chestYaw !== undefined) p[I.cYaw] = s.chestYaw;
  if (s.chestPitch !== undefined) p[I.cPitch] = s.chestPitch;
  if (s.chestRoll !== undefined) p[I.cRoll] = s.chestRoll;
  if (s.head !== undefined) p[I.head] = s.head;
  if (s.lean !== undefined) p[I.lean] = s.lean;
  if (s.rootY !== undefined) p[I.rootY] = s.rootY;
  if (s.gait !== undefined) p[I.gait] = s.gait;
  if (s.bodyPitch !== undefined) p[I.bPitch] = s.bodyPitch;
  if (s.bodyRoll !== undefined) p[I.bRoll] = s.bodyRoll;
  if (s.tremble !== undefined) p[I.tremble] = s.tremble;
  return p;
}

/**
 * Spherical blend of the blade direction (pose channels dx..dz) from `a` to `b`, written into
 * `out`. A plain lerp of near-opposite directions passes through ~0 and flips the blade in one
 * step (a down-forward follow-through into an up-back recoil); this turns it through the arc.
 */
export function slerpDir(out: Pose, a: Pose, b: Pose, w: number): void {
  const ax = a[I.dx], ay = a[I.dy], az = a[I.dz];
  const bx = b[I.dx], by = b[I.dy], bz = b[I.dz];
  const la = Math.hypot(ax, ay, az) || 1;
  const lb = Math.hypot(bx, by, bz) || 1;
  const dot = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)));
  const th = Math.acos(dot);
  if (th < 1e-3) {
    out[I.dx] = ax + (bx - ax) * w;
    out[I.dy] = ay + (by - ay) * w;
    out[I.dz] = az + (bz - az) * w;
    return;
  }
  let px = bx / lb - (ax / la) * dot;
  let py = by / lb - (ay / la) * dot;
  let pz = bz / lb - (az / la) * dot;
  let lp = Math.hypot(px, py, pz);
  if (lp < 1e-4) {
    // Exactly opposite: turn through the vertical plane containing `a` (blade swings up/over).
    px = -ax * ay;
    py = ax * ax + az * az;
    pz = -az * ay;
    lp = Math.hypot(px, py, pz) || 1;
  }
  const c = Math.cos(th * w);
  const s = Math.sin(th * w);
  out[I.dx] = (ax / la) * c + (px / lp) * s;
  out[I.dy] = (ay / la) * c + (py / lp) * s;
  out[I.dz] = (az / la) * c + (pz / lp) * s;
}

export interface Key {
  t: number;
  p: Pose;
  /** Zero velocity at this key: wind-up peaks and holds. */
  stop?: boolean;
}

export class Clip {
  readonly dur: number;
  constructor(
    readonly name: string,
    readonly keys: Key[],
    readonly loop = false,
  ) {
    this.dur = keys[keys.length - 1].t;
  }

  sample(t: number, out: Pose): void {
    const k = this.keys;
    if (k.length === 1) {
      out.set(k[0].p);
      return;
    }
    if (this.loop) t = ((t % this.dur) + this.dur) % this.dur;
    if (t <= k[0].t) {
      out.set(k[0].p);
      return;
    }
    if (t >= this.dur) {
      out.set(k[k.length - 1].p);
      return;
    }
    let i = 0;
    while (i < k.length - 2 && t >= k[i + 1].t) i++;
    const k1 = k[i];
    const k2 = k[i + 1];
    const k0 = i > 0 ? k[i - 1] : this.loop ? k[k.length - 2] : k1;
    const k3 = i + 2 < k.length ? k[i + 2] : this.loop ? k[1] : k2;
    const h = k2.t - k1.t;
    const u = (t - k1.t) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const d1 = k1.stop ? 0 : k2.t - k0.t || 1;
    const d2 = k2.stop ? 0 : k3.t - k1.t || 1;
    const tens = 0.85;
    for (let j = 0; j < POSE_N; j++) {
      const p1 = k1.p[j];
      const p2 = k2.p[j];
      const m1 = d1 ? ((p2 - k0.p[j]) / d1) * h * tens : 0;
      const m2 = d2 ? ((k3.p[j] - p1) / d2) * h * tens : 0;
      out[j] = h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
    }
  }
}

/** Plays clips with crossfades (the skinning-blending pattern, applied to pose arrays). */
export class Animator {
  clip: Clip;
  time = 0;
  speed = 1;
  readonly out: Pose = new Float32Array(POSE_N);
  private readonly from: Pose = new Float32Array(POSE_N);
  private readonly cur: Pose = new Float32Array(POSE_N);
  private fade = 0;
  private fadeT = 0;

  constructor(clip: Clip) {
    this.clip = clip;
    clip.sample(0, this.out);
  }

  play(clip: Clip, fade = 0.12, t0 = 0): void {
    this.from.set(this.out);
    this.clip = clip;
    this.time = t0;
    this.fade = fade;
    this.fadeT = 0;
  }

  update(dt: number): void {
    this.time += dt * this.speed;
    if (!this.clip.loop && this.time > this.clip.dur) this.time = this.clip.dur;
    this.clip.sample(this.time, this.cur);
    if (this.fadeT < this.fade) {
      this.fadeT += dt;
      let w = Math.min(1, this.fadeT / this.fade);
      w = w * w * (3 - 2 * w);
      for (let j = 0; j < POSE_N; j++) this.out[j] = this.from[j] + (this.cur[j] - this.from[j]) * w;
      slerpDir(this.out, this.from, this.cur, w);
    } else {
      this.out.set(this.cur);
    }
  }

  get done(): boolean {
    return !this.clip.loop && this.time >= this.clip.dur;
  }
}
