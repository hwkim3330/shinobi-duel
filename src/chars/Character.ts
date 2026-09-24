/**
 * A fighter's visual body: rig + animator + cloth pieces + sword trail. Gameplay classes drive
 * it by choosing clips and moving the root; `step` advances everything by one fixed step.
 *
 * On top of the clip the body can layer two short reactions: a guard that brings the blade
 * through the incoming weapon (block / deflect) and a rebound when its own swing is stopped.
 * Both are written into a separate pose buffer so the animator's crossfades never see them.
 */
import * as THREE from "three";
import { Trail } from "../fx/Trail";
import { Cloth, type Sphere } from "./Cloth";
import { resolveEvents, type EventTable, type Timeline } from "./animEvents";
import type { Fighter } from "./Fighter";
import { Animator, I, POSE_N, type Clip, type Pose } from "./Pose";
import { Rig, type RigDims } from "./Rig";

const _zero = new THREE.Vector3();

export interface ClothPiece {
  cloth: Cloth;
  pins: THREE.Object3D[];
}

/** Guard reaction: held while the blades are locked, then eased back into the clip. */
const GUARD_HOLD = 0.1;
const GUARD_OUT = 0.18;
/** Rebound envelope (game seconds). */
const BOUNCE_IN = 0.04;
const BOUNCE_HOLD = 0.1;
const BOUNCE_OUT = 0.32;
/** Pose channels the rebound takes over: sword arm, free hand, chest. */
const REBOUND_CH = [I.gx, I.gy, I.gz, I.lx, I.ly, I.lz, I.two, I.cPitch, I.cYaw, I.cRoll];
/** Most the rebound raises the blade (rad). */
const REBOUND_LIFT = 1.2;
/** After a hold the clip plays at up to this extra rate until it is back in sync. */
const CATCH_UP = 1;

export abstract class Character implements Fighter {
  readonly kind = "procedural" as const;
  readonly rig: Rig;
  readonly anim: Animator;
  readonly cloths: ClothPiece[] = [];
  readonly colliders: Sphere[] = [];
  readonly trail: Trail;
  abstract readonly clips: Record<string, Clip>;
  protected abstract readonly events: EventTable;
  private readonly tmp = new THREE.Vector3();
  private readonly simPos = new THREE.Vector3();
  /** What the rig is posed from: the clip output plus the reaction layers. */
  private readonly pose: Pose = new Float32Array(POSE_N);
  /** Clip output of this step and the previous one (frozen while held). */
  private readonly base: Pose = new Float32Array(POSE_N);
  private readonly prevBase: Pose = new Float32Array(POSE_N);
  private readonly rebound: Pose = new Float32Array(POSE_N);
  /** This step's clip output before any snap (so `snapBack` can be called repeatedly). */
  private readonly stepBase: Pose = new Float32Array(POSE_N);
  private hold = false;
  private held = 0;
  private guardT = -1;
  private bounceT = -1;
  private bounceHold = BOUNCE_HOLD;
  private avoid = false;
  private avoidW = 0;

  constructor(dims: RigDims, first: Clip, trailColor: THREE.ColorRepresentation, trailIntensity: number) {
    this.rig = new Rig(dims);
    this.anim = new Animator(first);
    this.trail = new Trail(trailColor, trailIntensity);
    this.pose.set(this.anim.out);
    this.base.set(this.anim.out);
    this.prevBase.set(this.anim.out);
    this.stepBase.set(this.anim.out);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.rig.root);
    for (const c of this.cloths) scene.add(c.cloth.mesh);
    scene.add(this.trail.mesh);
  }

  setVisible(on: boolean): void {
    this.rig.root.visible = on;
    for (const c of this.cloths) c.cloth.mesh.visible = on;
    this.trail.mesh.visible = on && this.trail.mesh.visible;
  }

  play(name: string, fade = 0.12, t0 = 0): void {
    // A held body starts the new clip when the hold ends.
    this.held = 0;
    // Fade from what is on screen (a contact snap / hold may differ from the clip output).
    this.anim.out.set(this.base);
    this.anim.play(this.clips[name], fade, t0);
  }

  get clipName(): string {
    return this.anim.clip.name;
  }

  timeline(name: string): Timeline {
    return resolveEvents(this.events[name], this.clips[name]?.dur ?? 0);
  }

  setHold(on: boolean): void {
    this.hold = on;
  }

  /**
   * The clip is frozen (time banked in `held`) while held and while a rebound builds; an
   * extended rebound hold lets the clip run on hidden underneath.
   */
  private get frozen(): boolean {
    return this.hold || (this.bounceT >= 0 && this.bounceT < BOUNCE_HOLD);
  }

  snapBack(s: number): void {
    for (let j = 0; j < POSE_N; j++) this.base[j] = this.prevBase[j] + (this.stepBase[j] - this.prevBase[j]) * s;
    this.compose();
    this.rig.update(0, this.pose);
    this.rig.prevHiltW.copy(this.rig.hiltW);
    this.rig.prevTipW.copy(this.rig.tipW);
    this.afterRig(0);
    this.updateColliders();
  }

  guardAt(target: THREE.Vector3 | null): void {
    if (!target) {
      this.guardT = -1;
      this.rig.guardW = 0;
      return;
    }
    this.rig.guardTarget.copy(target);
    this.guardT = 0;
    this.rig.guardW = 1;
  }

  setAvoid(on: boolean): void {
    this.avoid = on;
  }

  bounce(hold = 0): void {
    this.bounceT = 0;
    this.bounceHold = BOUNCE_HOLD + hold;
    // Grip thrown up and back toward the shoulder, chest rocked back (the blade lift is in compose).
    const r = this.rebound;
    r.set(this.base);
    r[I.gy] += 0.2;
    r[I.gz] -= 0.3;
    r[I.cPitch] -= 0.12;
  }

  listClips(): { name: string; dur: number; loop: boolean }[] {
    return Object.values(this.clips).map((c) => ({ name: c.name, dur: c.dur, loop: c.loop }));
  }

  scrub(clip: string, t: number): void {
    this.resetCloth();
    this.anim.play(this.clips[clip], 0, t);
    this.anim.speed = 0;
    this.step(0, _zero, 0);
    this.anim.speed = 1;
  }

  /** Named groups a skinned body can reuse (helmet, sode, ...), sword included. */
  part(name: string): THREE.Object3D | null {
    if (name === "sword") return this.rig.sword;
    if (name === "head") return this.rig.head;
    return null;
  }

  /** Hook for per-step attachment updates (sode, skirt panels, ...). */
  protected afterRig(_dt: number): void {}
  /** Update collider sphere centres from the rig. */
  protected abstract updateColliders(): void;

  private layer(dt: number, frozen: boolean): void {
    if (!frozen) {
      this.prevBase.set(this.base);
      this.base.set(this.anim.out);
      this.stepBase.set(this.base);
    }
    if (this.guardT >= 0) {
      this.guardT += dt;
      const t = this.guardT;
      this.rig.guardW = t < GUARD_HOLD ? 1 : Math.max(0, 1 - (t - GUARD_HOLD) / GUARD_OUT);
      if (this.rig.guardW <= 0) this.guardT = -1;
    }
    if (this.bounceT >= 0 && !this.hold) {
      this.bounceT += dt;
      if (this.bounceT >= this.bounceHold + BOUNCE_OUT - BOUNCE_HOLD) this.bounceT = -1;
    }
    this.avoidW += ((this.avoid ? 1 : 0) - this.avoidW) * (1 - Math.exp(-dt * (this.avoid ? 25 : 12)));
    this.compose();
  }

  private compose(): void {
    const p = this.pose;
    p.set(this.base);
    let w = 0;
    if (this.bounceT >= 0) {
      const t = this.bounceT;
      const hold = this.bounceHold;
      w = t < BOUNCE_IN ? t / BOUNCE_IN : t < hold ? 1 : Math.max(0, 1 - (t - hold) / (BOUNCE_OUT - BOUNCE_HOLD));
      w = w * w * (3 - 2 * w) * 0.9;
      // Anchored to the pose at contact, so the clip catching up underneath stays hidden.
      const r = this.rebound;
      for (const j of REBOUND_CH) p[j] += (r[j] - p[j]) * w;
    }
    if (this.avoidW > 1e-3) {
      const a = this.avoidW;
      p[I.gy] += 0.2 * a * (1 - w);
      p[I.gz] -= 0.3 * a * (1 - w);
      w = Math.max(w, a);
    }
    if (w > 0) {
      // Blade: lift the clip's own direction toward vertical. A blend toward a fixed rebound
      // direction goes unstable (the arc flips) when the clip swings to the opposite side.
      const b = this.base;
      const h = Math.hypot(b[I.dx], b[I.dz]);
      if (h > 1e-4) {
        // Raise the elevation within the blade's own vertical plane (never past upright).
        const el = Math.atan2(b[I.dy], h);
        const e = el + Math.min(Math.PI / 2 - el, REBOUND_LIFT) * w;
        p[I.dx] = (b[I.dx] / h) * Math.cos(e);
        p[I.dz] = (b[I.dz] / h) * Math.cos(e);
        p[I.dy] = Math.sin(e);
      } else {
        p[I.dx] = b[I.dx];
        p[I.dy] = b[I.dy];
        p[I.dz] = b[I.dz];
      }
    }
  }

  step(dt: number, wind: THREE.Vector3, t: number): void {
    const frozen = this.frozen;
    if (frozen) this.held += dt;
    else {
      // Catch up with the gameplay clock after a hold / rebound (fast-forward, never a jump).
      const extra = Math.min(this.held, dt * CATCH_UP);
      this.held -= extra;
      this.anim.update(dt + extra);
    }
    this.layer(dt, frozen);
    this.rig.update(dt, this.pose);
    this.afterRig(dt);
    this.updateColliders();
    if (dt <= 0) return;
    for (const c of this.cloths) {
      for (let i = 0; i < c.pins.length; i++) c.cloth.pin(i, c.pins[i].getWorldPosition(this.tmp));
      c.cloth.step(dt, wind, t, this.colliders);
    }
  }

  /** Per render frame: rebuild cloth meshes and advance the trail (game time, so hitstop freezes it). */
  frame(dt: number): void {
    for (const c of this.cloths) c.cloth.updateMesh();
    this.trail.update(dt, this.rig.hiltW, this.rig.tipW);
  }

  /**
   * Render-only offset for fixed-step interpolation: body, world-space cloth and trail all shift
   * together. `endRender` restores the simulated transform so collision never sees the offset.
   */
  beginRender(d: THREE.Vector3): void {
    this.simPos.copy(this.rig.root.position);
    this.rig.root.position.add(d);
    for (const c of this.cloths) c.cloth.mesh.position.copy(d);
    this.trail.mesh.position.copy(d);
  }

  endRender(): void {
    this.rig.root.position.copy(this.simPos);
    this.rig.root.updateMatrixWorld(true);
  }

  resetCloth(): void {
    for (const c of this.cloths) c.cloth.reset();
    this.trail.clear();
    this.rig.resetTrail();
    this.guardAt(null);
    this.bounceT = -1;
    this.avoid = false;
    this.avoidW = 0;
    this.hold = false;
    this.held = 0;
  }
}
