/**
 * The shinobi's body, sculpted: worn rust-brown tunic over a dark undershirt with crossed
 * lapels, a ragged pale mantle round the neck and shoulders, baggy grey hakama that balloon
 * over wrapped shins tied with red cord, straw sandals over foot wraps, a sculpted face with a
 * spiky tied topknot, wrapped right forearm, a bulky iron-and-brass left gauntlet, and hands
 * whose fingers close round the grip.
 */
import * as THREE from "three";
import { rimLit } from "../world/materials";
import type { Rig, RigDims } from "./Rig";
import { katana } from "./parts";
import {
  clothSet,
  fistHand,
  folds,
  gripHand,
  ironSet,
  lameStack,
  loft,
  mergeGroup,
  sculptHead,
  skinSet,
  smoothRings,
  tube,
  wrapSet,
  type Ring,
  type TexSet,
} from "./sculpt";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mat(set: TexSet | null, p: THREE.MeshStandardMaterialParameters, rim = 1, repeat: [number, number] = [1, 1], nScale = 1): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(p);
  if (set) {
    const map = set.map.clone();
    const nm = set.normalMap.clone();
    map.repeat.set(...repeat);
    nm.repeat.set(...repeat);
    map.needsUpdate = nm.needsUpdate = true;
    m.map = map;
    m.normalMap = nm;
    m.normalScale.set(nScale, nScale);
  }
  return rimLit(m, rim);
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos?: THREE.Vector3, rot?: THREE.Euler): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  if (pos) mesh.position.copy(pos);
  if (rot) mesh.rotation.copy(rot);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Ragged-edge alpha texture for mantles / scarves (tatters at the canvas bottom). */
export function raggedSet(base: TexSet, seed: number, depth = 0.35, holes = 6): THREE.CanvasTexture {
  const src = base.map.image as HTMLCanvasElement;
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  let s = seed;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const w = c.width;
  const h = c.height;
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 6) {
    const strip = Math.abs(Math.sin(x * 0.045 + R() * 0.6));
    g.lineTo(x, h - 4 - R() * h * depth * (0.25 + 0.75 * strip));
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  for (let i = 0; i < holes; i++) {
    g.beginPath();
    g.ellipse(R() * w, h * (0.45 + R() * 0.4), 3 + R() * 9, 5 + R() * 16, R(), 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Paint the face onto the head sphere's UVs (front of the head is u = 0.25). */
function faceTexture(skinT: TexSet): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.drawImage(skinT.map.image as HTMLCanvasElement, 0, 0, 512, 256);
  const cx = 128;
  let s = 3;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blob = (x: number, y: number, rx: number, ry: number, col: string) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, 1);
    gr.addColorStop(0, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.translate(x, y);
    g.scale(rx, ry);
    g.translate(-x, -y);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  // Weathered, sun-darkened skin toward the jaw; stubble.
  blob(cx, 175, 60, 30, "rgba(40,24,16,0.45)");
  for (let i = 0; i < 2600; i++) {
    const x = cx + (R() - 0.5) * 110;
    const y = 150 + R() * 45;
    if (Math.abs(x - cx) < 10 && y < 160) continue;
    g.fillStyle = `rgba(20,12,8,${R() * 0.35})`;
    g.fillRect(x, y, 1, 1 + R());
  }
  // Eye sockets, eyes, heavy stern brows.
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 30;
    blob(ex, 121, 24, 12, "rgba(35,16,10,0.75)");
    g.fillStyle = "#e6d8c8";
    g.beginPath();
    g.ellipse(ex, 121, 8, 2.6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1a0f0a";
    g.beginPath();
    g.ellipse(ex - sx * 1.5, 121, 3.4, 2.8, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(20,10,6,0.9)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(ex, 121.5, 9, 3.2, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.strokeStyle = "#140d09";
    g.lineWidth = 4.5;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(cx + sx * 12, 113);
    g.quadraticCurveTo(cx + sx * 28, 107, cx + sx * 44, 110);
    g.stroke();
    // Nasolabial creases.
    g.strokeStyle = "rgba(60,30,20,0.5)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx + sx * 9, 140);
    g.quadraticCurveTo(cx + sx * 17, 152, cx + sx * 15, 163);
    g.stroke();
  }
  // Nose shadow, mouth, a pale scar across the left cheek.
  blob(cx, 140, 8, 5, "rgba(50,22,14,0.5)");
  g.strokeStyle = "#4a211a";
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(cx - 12, 163);
  g.quadraticCurveTo(cx, 165, cx + 12, 163);
  g.stroke();
  g.strokeStyle = "rgba(230,190,170,0.55)";
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(cx + 36, 112);
  g.lineTo(cx + 50, 146);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface ShinobiParts {
  flaps: { g: THREE.Group; ang: number }[];
  lGrip: THREE.Group;
  lFist: THREE.Group;
  scarfMat: THREE.MeshStandardMaterial;
}

export function buildShinobi(r: Rig, d: RigDims): ShinobiParts {
  // ---------------------------------------------------------------- materials
  const tunicT = clothSet("#6a4630", 101, { folds: 9, patches: 3, grime: 1.5, stitch: "rgba(40,22,12,0.8)" });
  const underT = clothSet("#2b2521", 102, { folds: 5, patches: 0, grime: 0.6 });
  const hakamaT = clothSet("#39332e", 103, { folds: 12, patches: 2, grime: 1.3 });
  const mantleT = clothSet("#b3a084", 104, { folds: 10, patches: 1, grime: 1.4 });
  const wrapT = wrapSet("#a29278", "#3b3129", 105);
  const footT = wrapSet("#8a7c66", "#2e2620", 106);
  const strawT = clothSet("#a08a58", 107, { folds: 0, patches: 0, grime: 0.8 });
  const ironT = ironSet("#2a2826", 108, { rivets: 10, rust: 0.8 });
  const skinT = skinSet("#b98263", 109);

  const tunic = mat(tunicT, { roughness: 0.92, side: THREE.DoubleSide }, 1.1, [2, 1.5], 1.2);
  const under = mat(underT, { roughness: 0.95 }, 0.8, [2, 2]);
  const hakama = mat(hakamaT, { roughness: 0.95, side: THREE.DoubleSide }, 1.0, [2, 1.4], 1.3);
  const mantleMap = raggedSet(mantleT, 7, 0.4, 5);
  const mantle = mat(null, { map: mantleMap, normalMap: mantleT.normalMap, alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide }, 1.5);
  mantle.normalMap!.repeat.set(1, 1);
  const wrap = mat(wrapT, { roughness: 0.95 }, 1.0, [2, 2], 1.4);
  const maskCloth = mat(mantleT, { roughness: 0.96 }, 1.4, [2, 1], 1.4);
  /** A slightly tilted, wobbly band of cloth wound round a limb (breaks up smooth tubes). */
  const band = (y: number, rw: number, rd: number, tilt: number, seed: number, thick = 0.007): THREE.BufferGeometry => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const wob = 1 + Math.sin(a * 3 + seed) * 0.04;
      pts.push(V(Math.sin(a) * rw * wob, y + Math.sin(a) * tilt + Math.sin(a * 2 + seed) * 0.003, Math.cos(a) * rd * wob));
    }
    return tube(pts, thick, thick, 1, 40, 5, true);
  };
  const footWrap = mat(footT, { roughness: 0.95 }, 0.9, [2, 1], 1.2);
  const straw = mat(strawT, { roughness: 1, color: 0xd8c8a0 }, 0.8, [3, 3], 1.5);
  const iron = mat(ironT, { metalness: 0.75, roughness: 0.45, color: 0x9a9690 }, 1.2);
  const brass = rimLit(new THREE.MeshStandardMaterial({ color: 0xb88a3c, metalness: 1, roughness: 0.32 }), 0.8);
  const skin = mat(skinT, { roughness: 0.55 }, 0.9, [1, 1], 0.6);
  const hair = rimLit(new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.7 }), 1.1);
  const redCord = rimLit(new THREE.MeshStandardMaterial({ color: 0xa3180f, roughness: 0.6, emissive: 0x200202 }), 1.0);
  const leather = rimLit(new THREE.MeshStandardMaterial({ color: 0x2a1d15, roughness: 0.62, metalness: 0.05 }), 0.9);
  const lacquer = rimLit(new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.22, metalness: 0.25 }), 0.7);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x0a0706, roughness: 0.15 });

  // ---------------------------------------------------------------- hips: obi, hakama waist, tunic skirt
  const waist: Ring[] = [
    { y: -0.2, w: 0.215, d: 0.17 },
    { y: -0.05, w: 0.2, d: 0.16 },
    { y: 0.08, w: 0.172, d: 0.132 },
    { y: 0.17, w: 0.158, d: 0.12 },
  ];
  add(r.hips, loft(smoothRings(waist, 8), 28, { bump: folds(9, 0.008, 3) }), hakama);
  const obiRings: Ring[] = [
    { y: 0.05, w: 0.172, d: 0.134 },
    { y: 0.11, w: 0.176, d: 0.137 },
    { y: 0.17, w: 0.168, d: 0.13 },
  ];
  add(r.hips, loft(obiRings, 28), under);
  // Red cord tied round the obi.
  const cordPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    cordPts.push(V(Math.sin(a) * 0.18, 0.1 + Math.sin(a * 2) * 0.006, Math.cos(a) * 0.141));
  }
  add(r.hips, tube(cordPts, 0.0065, 0.0065, 1, 48, 6, true), redCord);
  add(r.hips, tube([V(0.05, 0.1, 0.14), V(0.07, 0.04, 0.155), V(0.06, -0.06, 0.16)], 0.006, 0.004), redCord);
  add(r.hips, tube([V(0.03, 0.1, 0.142), V(0.02, 0.03, 0.16), V(0.035, -0.04, 0.165)], 0.006, 0.004), redCord);

  // Tunic skirt panels (front + back + sides), kicked out by the thighs every step.
  const flaps: { g: THREE.Group; ang: number }[] = [];
  const panel = (ang: number, span: number, len: number) => {
    const g = new THREE.Group();
    g.position.set(Math.sin(ang) * 0.02, 0.1, Math.cos(ang) * 0.02);
    g.rotation.y = ang;
    const rings: Ring[] = [
      { y: 0, w: 0.18, d: 0.14 },
      { y: -len * 0.5, w: 0.21, d: 0.17 },
      { y: -len, w: 0.235, d: 0.19 },
    ];
    add(g, loft(smoothRings(rings, 6), 10, { t0: -span, t1: span, bump: folds(5, 0.009, 11 + ang) }), tunic);
    r.hips.add(g);
    flaps.push({ g, ang });
  };
  panel(0, 0.62, 0.34);
  panel(Math.PI, 0.72, 0.38);

  // Saya on the left hip with its red sageo cord.
  const saya = new THREE.Group();
  saya.position.set(0.19, 0.12, 0.1);
  saya.quaternion.setFromUnitVectors(V(0, 1, 0), V(0.2, -0.3, -1).normalize());
  const sayaRings: Ring[] = [
    { y: -0.02, w: 0.02, d: 0.03 },
    { y: 0.04, w: 0.018, d: 0.028 },
    { y: 0.84, w: 0.015, d: 0.023 },
    { y: 0.86, w: 0.009, d: 0.014 },
  ];
  add(saya, loft(sayaRings, 10, { capTop: true }), lacquer);
  add(saya, loft([{ y: -0.025, w: 0.023, d: 0.033 }, { y: 0.03, w: 0.023, d: 0.033 }], 10), leather);
  add(saya, tube([V(0, 0.08, -0.03), V(0.01, 0.12, -0.05), V(-0.02, 0.2, -0.04), V(-0.04, 0.26, 0.0)], 0.005, 0.004), redCord);
  r.hips.add(saya);

  // ---------------------------------------------------------------- torso
  const torsoRings: Ring[] = [
    { y: -0.08, w: 0.158, d: 0.118, db: 0.11 },
    { y: 0.06, w: 0.16, d: 0.122, db: 0.112 },
    { y: 0.18, w: 0.175, d: 0.132, db: 0.118 },
    { y: 0.28, w: 0.19, d: 0.134, db: 0.124 },
    { y: 0.345, w: 0.192, d: 0.115, db: 0.11, p: 2.3 },
    { y: 0.395, w: 0.14, d: 0.09 },
    { y: 0.44, w: 0.062, d: 0.056 },
  ];
  const tr = smoothRings(torsoRings, 14);
  add(r.chest, loft(tr, 30, { bump: folds(7, 0.006, 21, 1.2) }), tunic);
  const depthAt = (y: number) => {
    let best = tr[0];
    for (const q of tr) if (Math.abs(q.y - y) < Math.abs(best.y - y)) best = q;
    return best;
  };
  // Dark undershirt in the V of the collar, then the lapels (left over right).
  const vPts = (side: number, off: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const y = 0.43 - u * 0.36;
      const x = side * (0.07 - u * 0.1) + off;
      const q = depthAt(y);
      const z = q.d * Math.sqrt(Math.max(0.05, 1 - (x / q.w) ** 2)) + 0.008;
      pts.push(V(x, y, z));
    }
    return pts;
  };
  add(r.chest, tube(vPts(-1, 0.012), 0.03, 0.026, 0.28, 24, 8), under);
  add(r.chest, tube(vPts(1, -0.006), 0.034, 0.03, 0.3, 24, 8), tunic);
  add(r.chest, tube(vPts(-1, 0.0), 0.028, 0.024, 0.3, 24, 8), tunic);
  // Leather harness strap across the chest to the shoulder plate.
  add(r.chest, tube([V(-0.14, 0.05, 0.1), V(-0.05, 0.17, 0.142), V(0.08, 0.3, 0.13), V(0.16, 0.37, 0.06)], 0.022, 0.022, 0.35, 20, 6), leather);

  // Left shoulder: three layered iron lames with brass rims.
  const sode = new THREE.Group();
  sode.position.set(0.2, 0.39, 0);
  sode.rotation.set(0, Math.PI / 2, -0.35);
  add(sode, lameStack(3, 0.06, 0.045, (i) => [0.085 + i * 0.012, 0.11 + i * 0.012], -1.1, 1.1, 14, 0.008), iron);
  add(sode, loft([{ y: 0.005, w: 0.09, d: 0.09 }, { y: -0.002, w: 0.093, d: 0.093 }], 14, { t0: -1.1, t1: 1.1 }), brass);
  r.chest.add(sode);

  // Ragged mantle round the neck and shoulders.
  const mantleRings: Ring[] = [
    { y: 0.2, w: 0.25, d: 0.19, db: 0.18 },
    { y: 0.29, w: 0.235, d: 0.17 },
    { y: 0.37, w: 0.2, d: 0.14 },
    { y: 0.43, w: 0.12, d: 0.11 },
    { y: 0.5, w: 0.085, d: 0.085 },
    { y: 0.53, w: 0.08, d: 0.08 },
  ];
  add(r.chest, loft(smoothRings(mantleRings, 10), 30, { bump: folds(9, 0.014, 31, 1.3) }), mantle);
  // Thick scarf wraps round the throat.
  for (let k = 0; k < 2; k++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      pts.push(V(Math.sin(a) * (0.082 + k * 0.01), 0.45 + k * 0.035 + Math.cos(a) * 0.015, Math.cos(a) * (0.078 + k * 0.012)));
    }
    const wrap = add(r.chest, tube(pts, 0.03 - k * 0.004, 0.03 - k * 0.004, 0.8, 40, 8, true), mantle);
    wrap.userData.keep = true;
    wrap.userData.scarfWrap = true;
  }

  // ---------------------------------------------------------------- head
  add(r.head, loft([{ y: -0.07, w: 0.05, d: 0.052 }, { y: 0.06, w: 0.046, d: 0.05 }], 12), skin);
  const face = mat(null, { map: faceTexture(skinT), normalMap: skinT.normalMap, roughness: 0.6 }, 0.9);
  face.normalScale.set(0.5, 0.5);
  const head = add(r.head, sculptHead(0.1, { nose: 1.1, jaw: 1.15, brow: 1.2 }), face, V(0, 0.12, 0.005));
  head.scale.set(0.98, 1.08, 1.0);
  for (const s of [-1, 1]) {
    add(r.head, new THREE.SphereGeometry(0.0115, 10, 8), eyeM, V(s * 0.031, 0.128, 0.083)).scale.set(1.35, 0.7, 0.6);
    add(r.head, tube([V(s * 0.012, 0.146, 0.094), V(s * 0.034, 0.151, 0.093), V(s * 0.055, 0.145, 0.082)], 0.0055, 0.0035, 0.5, 8, 5), hair);
    add(r.head, new THREE.SphereGeometry(0.016, 8, 6), skin, V(s * 0.094, 0.115, -0.005)).scale.set(0.5, 1.1, 0.8);
  }
  // Scarf pulled up over the nose: the lower face is wrapped cloth, only the eyes and brow show.
  const maskRings: Ring[] = [
    { y: 0.02, w: 0.07, d: 0.075 },
    { y: 0.06, w: 0.093, d: 0.1 },
    { y: 0.095, w: 0.105, d: 0.11 },
    { y: 0.114, w: 0.106, d: 0.112 },
    { y: 0.118, w: 0.1, d: 0.106 },
  ];
  add(r.head, loft(smoothRings(maskRings, 6), 28, { bump: folds(8, 0.006, 71, 1.2) }), maskCloth);
  add(r.head, band(0.112, 0.107, 0.113, -0.004, 2, 0.006), maskCloth);
  // Short beard shadow + mouth line.
  add(r.head, tube([V(-0.022, 0.066, 0.094), V(0, 0.063, 0.099), V(0.022, 0.066, 0.094)], 0.0035, 0.0035, 0.5, 8, 5), hair);
  // Hair cap swept back.
  const cap = add(r.head, new THREE.SphereGeometry(0.106, 24, 16, 0, Math.PI * 2, 0, 1.9), hair, V(0, 0.132, -0.012));
  cap.rotation.x = -0.55;
  cap.scale.set(0.93, 1.02, 1.08);
  // Swept locks from the hairline to the knot.
  const knot = V(0, 0.225, -0.055);
  for (let i = 0; i < 18; i++) {
    const a = -1.6 + (i / 17) * 3.2;
    const start = V(Math.sin(a) * 0.098, 0.15 + Math.cos(a) * 0.035, Math.cos(a) * 0.075 + 0.01);
    const mid = V(Math.sin(a) * 0.1, 0.215, Math.cos(a) * 0.04 - 0.03);
    add(r.head, tube([start, mid, knot], 0.011, 0.006, 0.55, 10, 5), hair);
  }
  // Spiky topknot bundle and the red tie.
  const R = (() => {
    let s = 5;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2;
    const up = 0.07 + R() * 0.06;
    const tip = V(Math.sin(a) * (0.03 + R() * 0.04), knot.y + up, knot.z - 0.02 + Math.cos(a) * (0.03 + R() * 0.03) - 0.02);
    add(r.head, tube([knot.clone(), V((tip.x + knot.x) / 2, knot.y + up * 0.55, (tip.z + knot.z) / 2), tip], 0.012, 0.0012, 1, 8, 5), hair);
  }
  add(r.head, tube([V(-0.018, knot.y + 0.01, knot.z), V(0, knot.y + 0.014, knot.z + 0.018), V(0.018, knot.y + 0.01, knot.z), V(0, knot.y + 0.006, knot.z - 0.018)], 0.006, 0.006, 1, 16, 5, true), redCord);
  add(r.head, tube([V(0.01, knot.y + 0.01, knot.z - 0.015), V(0.03, knot.y - 0.03, knot.z - 0.04), V(0.035, knot.y - 0.08, knot.z - 0.05)], 0.004, 0.003), redCord);
  // Stray strands over the brow.
  for (const s of [-1, 1]) add(r.head, tube([V(s * 0.03, 0.205, 0.07), V(s * 0.05, 0.17, 0.1), V(s * 0.055, 0.13, 0.1)], 0.005, 0.001, 1, 8, 4), hair);

  // ---------------------------------------------------------------- arms
  for (let i = 0; i < 2; i++) {
    const sleeve: Ring[] = [
      { y: -0.04, w: 0.075, d: 0.07 },
      { y: 0.06, w: 0.074, d: 0.068 },
      { y: 0.2, w: 0.066, d: 0.06 },
      { y: d.upperArm + 0.02, w: 0.058, d: 0.054 },
    ];
    add(r.uArm[i], loft(smoothRings(sleeve, 8), 16, { bump: folds(5, 0.006, 41 + i), capBot: true }), tunic);
    add(r.uArm[i], new THREE.SphereGeometry(0.074, 14, 10), tunic);
    // Loose sleeve cuff flaring past the elbow, and a red cord tying the sleeve up.
    const cuff: Ring[] = [
      { y: d.upperArm - 0.1, w: 0.062, d: 0.057 },
      { y: d.upperArm + 0.0, w: 0.076, d: 0.07 },
      { y: d.upperArm + 0.06, w: 0.088, d: 0.08 },
    ];
    add(r.uArm[i], loft(smoothRings(cuff, 4), 16, { bump: folds(6, 0.01, 81 + i, 1.5) }), tunic);
    add(r.uArm[i], band(0.1, 0.071, 0.066, 0.01, 5 + i, 0.0055), redCord);
    if (i === 0) {
      // Wrapped forearm with a red cord at the wrist.
      const fore: Ring[] = [
        { y: -0.02, w: 0.05, d: 0.046 },
        { y: 0.12, w: 0.047, d: 0.042 },
        { y: d.foreArm - 0.02, w: 0.034, d: 0.03 },
      ];
      add(r.fArm[i], loft(smoothRings(fore, 6), 14), wrap);
      add(r.fArm[i], new THREE.SphereGeometry(0.05, 12, 8), wrap);
      for (let k = 0; k < 4; k++) {
        const y = 0.05 + k * 0.045;
        const rr = 0.05 - (y / d.foreArm) * 0.014;
        add(r.fArm[i], band(y, rr, rr * 0.92, (k % 2 ? 1 : -1) * 0.012, k * 1.7, 0.0065), leather);
      }
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ring.push(V(Math.sin(a) * 0.036, d.foreArm - 0.06 + Math.sin(a * 3) * 0.003, Math.cos(a) * 0.033));
      }
      add(r.fArm[i], tube(ring, 0.0045, 0.0045, 1, 32, 5, true), redCord);
    } else {
      // Bulky iron gauntlet: layered rings, brass bands, rivets, a knuckle guard.
      add(r.fArm[i], new THREE.SphereGeometry(0.056, 12, 8), iron);
      add(r.fArm[i], lameStack(5, 0.06, 0.055, (k) => [0.052 - k * 0.002, 0.058 - k * 0.002], 0, Math.PI * 2, 16, 0.006).translate(0, d.foreArm - 0.03, 0), iron);
      for (const y of [0.05, 0.16, d.foreArm - 0.04]) {
        add(r.fArm[i], loft([{ y: y - 0.008, w: 0.061, d: 0.06 }, { y: y + 0.008, w: 0.06, d: 0.059 }], 16), brass);
      }
      add(r.fArm[i], loft([{ y: 0.02, w: 0.02, d: 0.012, z: 0.06 }, { y: d.foreArm - 0.05, w: 0.016, d: 0.01, z: 0.058 }], 8, { capTop: true, capBot: true }), brass);
    }
  }
  // Hands.
  const gh = gripHand(0.016);
  const rHand = r.hand[0];
  add(rHand, gh.skin, skin);
  add(rHand, gh.back, wrap);
  const lGrip = new THREE.Group();
  const lFist = new THREE.Group();
  const gh2 = gripHand(0.016, 1.08);
  add(lGrip, gh2.skin, leather);
  add(lGrip, gh2.back, brass);
  const fh = fistHand(1.08);
  add(lFist, fh.skin, leather);
  add(lFist, fh.back, brass);
  r.hand[1].add(lGrip, lFist);

  // ---------------------------------------------------------------- legs
  for (let i = 0; i < 2; i++) {
    const th: Ring[] = [
      { y: -0.08, w: 0.125, d: 0.125 },
      { y: 0.12, w: 0.135, d: 0.132 },
      { y: 0.32, w: 0.145, d: 0.14 },
      { y: d.thigh + 0.04, w: 0.145, d: 0.142 },
    ];
    add(r.thigh[i], loft(smoothRings(th, 8), 20, { bump: folds(6, 0.012, 51 + i, 1.4) }), hakama);
    // Hakama balloons past the knee, gathered into the wraps.
    const sh: Ring[] = [
      { y: -0.06, w: 0.148, d: 0.146 },
      { y: 0.08, w: 0.15, d: 0.15 },
      { y: 0.17, w: 0.13, d: 0.13 },
      { y: 0.215, w: 0.075, d: 0.075 },
      { y: 0.23, w: 0.058, d: 0.058 },
    ];
    add(r.shin[i], loft(smoothRings(sh, 10), 20, { bump: folds(7, 0.012, 61 + i, 1.4) }), hakama);
    const legW: Ring[] = [
      { y: 0.2, w: 0.062, d: 0.062 },
      { y: 0.3, w: 0.058, d: 0.06 },
      { y: d.shin - 0.01, w: 0.045, d: 0.047 },
    ];
    add(r.shin[i], loft(smoothRings(legW, 6), 14), wrap);
    // Criss-crossed dark bindings over the leg wraps.
    for (let k = 0; k < 3; k++) {
      const y = 0.28 + k * 0.055;
      const rr = 0.061 - k * 0.004;
      add(r.shin[i], band(y, rr, rr, (k % 2 ? 1 : -1) * 0.02, k * 2.3 + i, 0.006), leather);
    }
    for (const y of [0.25, 0.35]) {
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = y < 0.3 ? 0.062 : 0.057;
        ring.push(V(Math.sin(a) * rr, y + Math.sin(a * 2) * 0.004, Math.cos(a) * rr));
      }
      add(r.shin[i], tube(ring, 0.0055, 0.0055, 1, 32, 5, true), redCord);
    }
    add(r.shin[i], tube([V(0.05, 0.25, 0.03), V(0.07, 0.29, 0.04), V(0.075, 0.34, 0.03)], 0.005, 0.003), redCord);
    // Foot wrap + straw sandal.
    const foot: Ring[] = [
      { y: -0.06, w: 0.038, d: 0.04 },
      { y: -0.02, w: 0.045, d: 0.046 },
      { y: 0.08, w: 0.047, d: 0.033 },
      { y: 0.15, w: 0.038, d: 0.024 },
      { y: 0.175, w: 0.02, d: 0.014 },
    ];
    const fg = loft(smoothRings(foot, 8), 14, { capTop: true, capBot: true });
    fg.rotateX(Math.PI / 2);
    add(r.foot[i], fg, footWrap, V(0, -0.05, 0));
    const sole = loft([{ y: -0.07, w: 0.042, d: 0.008 }, { y: 0.05, w: 0.05, d: 0.008 }, { y: 0.17, w: 0.035, d: 0.008 }], 12, { capTop: true, capBot: true, t0: 0, t1: Math.PI * 2 });
    sole.rotateX(Math.PI / 2);
    add(r.foot[i], sole, straw, V(0, -0.082, 0));
    for (const zz of [0.07, -0.01]) {
      add(r.foot[i], tube([V(-0.046, -0.08, zz), V(-0.03, -0.035, zz + 0.01), V(0.0, -0.022, zz + 0.012), V(0.03, -0.035, zz + 0.01), V(0.046, -0.08, zz)], 0.005, 0.005, 0.6, 12, 5), straw);
    }
    add(r.foot[i], new THREE.SphereGeometry(0.052, 10, 8), wrap, V(0, 0.005, -0.005));
  }

  // ---------------------------------------------------------------- sword
  r.sword.add(katana(d.tsuba, d.blade, { tsukaColor: "#1b1614", sori: 0.024 }));

  for (const g of [r.hips, r.chest, r.head, ...r.uArm, ...r.fArm, ...r.thigh, ...r.shin, ...r.foot, rHand, lGrip, lFist, sode, saya, ...flaps.map((f) => f.g)]) mergeGroup(g);

  const scarfMat = mat(null, { map: raggedSet(mantleT, 13, 0.3, 4), normalMap: mantleT.normalMap, alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide }, 1.5);
  return { flaps, lGrip, lFist, scarfMat };
}
