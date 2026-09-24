/**
 * Sculpting toolkit for the fighters: lofted super-ellipse shells (torsos, sleeves, hakama with
 * real pleats), lathe-swept armour lames with rolled edges, sculpted heads and masks, hands whose
 * fingers wrap the grip, canvas texture sets with derived normal maps (weave, folds, lacing,
 * chain mail), and a per-slot merge that collapses static pieces into one mesh per material.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "../core/math";

// ---------------------------------------------------------------------------- loft

export interface Ring {
  y: number;
  /** half width (x) */
  w: number;
  /** front half depth (+z) */
  d: number;
  /** back half depth (-z), defaults to d */
  db?: number;
  x?: number;
  z?: number;
  /** super-ellipse exponent: 2 = ellipse, higher = boxier */
  p?: number;
}

export interface LoftOpts {
  capTop?: boolean;
  capBot?: boolean;
  /** radial offset (m) at angle θ (0 = front, π/2 = +x) and v ∈ [0,1] along the rings */
  bump?: (theta: number, v: number, y: number) => number;
  /** partial loft: θ range (default the full turn, seam at the back) */
  t0?: number;
  t1?: number;
}

const sp = (c: number, e: number) => Math.sign(c) * Math.pow(Math.abs(c), e);

/** Smoothly interpolate rings (Catmull-Rom on every field) to `n` rings. */
export function smoothRings(rings: Ring[], n: number): Ring[] {
  const out: Ring[] = [];
  const f = (k: keyof Ring, r: Ring) => (r[k] ?? (k === "db" ? r.d : k === "p" ? 2 : 0)) as number;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * (rings.length - 1);
    const j = Math.min(rings.length - 2, Math.floor(u));
    const t = u - j;
    const a = rings[Math.max(0, j - 1)];
    const b = rings[j];
    const c = rings[j + 1];
    const d = rings[Math.min(rings.length - 1, j + 2)];
    const cr = (k: keyof Ring) => {
      const p0 = f(k, a), p1 = f(k, b), p2 = f(k, c), p3 = f(k, d);
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    out.push({ y: cr("y"), w: Math.max(0.001, cr("w")), d: Math.max(0.001, cr("d")), db: Math.max(0.001, cr("db")), x: cr("x"), z: cr("z"), p: cr("p") });
  }
  return out;
}

export function loft(rings: Ring[], seg = 24, o: LoftOpts = {}): THREE.BufferGeometry {
  const t0 = o.t0 ?? Math.PI;
  const t1 = o.t1 ?? Math.PI * 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = rings.length;
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    const e = 2 / (r.p ?? 2);
    const v = i / (n - 1);
    for (let j = 0; j <= seg; j++) {
      const th = t0 + ((t1 - t0) * j) / seg;
      const s = Math.sin(th);
      const c = Math.cos(th);
      let x = r.w * sp(s, e);
      let z = (c > 0 ? r.d : r.db ?? r.d) * sp(c, e);
      if (o.bump) {
        const b = o.bump(th, v, r.y);
        x += s * b;
        z += c * b;
      }
      pos.push(x + (r.x ?? 0), r.y, z + (r.z ?? 0));
      uv.push(j / seg, v);
    }
  }
  const W = seg + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * W + j;
      const b = a + W;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const cap = (i: number, up: boolean) => {
    const r = rings[i];
    const c = pos.length / 3;
    pos.push(r.x ?? 0, r.y, r.z ?? 0);
    uv.push(0.5, up ? 1 : 0);
    for (let j = 0; j < seg; j++) {
      const a = i * W + j;
      if (up) idx.push(a, c, a + 1);
      else idx.push(a, a + 1, c);
    }
  };
  if (o.capTop) cap(n - 1, true);
  if (o.capBot) cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cloth pleats/folds: a bump function with `n` soft folds around, varying down the length. */
export function folds(n: number, depth: number, seed = 1, sharp = 1.6): (th: number, v: number) => number {
  const R = rng(seed);
  const ph = Array.from({ length: 4 }, () => R() * 6.28);
  return (th, v) => {
    const a = Math.sin(th * n + ph[0] + v * 1.3) * 0.6 + Math.sin(th * (n * 1.7) + ph[1] - v * 2.1) * 0.4;
    const w = Math.sin(v * 5 + ph[2] + th * 2) * 0.15;
    return (Math.sign(a) * Math.pow(Math.abs(a), sharp) + w) * depth;
  };
}

// ---------------------------------------------------------------------------- plates

/**
 * Lathe-swept lame (one horizontal armour plate): top at y=0, bottom at y=-h, radius r0→r1,
 * slight outward belly, rolled lower edge. θ range [a0, a1] (0 = front, +x at π/2).
 */
export function lame(r0: number, r1: number, h: number, a0: number, a1: number, seg = 16, lip = 0.007, belly = 0.006): THREE.BufferGeometry {
  const t = 0.004;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(r0 - t, 0.002),
    new THREE.Vector2(r0, 0),
    new THREE.Vector2(r0 + (r1 - r0) * 0.5 + belly, -h * 0.5),
    new THREE.Vector2(r1, -h),
    new THREE.Vector2(r1 + lip * 0.8, -h - lip * 0.2),
    new THREE.Vector2(r1 + lip * 0.6, -h - lip * 0.9),
    new THREE.Vector2(r1 - t, -h - lip * 0.6),
  ];
  const g = new THREE.LatheGeometry(pts, seg, a0, a1 - a0);
  // Lathe v runs along the profile; remap so the texture spans the visible face.
  const uvA = g.attributes.uv as THREE.BufferAttribute;
  const P = pts.length;
  const vmap = [0, 0.02, 0.5, 0.95, 1, 1, 1];
  for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - vmap[i % P]);
  return g;
}

/** A stack of lames (sode, kusazuri, shikoro, dō): returns merged geometry. */
export function lameStack(
  rows: number,
  h: number,
  step: number,
  r: (i: number) => [number, number],
  a0: number,
  a1: number,
  seg = 16,
  lip = 0.007,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < rows; i++) {
    const [r0, r1] = r(i);
    const g = lame(r0, r1, h, a0, a1, seg, lip);
    g.translate(0, -i * step, 0);
    parts.push(g);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

// ---------------------------------------------------------------------------- tubes

/** Tube along points with radius tapering r0 → r1 (optionally flattened along local normal). */
export function tube(points: THREE.Vector3[], r0: number, r1: number, flat = 1, ts = 20, rs = 7, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  const geo = new THREE.TubeGeometry(curve, ts, 1, rs, closed);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  const fr = curve.computeFrenetFrames(ts, closed);
  for (let i = 0; i <= ts; i++) {
    const u = i / ts;
    curve.getPointAt(u, c);
    const rr = r0 + (r1 - r0) * u;
    for (let j = 0; j <= rs; j++) {
      const k = i * (rs + 1) + j;
      v.fromBufferAttribute(p, k).sub(c);
      const nb = fr.binormals[i];
      const along = v.dot(nb);
      v.addScaledVector(nb, along * (flat - 1));
      v.multiplyScalar(rr);
      p.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------- hands

/**
 * A hand gripping a handle whose axis is local +Y through the origin (blade toward +Y, edge +Z).
 * Palm on the spine side (-Z), fingers wrap round +X to the edge side, thumb round -X.
 */
export function gripHand(handleR = 0.017, scale = 1): { skin: THREE.BufferGeometry; back: THREE.BufferGeometry } {
  const s = scale;
  const rg = handleR * s;
  const fingers: THREE.BufferGeometry[] = [];
  const fr = [0.0098, 0.0102, 0.0096, 0.0085];
  for (let k = 0; k < 4; k++) {
    const y = (0.03 - k * 0.021) * s;
    const r = rg + fr[k] * s * 0.9;
    const pts: THREE.Vector3[] = [];
    const a0 = Math.PI + 0.55;
    const a1 = -0.15 - k * 0.08;
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const th = a0 + (a1 - a0) * u;
      const rr = r * (1 + (1 - u) * 0.35);
      pts.push(new THREE.Vector3(Math.sin(th) * rr, y - u * 0.004 * s, Math.cos(th) * rr));
    }
    fingers.push(tube(pts, fr[k] * s, fr[k] * s * 0.82, 1, 14, 6));
  }
  // Thumb: from the heel of the palm round -X, laid over the index finger.
  const tp: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    const th = Math.PI + 0.9 + u * 1.55;
    const rr = (rg + 0.011 * s) * (1 + (1 - u) * 0.5);
    tp.push(new THREE.Vector3(Math.sin(th) * rr, (0.012 + u * 0.028) * s, Math.cos(th) * rr));
  }
  fingers.push(tube(tp, 0.0115 * s, 0.0092 * s, 1, 12, 6));
  // Palm / back of hand: a thick partial shell behind the handle.
  const prof = [
    new THREE.Vector2(rg + 0.004 * s, -0.052 * s),
    new THREE.Vector2(rg + 0.03 * s, -0.05 * s),
    new THREE.Vector2(rg + 0.036 * s, -0.01 * s),
    new THREE.Vector2(rg + 0.032 * s, 0.04 * s),
    new THREE.Vector2(rg + 0.004 * s, 0.045 * s),
  ];
  const palm = new THREE.LatheGeometry(prof, 10, Math.PI - 1.0, 2.0);
  const skin = mergeGeometries([...fingers, palm].map((g) => stripTo(g)))!;
  // Back plate (tekko / glove cuff) sits on the back of the hand.
  const bp = [new THREE.Vector2(rg + 0.036 * s, -0.056 * s), new THREE.Vector2(rg + 0.043 * s, -0.01 * s), new THREE.Vector2(rg + 0.038 * s, 0.035 * s)];
  const back = new THREE.LatheGeometry(bp, 8, Math.PI - 0.75, 1.5);
  return { skin, back: stripTo(back) };
}

/** Relaxed fist at the end of a forearm (local +Y from the wrist). */
export function fistHand(scale = 1): { skin: THREE.BufferGeometry; back: THREE.BufferGeometry } {
  const h = gripHand(0.012, scale);
  const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, 0.05 * scale, 0.012 * scale));
  h.skin.applyMatrix4(m);
  h.back.applyMatrix4(m);
  return h;
}

// ---------------------------------------------------------------------------- heads

const gauss = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));

/** A sculpted human head (radius r): brow ridge, sockets, nose, cheekbones, jaw, chin. */
export function sculptHead(r: number, o: { nose?: number; jaw?: number; brow?: number } = {}): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 40, 30);
  const p = g.attributes.position as THREE.BufferAttribute;
  const nose = o.nose ?? 1;
  const jaw = o.jaw ?? 1;
  const brow = o.brow ?? 1;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) / r;
    let y = p.getY(i) / r;
    let z = p.getZ(i) / r;
    const front = Math.max(0, z);
    // Skull: longer front-back, flatter sides, jaw tapers toward the chin.
    x *= 0.86;
    z *= y > 0 ? 1.06 : 1.0;
    if (y < 0) x *= 1 - 0.3 * jaw * Math.min(1, -y) * (0.5 + 0.5 * front);
    if (y < -0.2) z += 0.1 * front * gauss(x, 0.3) * jaw;
    // Brow ridge and eye sockets.
    z += 0.07 * brow * gauss(y - 0.22, 0.07) * gauss(x, 0.45) * front;
    for (const sx of [-0.36, 0.36]) z -= 0.085 * gauss(x - sx, 0.13) * gauss(y - 0.09, 0.09) * front;
    // Nose.
    const nz = gauss(x, 0.085) * Math.max(0, Math.min(1, (0.2 - y) / 0.35)) * gauss(y + 0.1, 0.2);
    z += 0.24 * nose * nz * front;
    // Cheekbones, mouth line, chin.
    for (const sx of [-0.55, 0.55]) {
      const c = gauss(x - sx, 0.18) * gauss(y + 0.02, 0.12) * front;
      z += 0.05 * c;
      x += Math.sign(sx) * 0.03 * c;
    }
    z -= 0.035 * gauss(y + 0.42, 0.04) * gauss(x, 0.25) * front;
    z += 0.05 * gauss(y + 0.62, 0.1) * gauss(x, 0.2) * front * jaw;
    p.setXYZ(i, x * r, y * r, z * r);
  }
  g.computeVertexNormals();
  return g;
}

/** A snarling iron half-mask (menpō): hooked nose, cheek wrinkles, open mouth. Front half only. */
export function sculptMenpo(r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 36, 24, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.47, Math.PI * 0.42);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) / r;
    const y = p.getY(i) / r;
    let z = p.getZ(i) / r;
    x *= 0.95;
    // Jaw juts forward, cheeks swell, deep grimace creases.
    z += 0.12 * Math.max(0, -y - 0.3);
    for (const sx of [-0.5, 0.5]) {
      z += 0.08 * gauss(x - sx, 0.18) * gauss(y + 0.12, 0.12);
      z -= 0.05 * gauss(x - sx * 0.62, 0.05) * gauss(y + 0.28, 0.16);
      z -= 0.03 * gauss(x - sx * 1.1, 0.05) * gauss(y + 0.18, 0.1);
    }
    // Hooked nose.
    z += 0.34 * gauss(x, 0.09) * gauss(y + 0.02, 0.13);
    z -= 0.06 * gauss(x, 0.06) * gauss(y + 0.16, 0.03);
    // Mouth slot.
    z -= 0.12 * gauss(x, 0.28) * gauss(y + 0.36, 0.035);
    p.setXYZ(i, x * r, y * r, z * r);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------- merge

/** Keep only position/normal/uv, non-indexed (so everything merges). */
export function stripTo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
  return n;
}

/** Collapse a group's childless meshes into one mesh per material (local transforms baked). */
export function mergeGroup(group: THREE.Object3D): void {
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const kill: THREE.Object3D[] = [];
  for (const c of group.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.children.length || Array.isArray(m.material) || m.userData.keep) continue;
    m.updateMatrix();
    const g = stripTo(m.geometry).applyMatrix4(m.matrix);
    const e = byMat.get(m.material) ?? { geos: [], shadow: false };
    e.geos.push(g);
    e.shadow ||= m.castShadow;
    byMat.set(m.material, e);
    kill.push(m);
  }
  for (const k of kill) group.remove(k);
  for (const [mat, e] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(e.geos)!, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

// ---------------------------------------------------------------------------- textures

export interface TexSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

type Draw = (c: CanvasRenderingContext2D, h: CanvasRenderingContext2D, w: number, hh: number, R: () => number) => void;

/** Draw colour and height together; the height canvas becomes a tangent-space normal map. */
export function texSet(w: number, h: number, seed: number, draw: Draw, strength = 2.5): TexSet {
  const cc = document.createElement("canvas");
  cc.width = w;
  cc.height = h;
  const hc = document.createElement("canvas");
  hc.width = w;
  hc.height = h;
  const c = cc.getContext("2d")!;
  const g = hc.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, w, h);
  draw(c, g, w, h, rng(seed));
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(heightToNormal(g, w, h, strength));
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normalMap };
}

function heightToNormal(g: CanvasRenderingContext2D, w: number, h: number, k: number): HTMLCanvasElement {
  const src = g.getImageData(0, 0, w, h).data;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const oc = out.getContext("2d")!;
  const img = oc.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  return out;
}

const hgray = (v: number, a = 1) => `rgba(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)},${a})`;

/** Coarse woven cloth: weave, long soft folds, wear patches, frayed stitching, grime. */
export function clothSet(base: string, seed: number, o: { folds?: number; patches?: number; grime?: number; stitch?: string } = {}): TexSet {
  return texSet(512, 512, seed, (c, g, w, h, R) => {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    // Long vertical folds (height + shading).
    const nf = o.folds ?? 7;
    for (let i = 0; i < nf * 2; i++) {
      const x = R() * w;
      const fw = 10 + R() * 40;
      const grd = g.createLinearGradient(x - fw, 0, x + fw, 0);
      grd.addColorStop(0, hgray(0.5, 0));
      grd.addColorStop(0.5, hgray(R() < 0.5 ? 0.75 : 0.3, 0.5));
      grd.addColorStop(1, hgray(0.5, 0));
      g.fillStyle = grd;
      g.fillRect(x - fw, 0, fw * 2, h);
      const cg = c.createLinearGradient(x - fw, 0, x + fw, 0);
      cg.addColorStop(0, "rgba(0,0,0,0)");
      cg.addColorStop(0.5, `rgba(0,0,0,${0.08 + R() * 0.1})`);
      cg.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = cg;
      c.fillRect(x - fw, 0, fw * 2, h);
    }
    // Weave.
    for (let y = 0; y < h; y += 3) {
      g.fillStyle = hgray(0.35, 0.35);
      g.fillRect(0, y, w, 1);
      c.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.05})`;
      c.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 3) {
      g.fillStyle = hgray(0.65, 0.25);
      g.fillRect(x, 0, 1, h);
      c.fillStyle = `rgba(255,240,215,${0.02 + R() * 0.03})`;
      c.fillRect(x, 0, 1, h);
    }
    // Mottled wear / grime.
    const gr = o.grime ?? 1;
    for (let i = 0; i < 260 * gr; i++) {
      const s = 5 + R() * 40;
      c.fillStyle = R() < 0.6 ? `rgba(20,14,8,${0.03 + R() * 0.06})` : `rgba(255,235,200,${0.02 + R() * 0.04})`;
      c.beginPath();
      c.ellipse(R() * w, R() * h, s, s * (0.3 + R() * 0.7), R() * 3, 0, Math.PI * 2);
      c.fill();
    }
    // Grime darker toward the bottom edge.
    const bg = c.createLinearGradient(0, h * 0.7, 0, h);
    bg.addColorStop(0, "rgba(0,0,0,0)");
    bg.addColorStop(1, `rgba(15,10,6,${0.35 * gr})`);
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    // Patches with stitching.
    for (let i = 0; i < (o.patches ?? 3); i++) {
      const px = R() * w, py = R() * h, pw = 40 + R() * 70, ph = 30 + R() * 60;
      c.fillStyle = `rgba(${R() < 0.5 ? "30,22,14" : "90,70,50"},0.35)`;
      c.fillRect(px, py, pw, ph);
      g.fillStyle = hgray(0.62, 0.8);
      g.fillRect(px, py, pw, ph);
      c.strokeStyle = o.stitch ?? "rgba(200,180,150,0.5)";
      c.setLineDash([4, 4]);
      c.lineWidth = 1.5;
      c.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
      c.setLineDash([]);
    }
  }, 3);
}

/**
 * One lacquered lame with dense lacing (kebiki odoshi): vertical cord columns with twist, lacing
 * holes, a lit top edge and dark lip. u runs around, v down the plate.
 */
export function lameSet(lacquer: string, lace: string, seed: number, o: { cols?: number; cross?: boolean; gold?: boolean } = {}): TexSet {
  return texSet(512, 128, seed, (c, g, w, h, R) => {
    c.fillStyle = lacquer;
    c.fillRect(0, 0, w, h);
    // Lacquer: speckle + soft vertical highlight bands.
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(255,255,255,${R() * 0.035})`;
      c.fillRect(R() * w, R() * h, 1 + R() * 2, 1);
    }
    const sh = c.createLinearGradient(0, 0, 0, h);
    sh.addColorStop(0, "rgba(255,240,220,0.22)");
    sh.addColorStop(0.12, "rgba(255,255,255,0.04)");
    sh.addColorStop(0.8, "rgba(0,0,0,0.1)");
    sh.addColorStop(1, "rgba(0,0,0,0.6)");
    c.fillStyle = sh;
    c.fillRect(0, 0, w, h);
    const hg = g.createLinearGradient(0, 0, 0, h);
    hg.addColorStop(0, hgray(0.62));
    hg.addColorStop(0.9, hgray(0.5));
    hg.addColorStop(1, hgray(0.3));
    g.fillStyle = hg;
    g.fillRect(0, 0, w, h);
    // Kozane scale ridges.
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = hgray(0.4, 0.8);
      g.fillRect(x, h * 0.55, 1, h * 0.45);
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(x, h * 0.55, 1, h * 0.45);
    }
    // Lacing columns.
    const cols = o.cols ?? 24;
    const cw = w / cols;
    for (let i = 0; i < cols; i++) {
      const x = i * cw + cw * 0.5;
      const lw = cw * 0.42;
      c.fillStyle = lace;
      c.fillRect(x - lw / 2, 0, lw, h * 0.7);
      g.fillStyle = hgray(0.95);
      g.fillRect(x - lw / 2, 0, lw, h * 0.7);
      // Twist stripes on the cord.
      for (let y = 0; y < h * 0.7; y += 5) {
        c.fillStyle = "rgba(0,0,0,0.3)";
        c.fillRect(x - lw / 2, y, lw, 1.5);
        c.fillStyle = "rgba(255,220,180,0.18)";
        c.fillRect(x - lw / 2, y + 2, lw * 0.5, 1);
        g.fillStyle = hgray(0.75);
        g.fillRect(x - lw / 2, y, lw, 1.5);
      }
      // Cord shadow edges.
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(x + lw / 2, 0, 1.5, h * 0.7);
      // Lacing hole at the cord's end.
      c.fillStyle = "#050404";
      c.beginPath();
      c.arc(x, h * 0.72, lw * 0.35, 0, Math.PI * 2);
      c.fill();
      g.fillStyle = hgray(0.1);
      g.beginPath();
      g.arc(x, h * 0.72, lw * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    // Cross-knots (hishinui) on the lowest plate.
    if (o.cross) {
      c.strokeStyle = "#e8dcc8";
      c.lineWidth = 3;
      for (let i = 0; i < cols; i += 2) {
        const x = i * cw + cw;
        c.beginPath();
        c.moveTo(x - cw * 0.5, h * 0.78);
        c.lineTo(x + cw * 0.5, h * 0.94);
        c.moveTo(x + cw * 0.5, h * 0.78);
        c.lineTo(x - cw * 0.5, h * 0.94);
        c.stroke();
      }
    }
    // Gold rim (fukurin) along the lip.
    if (o.gold) {
      c.fillStyle = "#b8893a";
      c.fillRect(0, h * 0.9, w, h * 0.1);
      c.fillStyle = "rgba(255,230,160,0.5)";
      c.fillRect(0, h * 0.9, w, 2);
    }
    void R;
  }, 3.5);
}

/** Chain mail (kusari) on dark brocade. */
export function mailSet(seed: number): TexSet {
  return texSet(256, 256, seed, (c, g, w, h, R) => {
    c.fillStyle = "#2a1f1c";
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(${R() < 0.5 ? "120,90,40" : "0,0,0"},${R() * 0.15})`;
      c.fillRect(R() * w, R() * h, 4, 4);
    }
    g.fillStyle = hgray(0.3);
    g.fillRect(0, 0, w, h);
    const s = 16;
    for (let y = 0; y < h + s; y += s / 2) {
      for (let x = ((y / (s / 2)) % 2) * (s / 2); x < w + s; x += s) {
        c.strokeStyle = "#4a4a4e";
        c.lineWidth = 2.6;
        c.beginPath();
        c.ellipse(x, y, s * 0.36, s * 0.26, 0, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = "rgba(220,220,230,0.35)";
        c.lineWidth = 1;
        c.beginPath();
        c.ellipse(x, y - 1, s * 0.34, s * 0.22, 0, Math.PI * 1.1, Math.PI * 1.9);
        c.stroke();
        g.strokeStyle = hgray(0.9);
        g.lineWidth = 2.6;
        g.beginPath();
        g.ellipse(x, y, s * 0.36, s * 0.26, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }, 4);
}

/** Leg / forearm wrappings: overlapping diagonal bands of cloth. */
export function wrapSet(cloth: string, dark: string, seed: number): TexSet {
  return texSet(128, 256, seed, (c, g, w, h, R) => {
    c.fillStyle = dark;
    c.fillRect(0, 0, w, h);
    g.fillStyle = hgray(0.2);
    g.fillRect(0, 0, w, h);
    const bw = 22;
    for (let y = -w; y < h + w; y += bw - 4) {
      const grd = c.createLinearGradient(0, y, 0, y + bw);
      grd.addColorStop(0, "rgba(0,0,0,0.5)");
      grd.addColorStop(0.2, cloth);
      grd.addColorStop(0.85, cloth);
      grd.addColorStop(1, "rgba(0,0,0,0.6)");
      c.fillStyle = grd;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y + w * 0.35);
      c.lineTo(w, y + w * 0.35 + bw);
      c.lineTo(0, y + bw);
      c.closePath();
      c.fill();
      const hg = g.createLinearGradient(0, y, 0, y + bw);
      hg.addColorStop(0, hgray(0.3));
      hg.addColorStop(0.35, hgray(0.8));
      hg.addColorStop(1, hgray(0.45));
      g.fillStyle = hg;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + w * 0.35);
      g.lineTo(w, y + w * 0.35 + bw);
      g.lineTo(0, y + bw);
      g.closePath();
      g.fill();
    }
    for (let i = 0; i < 300; i++) {
      c.fillStyle = `rgba(0,0,0,${R() * 0.12})`;
      c.fillRect(R() * w, R() * h, 2 + R() * 6, 1);
    }
  }, 3);
}

/** Skin: warm base with subtle pores and blotches. */
export function skinSet(base: string, seed: number): TexSet {
  return texSet(256, 256, seed, (c, g, w, h, R) => {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 180; i++) {
      c.fillStyle = `rgba(${R() < 0.5 ? "120,40,30" : "60,40,30"},${R() * 0.06})`;
      c.beginPath();
      c.arc(R() * w, R() * h, 4 + R() * 18, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = hgray(0.4 + R() * 0.2, 0.6);
      g.fillRect(R() * w, R() * h, 1, 1);
    }
  }, 1.2);
}

/** Lacquer / iron: dark with hammer marks and rust bloom. */
export function ironSet(base: string, seed: number, o: { rivets?: number; rust?: number } = {}): TexSet {
  return texSet(256, 256, seed, (c, g, w, h, R) => {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = R() * w, y = R() * h, s = 3 + R() * 10;
      g.fillStyle = hgray(0.42 + R() * 0.16, 0.5);
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
      c.fillStyle = `rgba(255,255,255,${R() * 0.04})`;
      c.beginPath();
      c.arc(x, y, s, 0, Math.PI * 2);
      c.fill();
    }
    const rust = o.rust ?? 0.5;
    for (let i = 0; i < 70 * rust; i++) {
      c.fillStyle = `rgba(110,55,25,${R() * 0.18})`;
      c.beginPath();
      c.ellipse(R() * w, R() * h, 4 + R() * 20, 3 + R() * 10, R() * 3, 0, Math.PI * 2);
      c.fill();
    }
    const n = o.rivets ?? 0;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * w;
      for (const y of [h * 0.12, h * 0.88]) {
        c.fillStyle = "#c8a050";
        c.beginPath();
        c.arc(x, y, 4, 0, Math.PI * 2);
        c.fill();
        g.fillStyle = hgray(1);
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, 2.5);
}
