/**
 * Procedural skeleton driven by pose arrays.
 *
 *   root (world position + yaw, uniform scale)
 *     body (rootY, bodyPitch, bodyRoll; pivot between the feet)
 *       hips (hip height + walk bob + lean, hipYaw)
 *         chest (YXZ: pitch forward, yaw, roll) → head, cloth anchors
 *       limb slots (upper/fore arm, hands, thigh/shin, feet, sword)
 *
 * Limb slots are children of `body` and are re-placed every step with analytic two-bone IK, so
 * the hands always reach the sword grip and the feet stay planted. Every slot's local +Y runs
 * along its bone; character files hang their meshes inside the slots.
 */
import * as THREE from "three";
import { clamp, damp } from "../core/math";
import { I, type Pose } from "./Pose";

export interface RigDims {
  hipH: number;
  hipW: number;
  waist: number;
  shoulderY: number;
  shoulderW: number;
  neckY: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  ankle: number;
  /** Sword: tsuba offset from the grip and blade length (pre-scale). */
  tsuba: number;
  blade: number;
  capR: number;
  scale: number;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _gx = new THREE.Vector3();
const _gs = new THREE.Vector3();
const _gg = new THREE.Vector3();
const _gd = new THREE.Vector3();
const _gv = new THREE.Vector3();
const _gm = new THREE.Matrix4();

/** Orient an object so local +Y points from `from` to `to`, twist resolved with `pole`. */
function place(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, pole: THREE.Vector3): void {
  _y.subVectors(to, from);
  const l = _y.length();
  if (l < 1e-6) _y.set(0, 1, 0);
  else _y.multiplyScalar(1 / l);
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  if (_z.lengthSq() < 1e-8) _z.set(1, 0, 0);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from);
}

/** Two-bone IK: writes the joint position and the reached end position. */
function ik(
  s: THREE.Vector3,
  t: THREE.Vector3,
  a: number,
  b: number,
  pole: THREE.Vector3,
  joint: THREE.Vector3,
  end: THREE.Vector3,
): void {
  _a.subVectors(t, s);
  let d = _a.length();
  if (d < 1e-5) {
    _a.set(0, -1, 0);
    d = 1e-5;
  } else _a.multiplyScalar(1 / d);
  d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(1, 0, 0).addScaledVector(_a, -_a.x);
  _b.normalize();
  joint.copy(s).addScaledVector(_a, a * cosA).addScaledVector(_b, a * sinA);
  end.copy(s).addScaledVector(_a, d);
}

export class Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly chest = new THREE.Group();
  readonly head = new THREE.Group();
  /** [right, left] */
  readonly uArm = [new THREE.Group(), new THREE.Group()];
  readonly fArm = [new THREE.Group(), new THREE.Group()];
  readonly hand = [new THREE.Group(), new THREE.Group()];
  readonly thigh = [new THREE.Group(), new THREE.Group()];
  readonly shin = [new THREE.Group(), new THREE.Group()];
  readonly foot = [new THREE.Group(), new THREE.Group()];
  readonly sword = new THREE.Group();

  /** World-space sword points, refreshed every update. */
  readonly hiltW = new THREE.Vector3();
  readonly tipW = new THREE.Vector3();
  readonly prevHiltW = new THREE.Vector3();
  readonly prevTipW = new THREE.Vector3();
  readonly chestW = new THREE.Vector3();
  readonly headW = new THREE.Vector3();
  readonly hipsW = new THREE.Vector3();
  readonly kneeW = [new THREE.Vector3(), new THREE.Vector3()];
  /** Body-space positions (for character-specific attachments). */
  readonly elbow = [new THREE.Vector3(), new THREE.Vector3()];
  readonly shoulder = [new THREE.Vector3(), new THREE.Vector3()];
  readonly gripB = new THREE.Vector3();
  readonly dirB = new THREE.Vector3(0, 1, 0);

  yaw = 0;
  /** Guard reaction: blend weight and the world point the blade must pass through. */
  guardW = 0;
  readonly guardTarget = new THREE.Vector3();
  /** World velocity (m/s) that drives the procedural gait. */
  readonly vel = new THREE.Vector3();
  onStep: ((foot: number, speed: number) => void) | null = null;
  swordSpeed = 0;

  private phase = 0;
  private amp = 0;
  private readonly gaitDir = new THREE.Vector3(0, 0, 1);
  private readonly edge = new THREE.Vector3(0, -1, 0);
  private readonly prevTipB = new THREE.Vector3();
  private readonly footPrev = [0, 0];
  private t = 0;
  private first = true;
  private readonly reached = new THREE.Vector3();
  private readonly endL = new THREE.Vector3();
  private readonly tmpPole = new THREE.Vector3();
  private readonly tmpHip = new THREE.Vector3();

  constructor(readonly d: RigDims) {
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.add(this.chest);
    this.chest.position.y = d.waist;
    this.chest.rotation.order = "YXZ";
    this.chest.add(this.head);
    this.head.position.y = d.neckY;
    for (let i = 0; i < 2; i++) {
      this.body.add(this.uArm[i], this.fArm[i], this.hand[i], this.thigh[i], this.shin[i], this.foot[i]);
    }
    this.body.add(this.sword);
    this.root.scale.setScalar(d.scale);
    this.root.traverse((o) => (o.castShadow = true));
  }

  /** Right side is -x in body space. */
  static side(i: number): number {
    return i === 0 ? -1 : 1;
  }

  update(dt: number, p: Pose): void {
    const d = this.d;
    this.t += dt;
    this.root.rotation.y = this.yaw;

    // ------------------------------------------------------------------ gait
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const lvx = (this.vel.x * cy - this.vel.z * sy) / d.scale;
    const lvz = (this.vel.x * sy + this.vel.z * cy) / d.scale;
    const speed = Math.hypot(lvx, lvz);
    if (speed > 0.15) this.gaitDir.set(lvx / speed, 0, lvz / speed);
    const gw = p[I.gait];
    this.amp += ((speed > 0.25 ? 1 : 0) - this.amp) * damp(9, dt);
    const stride = Math.min(0.14 + speed * 0.075, 0.6);
    this.phase += (dt * Math.max(speed, 0.6 * this.amp)) / (4 * stride);
    const bob = (Math.cos(this.phase * Math.PI * 4) - 1) * 0.016 * this.amp * gw * Math.min(1, speed / 2);

    // ------------------------------------------------------------------ trunk
    this.body.position.set(0, p[I.rootY], 0);
    this.body.rotation.set(p[I.bPitch], 0, p[I.bRoll]);
    const trem = p[I.tremble];
    const tx = trem ? (Math.sin(this.t * 71) + Math.sin(this.t * 43)) * 0.006 * trem : 0;
    this.hips.position.set(0, d.hipH + p[I.hipY] + bob, p[I.lean]);
    this.hips.rotation.set(0, p[I.hipYaw], 0);
    this.chest.rotation.set(p[I.cPitch] + tx, p[I.cYaw] - p[I.hipYaw], p[I.cRoll]);
    this.head.rotation.set(p[I.head], 0, 0);
    this.root.updateMatrixWorld(true);

    // Chest frame relative to body.
    this.hips.updateMatrix();
    this.chest.updateMatrix();
    _m2.multiplyMatrices(this.hips.matrix, this.chest.matrix);

    // ------------------------------------------------------------------ arms
    const grip = this.gripB.set(p[I.gx] + tx, p[I.gy] + tx * 0.7, p[I.gz]);
    const dir = this.dirB.set(p[I.dx], p[I.dy], p[I.dz]).normalize();
    if (this.guardW > 0) this.guardPose(grip, dir);
    const two = p[I.two];
    const lt = _c.set(p[I.lx], p[I.ly], p[I.lz]);
    const lGrip = _v.copy(grip).addScaledVector(dir, -0.12);
    lt.lerp(lGrip, two);
    const reached = this.reached;
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      const sh = this.shoulder[i].set(sd * d.shoulderW, d.shoulderY, 0).applyMatrix4(_m2);
      const target = i === 0 ? grip : lt;
      const pole = this.tmpPole.set(sd * 0.75, -0.55, -0.3 + (i === 1 ? 0.1 : 0));
      const el = this.elbow[i];
      const end = i === 0 ? reached : this.endL;
      ik(sh, target, d.upperArm, d.foreArm, pole, el, end);
      place(this.uArm[i], sh, el, _v.set(sd, 0, 0.3));
      place(this.fArm[i], el, end, _v.set(sd, 0, 0.3));
      if (i === 0) {
        this.orientSword(dt, end, dir);
        this.hand[0].position.copy(end);
        this.hand[0].quaternion.copy(this.sword.quaternion);
      } else {
        this.hand[1].position.copy(end);
        if (two > 0.5) this.hand[1].quaternion.copy(this.sword.quaternion);
        else this.hand[1].quaternion.copy(this.fArm[1].quaternion);
      }
    }

    // ------------------------------------------------------------------ legs
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      const hp = this.tmpHip.set(sd * d.hipW, 0, 0).applyMatrix4(this.hips.matrix);
      const fi = i === 0 ? I.frx : I.flx;
      const ft = _c.set(p[fi], p[fi + 1] + d.ankle, p[fi + 2]);
      // Procedural stepping.
      const ph = (this.phase + (i === 0 ? 0.5 : 0)) % 1;
      let off: number;
      let lift = 0;
      if (ph < 0.5) off = stride * (1 - ph * 4);
      else {
        const u = (ph - 0.5) * 2;
        const e = u * u * (3 - 2 * u);
        off = stride * (-1 + e * 2);
        lift = Math.sin(u * Math.PI) * Math.min(0.14, 0.05 + speed * 0.02);
      }
      const k = this.amp * gw;
      ft.addScaledVector(this.gaitDir, off * k);
      ft.y += lift * k;
      if (this.footPrev[i] > 0.5 && ph < 0.5 && k > 0.3 && speed > 0.3) this.onStep?.(i, speed * d.scale);
      this.footPrev[i] = ph;
      const knee = _v;
      const reach = this.endL;
      ik(hp, ft, d.thigh, d.shin, this.tmpPole.set(sd * 0.12, 0, 1), knee, reach);
      place(this.thigh[i], hp, knee, _b.set(0, 0, 1));
      place(this.shin[i], knee, reach, _b.set(0, 0, 1));
      this.foot[i].position.copy(reach);
      this.foot[i].rotation.set(lift * k * -2.5, 0, 0);
      this.kneeW[i].copy(knee).applyMatrix4(this.body.matrixWorld);
    }

    // ------------------------------------------------------------------ world anchors
    this.prevHiltW.copy(this.hiltW);
    this.prevTipW.copy(this.tipW);
    this.hiltW.copy(reached).addScaledVector(dir, d.tsuba).applyMatrix4(this.body.matrixWorld);
    this.tipW.copy(reached).addScaledVector(dir, d.tsuba + d.blade).applyMatrix4(this.body.matrixWorld);
    if (this.first) {
      this.prevHiltW.copy(this.hiltW);
      this.prevTipW.copy(this.tipW);
      this.first = false;
    }
    this.swordSpeed = dt > 0 ? this.tipW.distanceTo(this.prevTipW) / dt : 0;
    this.chest.getWorldPosition(this.chestW);
    _v.set(0, d.shoulderY * 0.55, 0.08);
    this.chestW.copy(_v.applyMatrix4(this.chest.matrixWorld));
    this.head.getWorldPosition(this.headW);
    this.hips.getWorldPosition(this.hipsW);
  }

  /**
   * Blend grip + blade direction so the blade passes through `guardTarget` (world). The least
   * motion that does it: slide the blade sideways onto the point, keeping its angle and crossing
   * it on the strong half; only if that grip is out of the right arm's reach does the blade
   * turn toward the point instead.
   */
  private guardPose(grip: THREE.Vector3, dir: THREE.Vector3): void {
    const d = this.d;
    const x = _gx.copy(this.guardTarget).applyMatrix4(_gm.copy(this.body.matrixWorld).invert());
    const sh = _gs.set(-d.shoulderW, d.shoulderY, 0).applyMatrix4(_m2);
    const reach = (d.upperArm + d.foreArm) * 0.96;
    const near = d.tsuba + 0.2;
    const far = d.tsuba + d.blade * 0.7;
    const n = _gd.copy(dir);
    const along = clamp(_gv.subVectors(x, grip).dot(n), near, far);
    const g = _gg.copy(x).addScaledVector(n, -along);
    for (let k = 0; k < 3 && _gv.subVectors(g, sh).length() > reach; k++) {
      g.copy(sh).addScaledVector(_gv.normalize(), reach);
      n.subVectors(x, g);
      const l = n.length() || 1e-6;
      n.multiplyScalar(1 / l);
      g.copy(x).addScaledVector(n, -clamp(l, near, far));
    }
    const w = this.guardW;
    grip.lerp(g, w);
    // Turn (not lerp) the blade toward the guard direction.
    const th = Math.acos(clamp(dir.dot(n), -1, 1));
    if (th > 1e-3) {
      const axis = _gv.crossVectors(dir, n);
      if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
      dir.applyAxisAngle(axis.normalize(), th * w);
    }
  }

  private orientSword(dt: number, grip: THREE.Vector3, dir: THREE.Vector3): void {
    const tip = _x.copy(grip).addScaledVector(dir, this.d.tsuba + this.d.blade);
    const v = _y.subVectors(tip, this.prevTipB);
    this.prevTipB.copy(tip);
    const sp = dt > 0 ? v.length() / dt : 0;
    let target: THREE.Vector3;
    if (sp > 2.2 && dt > 0) {
      target = v.addScaledVector(dir, -v.dot(dir)).normalize();
    } else {
      target = _z.set(0, -1, 0.35);
    }
    const k = sp > 2.2 ? damp(28, dt) : damp(6, dt);
    this.edge.lerp(target, k);
    this.edge.addScaledVector(dir, -this.edge.dot(dir));
    if (this.edge.lengthSq() < 1e-6) this.edge.set(0, 0, 1).addScaledVector(dir, -dir.z);
    this.edge.normalize();
    const zx = _a.crossVectors(dir, this.edge);
    _m.makeBasis(zx, dir, this.edge);
    this.sword.quaternion.setFromRotationMatrix(_m);
    this.sword.position.copy(grip);
  }

  /** Collision capsule (world): segment + radius. */
  capsule(a: THREE.Vector3, b: THREE.Vector3): number {
    a.copy(this.hipsW);
    a.y = Math.max(this.root.position.y + 0.3 * this.d.scale, a.y - 0.45 * this.d.scale);
    b.copy(this.headW);
    return this.d.capR * this.d.scale;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  resetTrail(): void {
    this.first = true;
  }
}
