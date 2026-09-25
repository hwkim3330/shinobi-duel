/**
 * The samurai general: ~2.1 m with horns, black-and-crimson lacquered lamellar armour, huge
 * shoulder plates (sode), a flared helmet neck guard with gold kuwagata horns, a red iron mask
 * with faint ember eyes, a tattered crimson cape, and a long katana.
 */
import * as THREE from "three";
import { canvasTexture } from "../world/materials";
import { rng } from "../core/math";
import { PROCEDURAL_BOSS } from "./animEvents";
import { Cloth } from "./Cloth";
import { Character } from "./Character";
import { Clip, pose, type Pose } from "./Pose";
import type { RigDims } from "./Rig";
import { std } from "./parts";
import { buildGeneral } from "./generalBuild";

export const GENERAL_DIMS: RigDims = {
  hipH: 0.92,
  hipW: 0.11,
  waist: 0.14,
  shoulderY: 0.36,
  shoulderW: 0.21,
  neckY: 0.46,
  upperArm: 0.3,
  foreArm: 0.34,
  thigh: 0.44,
  shin: 0.43,
  ankle: 0.09,
  tsuba: 0.075,
  blade: 1.06,
  capR: 0.34,
  scale: 1.2,
};

// ---------------------------------------------------------------------------- poses
// Hasso-no-kamae: two hands, hilt by the right cheek, blade raised and angled back.
const S = pose(null, {
  grip: [0.2, 1.36, 0.22],
  dir: [0.22, 1, -0.3],
  two: 1,
  lhand: [0, 1.2, 0.3],
  hipY: -0.07,
  hipYaw: 0.25,
  chestYaw: -0.12,
  chestPitch: 0.08,
  head: -0.06,
  footL: [-0.17, 0, 0.22],
  footR: [0.2, 0, -0.2],
  gait: 1,
});
const S2 = pose(S, { chestPitch: 0.11, hipY: -0.08, grip: [0.2, 1.34, 0.23] });
const GUARD = pose(S, { grip: [0.24, 1.26, 0.38], dir: [-0.95, 0.5, 0.2], two: 0.6, hipY: -0.1, chestYaw: 0.1 });

// Combo.
const C_W1 = pose(S, { grip: [0.36, 1.66, -0.05], dir: [0.4, 0.75, -0.55], chestYaw: -0.62, hipYaw: 0.05, chestPitch: -0.05 });
const C_S1 = pose(S, { grip: [0.0, 1.2, 0.62], dir: [-0.45, -0.18, 1], chestYaw: 0.12, lean: 0.16, chestPitch: 0.16, footL: [-0.17, 0, 0.42] });
const C_F1 = pose(C_S1, { grip: [-0.36, 0.9, 0.42], dir: [-0.85, -0.5, 0.2], chestYaw: 0.56, chestPitch: 0.3, hipY: -0.13 });
const C_W2 = pose(C_F1, { grip: [-0.36, 0.86, 0.26], dir: [-0.9, -0.42, -0.1], chestYaw: 0.62, chestPitch: 0.26 });
const C_S2 = pose(C_F1, { grip: [0.04, 1.26, 0.62], dir: [0.3, 0.32, 1], chestYaw: 0.02, chestPitch: 0.12, hipY: -0.09 });
const C_F2 = pose(C_S2, { grip: [0.36, 1.62, 0.2], dir: [0.6, 0.72, -0.2], chestYaw: -0.52, chestPitch: -0.04 });
const C_W3 = pose(S, { grip: [0.05, 1.82, -0.04], dir: [0, 0.5, -1], chestPitch: -0.22, chestYaw: 0, hipYaw: 0.05, footL: [-0.17, 0, 0.25] });
const C_S3 = pose(C_W3, { grip: [0, 1.15, 0.66], dir: [0, 0, 1], chestPitch: 0.32, lean: 0.2, footL: [-0.17, 0, 0.5], hipY: -0.12 });
const C_F3 = pose(C_S3, { grip: [0, 0.8, 0.52], dir: [0, -0.7, 0.8], chestPitch: 0.55, hipY: -0.22, head: -0.2 });

// Delayed overhead: rises high, trembles, crashes down.
const O_UP = pose(S, { grip: [0.05, 1.98, 0.08], dir: [0, 0.92, -0.38], chestPitch: -0.26, chestYaw: 0, hipYaw: 0.08, hipY: 0.0, head: 0.1, footL: [-0.17, 0, 0.3] });
const O_HOLD = pose(O_UP, { tremble: 1, grip: [0.05, 2.0, 0.04], chestPitch: -0.3 });
const O_SLAM = pose(O_UP, { grip: [0, 1.1, 0.72], dir: [0, -0.1, 1], chestPitch: 0.35, lean: 0.2, tremble: 0, footL: [-0.17, 0, 0.5], hipY: -0.12 });
const O_END = pose(O_SLAM, { grip: [0, 0.62, 0.72], dir: [0, -0.8, 0.6], chestPitch: 0.62, hipY: -0.28, head: -0.25 });

// Perilous thrust.
const T_BACK = pose(S, {
  grip: [0.3, 1.24, -0.26],
  dir: [0, 0.05, 1],
  chestYaw: -0.62,
  hipYaw: -0.1,
  hipY: -0.14,
  chestPitch: 0.05,
  footR: [0.2, 0, -0.42],
  footL: [-0.17, 0, 0.28],
});
const T_OUT = pose(T_BACK, { grip: [0.05, 1.24, 0.74], dir: [0, 0, 1], chestYaw: 0.26, hipYaw: 0.15, lean: 0.3, chestPitch: 0.25, footL: [-0.17, 0, 0.62], hipY: -0.2 });

// Leap.
const L_CROUCH = pose(S, { hipY: -0.32, chestPitch: 0.34, grip: [0.2, 1.4, -0.22], dir: [0.1, 0.6, -0.8], head: -0.3 });
const L_AIR = pose(S, { grip: [0.05, 1.92, 0.0], dir: [0, 0.6, -0.8], chestPitch: -0.2, footL: [-0.18, 0.34, 0.16], footR: [0.2, 0.22, -0.2], gait: 0, hipY: -0.02 });
const L_SLAM = pose(S, { grip: [0, 0.9, 0.76], dir: [0, -0.6, 0.8], hipY: -0.32, chestPitch: 0.6, head: -0.3, footL: [-0.2, 0, 0.3], footR: [0.22, 0, -0.3], gait: 0 });

const RECOIL = pose(S, {
  grip: [0.38, 1.55, -0.02],
  dir: [0.45, 0.88, -0.35],
  two: 0.3,
  lhand: [-0.35, 1.3, 0.1],
  chestPitch: -0.28,
  head: 0.25,
  hipY: -0.06,
  lean: -0.08,
  footR: [0.2, 0, -0.42],
});
const FLINCH = pose(S, { chestPitch: -0.2, head: 0.25, bodyRoll: -0.06, grip: [0.3, 1.25, 0.1], lean: -0.05 });
const KNEEL = pose(S, {
  hipY: -0.5,
  footR: [0.2, 0, -0.55],
  footL: [-0.17, 0, 0.26],
  chestPitch: 0.36,
  head: 0.42,
  grip: [0.3, 0.8, 0.34],
  dir: [0.05, -1, 0.12],
  two: 0,
  lhand: [-0.22, 0.58, 0.28],
  gait: 0,
});
const KNEEL2 = pose(KNEEL, { chestPitch: 0.4, head: 0.46, hipY: -0.51 });
const ARCH = pose(KNEEL, { chestPitch: -0.38, head: -0.5, hipY: -0.36, grip: [0.45, 1.0, 0.1], dir: [0.6, -0.5, 0.2], lhand: [-0.45, 1.05, 0.15], lean: -0.06 });
// Collapses onto his left side (never through the shinobi standing in front of him).
const FALLEN = pose(KNEEL, {
  bodyRoll: -1.38,
  bodyPitch: 0.3,
  rootY: 0.22,
  hipY: -0.42,
  chestPitch: 0.35,
  head: 0.35,
  grip: [0.45, 0.9, 0.45],
  dir: [0.7, -0.2, 0.7],
  lhand: [-0.3, 0.75, 0.35],
});
const BLOCKED = pose(GUARD, { grip: [0.24, 1.22, 0.28], chestPitch: -0.06, lean: -0.06 });

// Perilous sweep: drops low, blade out to his right, then scythes across the ankles to his left.
const SW_WIND = pose(S, { hipY: -0.36, chestYaw: -0.8, hipYaw: -0.2, chestPitch: 0.3, grip: [0.55, 0.62, -0.05], dir: [1, -0.25, -0.35], two: 0.6, head: -0.2, footL: [-0.24, 0, 0.3], footR: [0.26, 0, -0.26] });
const SW_CUT = pose(SW_WIND, { chestYaw: 0.1, hipYaw: 0.1, grip: [0.08, 0.5, 0.7], dir: [-0.15, -0.3, 1], lean: 0.12 });
const SW_END = pose(SW_WIND, { chestYaw: 0.85, hipYaw: 0.3, grip: [-0.55, 0.52, 0.25], dir: [-1, -0.25, 0.1], lean: 0.08 });
// Perilous grab: blade drawn back to the right hip, left hand thrown forward, open.
const G_WIND = pose(S, { grip: [0.36, 1.0, -0.3], dir: [0.1, 0.35, -1], two: 0, lhand: [-0.3, 1.35, 0.1], chestYaw: 0.5, hipY: -0.14, chestPitch: 0.1, footR: [0.2, 0, -0.34] });
const G_REACH = pose(G_WIND, { lhand: [-0.05, 1.3, 0.95], chestYaw: -0.25, lean: 0.28, chestPitch: 0.3, footL: [-0.17, 0, 0.6], hipY: -0.18 });
const G_MISS = pose(G_REACH, { lhand: [-0.1, 1.05, 0.75], chestPitch: 0.5, head: -0.3, hipY: -0.24 });
const G_LIFT = pose(G_REACH, { lhand: [-0.05, 1.85, 0.7], chestPitch: -0.1, lean: 0.1, hipY: -0.1 });
const G_SLAM = pose(G_REACH, { lhand: [-0.05, 0.55, 0.85], chestPitch: 0.62, hipY: -0.32, head: -0.35 });
// Pinned: blade stamped to the roof under the shinobi's foot, dragged forward and down.
const PINNED = pose(S, { grip: [0.05, 0.62, 0.7], dir: [0, -0.8, 0.6], two: 1, lhand: [0, 0.62, 0.6], chestPitch: 0.62, hipY: -0.3, head: -0.3, lean: 0.14, footL: [-0.17, 0, 0.45] });
const KICKED = pose(RECOIL, { chestPitch: -0.45, head: 0.5, hipY: -0.12, bodyRoll: 0.1, footR: [0.2, 0, -0.5] });
// Rising for the second life: from the knee, blade swept round and settled into stance.
const RISE_UP = pose(KNEEL, { hipY: -0.3, chestPitch: -0.2, head: -0.35, grip: [0.4, 1.3, 0.3], dir: [0.8, 0.5, 0.2], lhand: [-0.35, 1.2, 0.2], two: 0 });
const RISE_ROAR = pose(S, { chestPitch: -0.3, head: -0.4, grip: [0.45, 1.5, 0.1], dir: [0.9, 0.4, -0.1], two: 0, lhand: [-0.4, 1.35, 0.2], hipY: -0.12 });

const k = (t: number, p: Pose, stop = false) => ({ t, p, stop });

function capeTexture(): THREE.CanvasTexture {
  const R = rng(66);
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = "#4a1010";
    g.fillRect(0, 0, w, h);
    // Vertical folds.
    for (let x = 0; x < w; x++) {
      const f = Math.sin(x * 0.11) * 0.5 + Math.sin(x * 0.043 + 1.3) * 0.5;
      g.fillStyle = f > 0 ? `rgba(160,60,50,${f * 0.12})` : `rgba(0,0,0,${-f * 0.35})`;
      g.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? "0,0,0" : "120,40,30"},${0.05 + R() * 0.1})`;
      g.fillRect(R() * w, R() * h, 2 + R() * 40, 1 + R() * 3);
    }
    // Darkened, burnt lower part.
    const grd = g.createLinearGradient(0, h * 0.4, 0, h);
    grd.addColorStop(0, "rgba(10,4,4,0)");
    grd.addColorStop(1, "rgba(10,4,4,0.85)");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // Tattered hem + holes: alpha holes are cut with destination-out.
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h - 20 - R() * 150 * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.04))));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.ellipse(R() * w, h * 0.35 + R() * h * 0.5, 3 + R() * 12, 6 + R() * 22, R(), 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  });
}

export class General extends Character {
  readonly clips: Record<string, Clip>;
  protected readonly events = PROCEDURAL_BOSS;
  private readonly sode: THREE.Group[] = [];
  private readonly skirt: { g: THREE.Group; side: number; ang: number }[] = [];

  constructor() {
    const clips: Record<string, Clip> = {
      idle: new Clip("idle", [k(0, S), k(1.6, S2), k(3.2, S)], true),
      walk: new Clip("walk", [k(0, S), k(1, S)], true),
      guard: new Clip("guard", [k(0, GUARD), k(1.5, pose(GUARD, { hipY: -0.11 })), k(3, GUARD)], true),
      block: new Clip("block", [k(0, GUARD), k(0.05, BLOCKED), k(0.35, GUARD)]),
      combo: new Clip("combo", [
        k(0, S),
        k(0.45, C_W1, true),
        k(0.6, C_S1),
        k(0.7, C_F1),
        k(0.84, C_W2, true),
        k(0.965, C_S2),
        k(1.05, C_F2),
        k(1.21, C_W3, true),
        k(1.335, C_S3),
        k(1.42, C_F3),
        k(1.65, C_F3),
        k(2.2, S),
      ]),
      // Same string, but the last blow hangs at the top for a held beat before it drops.
      comboDelay: new Clip("comboDelay", [
        k(0, S),
        k(0.45, C_W1, true),
        k(0.6, C_S1),
        k(0.7, C_F1),
        k(0.84, C_W2, true),
        k(0.965, C_S2),
        k(1.05, C_F2),
        k(1.25, C_W3, true),
        k(1.7, pose(C_W3, { hipY: -0.06 }), true),
        k(1.815, C_S3),
        k(1.9, C_F3),
        k(2.15, C_F3),
        k(2.7, S),
      ]),
      overhead: new Clip("overhead", [k(0, S), k(0.45, O_UP, true), k(1.2, O_HOLD, true), k(1.29, O_SLAM), k(1.37, O_END), k(1.65, O_END), k(2.25, S)]),
      thrust: new Clip("thrust", [k(0, S), k(0.75, T_BACK, true), k(0.91, T_OUT), k(1.2, T_OUT), k(1.85, S)]),
      leap: new Clip("leap", [k(0, S), k(0.42, L_CROUCH, true), k(0.62, L_AIR), k(1.1, L_AIR), k(1.24, L_SLAM), k(1.6, L_SLAM), k(2.25, S)]),
      // Starts on the rebound itself: the crossfade carries the blade up and away from wherever
      // the guard stopped it.
      recoil: new Clip("recoil", [k(0, RECOIL), k(0.55, pose(RECOIL, { hipY: -0.1 })), k(0.95, S)]),
      flinch: new Clip("flinch", [k(0, S), k(0.07, FLINCH), k(0.4, S)]),
      stagger: new Clip("stagger", [k(0, RECOIL), k(0.35, KNEEL), k(1.6, KNEEL2), k(3.2, KNEEL)], false),
      staggerEnd: new Clip("staggerEnd", [k(0, KNEEL), k(0.6, S)]),
      finished: new Clip("finished", [k(0, KNEEL), k(0.18, ARCH), k(1.3, pose(ARCH, { chestPitch: -0.42 })), k(1.8, pose(KNEEL, { chestPitch: 0.7 })), k(2.6, FALLEN), k(5, FALLEN)]),
      dead: new Clip("dead", [k(0, FALLEN), k(1, FALLEN)], true),
      victory: new Clip("victory", [k(0, S), k(2, S2), k(4, S)], true),
      sweep: new Clip("sweep", [k(0, S), k(0.4, SW_WIND), k(0.7, pose(SW_WIND, { chestYaw: -0.86 }), true), k(0.8, SW_CUT), k(0.92, SW_END), k(1.3, SW_END), k(1.95, S)]),
      grab: new Clip("grab", [k(0, S), k(0.55, G_WIND, true), k(0.8, G_REACH), k(0.95, G_MISS), k(1.6, G_MISS), k(2.3, S)]),
      grabThrow: new Clip("grabThrow", [k(0, G_REACH), k(0.4, G_LIFT), k(0.62, pose(G_LIFT, { lhand: [-0.05, 1.95, 0.65] })), k(0.74, G_SLAM), k(1.2, G_SLAM), k(1.9, S)]),
      flurry: new Clip("flurry", [
        k(0, S),
        k(0.3, C_W1, true),
        k(0.42, C_S1),
        k(0.5, C_F1),
        k(0.62, C_W2, true),
        k(0.72, C_S2),
        k(0.8, C_F2),
        k(0.92, C_W1, true),
        k(1.02, C_S1),
        k(1.1, C_F1),
        k(1.22, C_W2, true),
        k(1.32, C_S2),
        k(1.4, C_F2),
        k(1.72, pose(C_W3, { tremble: 0.5 }), true),
        k(1.88, C_S3),
        k(1.96, C_F3),
        k(2.3, C_F3),
        k(2.9, S),
      ]),
      mikiried: new Clip("mikiried", [k(0, PINNED), k(0.65, pose(PINNED, { chestPitch: 0.66 })), k(1.05, pose(RECOIL, { hipY: -0.14 })), k(1.6, S)]),
      kicked: new Clip("kicked", [k(0, S), k(0.08, KICKED), k(0.55, pose(KICKED, { hipY: -0.16 })), k(1.0, S)]),
      evade: new Clip("evade", [k(0, S), k(0.12, pose(RECOIL, { hipY: -0.14 })), k(0.55, S)]),
      whiff: new Clip("whiff", [k(0, G_MISS), k(0.5, pose(G_MISS, { hipY: -0.2 })), k(0.9, S)]),
      rise: new Clip("rise", [k(0, KNEEL), k(0.5, RISE_UP), k(0.9, RISE_ROAR), k(1.2, pose(RISE_ROAR, { head: -0.2 })), k(1.6, S)]),
      deathblown: new Clip("deathblown", [k(0, KNEEL), k(0.16, ARCH), k(0.8, pose(ARCH, { chestPitch: -0.42 })), k(1.2, KNEEL2), k(1.5, KNEEL2)]),
    };
    super(GENERAL_DIMS, clips.idle, 0xff6a3a, 1.0);
    this.clips = clips;
    this.build();
  }

  private build(): void {
    const r = this.rig;
    const parts = buildGeneral(r, GENERAL_DIMS);
    this.sode.push(...parts.sode);
    this.skirt.push(...parts.skirt);

    // ---------------------------------------------------------------- cape (cloth)
    const capeTex = capeTexture();
    const capeMat = std({ map: capeTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: 0xffffff }, 1.4);
    const W = 9;
    const cape = new Cloth(W, 12, 0.1, 0.11, capeMat);
    cape.windScale = 1.1;
    cape.gravity = 8;
    cape.damping = 0.98;
    cape.hangDir.set(0, -1, -0.15).normalize();
    (cape.mesh.material as THREE.Material).shadowSide = THREE.DoubleSide;
    const pins: THREE.Object3D[] = [];
    for (let j = 0; j < W; j++) {
      const a = new THREE.Object3D();
      const u = j / (W - 1) - 0.5;
      a.position.set(u * 0.5, 0.36 - Math.abs(u) * 0.06, -0.19 - (0.25 - u * u) * 0.08);
      r.chest.add(a);
      pins.push(a);
    }
    this.cloths.push({ cloth: cape, pins });
    for (let i = 0; i < 6; i++) this.colliders.push({ c: new THREE.Vector3(), r: 0.1 });
    r.root.traverse((o) => {
      o.castShadow = true;
    });
  }

  part(name: string): THREE.Object3D | null {
    if (name === "sodeR") return this.sode[0];
    if (name === "sodeL") return this.sode[1];
    return super.part(name);
  }

  protected afterRig(): void {
    const r = this.rig;
    // Sode swing out as the arm lifts.
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? -1 : 1;
      const up = r.elbow[i].y - r.shoulder[i].y;
      const out = Math.max(0, up + 0.22) * 1.6;
      this.sode[i].rotation.set(0, 0, sd * Math.min(1.1, out));
    }
    // Skirt panels kick out with the thighs.
    for (const s of this.skirt) {
      const leg = s.side === 0 ? 0 : 1;
      const knee = r.kneeW[leg];
      const hip = r.hipsW;
      const dz = (knee.x - hip.x) * Math.sin(r.yaw) + (knee.z - hip.z) * Math.cos(r.yaw);
      const facing = Math.cos(s.ang);
      s.g.rotation.x = Math.max(-0.2, Math.min(0.9, dz * 1.4 * facing)) + 0.08;
    }
  }

  protected updateColliders(): void {
    const r = this.rig;
    const c = this.colliders;
    const sc = GENERAL_DIMS.scale;
    c[0].c.copy(r.chestW);
    c[0].r = 0.27 * sc;
    c[1].c.copy(r.hipsW);
    c[1].r = 0.27 * sc;
    c[2].c.copy(r.kneeW[0]);
    c[2].r = 0.17 * sc;
    c[3].c.copy(r.kneeW[1]);
    c[3].r = 0.17 * sc;
    c[4].c.copy(r.headW);
    c[4].r = 0.2 * sc;
    c[5].c.lerpVectors(r.hipsW, r.chestW, 0.5);
    c[5].r = 0.26 * sc;
  }
}