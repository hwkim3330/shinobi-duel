/**
 * Shared building blocks for the two fighters: procedural fabric / lacquer / wrap textures,
 * the katana, and small geometry helpers (limb pieces grown along +Y, lathe shells).
 */
import * as THREE from "three";
import { rng } from "../core/math";
import { canvasTexture, rimLit } from "../world/materials";

export function weave(base: string, seed: number, opts: { stripes?: number; dark?: number } = {}): THREE.CanvasTexture {
  const R = rng(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // Fine cross weave.
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.06})`;
      g.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = `rgba(255,255,255,${0.02 + R() * 0.03})`;
      g.fillRect(x, 0, 1, h);
    }
    // Mottled wear, dirt at the bottom.
    for (let i = 0; i < 220; i++) {
      const s = 4 + R() * 26;
      g.fillStyle = `rgba(${R() < 0.5 ? "0,0,0" : "255,240,220"},${0.02 + R() * 0.05})`;
      g.beginPath();
      g.ellipse(R() * w, R() * h, s, s * (0.3 + R()), R() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const n = opts.stripes ?? 0;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w + R() * 3;
      g.fillStyle = `rgba(0,0,0,${opts.dark ?? 0.28})`;
      g.fillRect(x, 0, 2 + R() * 2, h);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + 3, 0, 2, h);
    }
  });
}

/** Horizontal lamellar rows (kozane) with laced cord (odoshi). */
export function lamellar(lacquer: string, lace: string, seed: number, rows = 6): THREE.CanvasTexture {
  const R = rng(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = lacquer;
    g.fillRect(0, 0, w, h);
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      // Plate shading: lit top edge, dark bottom lip.
      const grd = g.createLinearGradient(0, y, 0, y + rh);
      grd.addColorStop(0, "rgba(255,255,255,0.16)");
      grd.addColorStop(0.2, "rgba(255,255,255,0.03)");
      grd.addColorStop(0.85, "rgba(0,0,0,0.12)");
      grd.addColorStop(1, "rgba(0,0,0,0.55)");
      g.fillStyle = grd;
      g.fillRect(0, y, w, rh);
      // Vertical lacing cords.
      g.fillStyle = lace;
      for (let x = 6; x < w; x += 16) {
        g.fillRect(x + R() * 1.5, y + rh * 0.12, 4, rh * 0.62);
        g.fillRect(x - 3, y + rh * 0.3, 10, 2.5);
      }
      // Small kozane scale ticks.
      g.fillStyle = "rgba(0,0,0,0.35)";
      for (let x = 0; x < w; x += 8) g.fillRect(x, y + rh * 0.78, 1, rh * 0.2);
    }
  });
}

export function wrapTexture(cloth: string, under: string): THREE.CanvasTexture {
  return canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = under;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = cloth;
    g.lineWidth = 7;
    for (let y = -w; y < h + w; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + w * 0.7);
      g.stroke();
      g.beginPath();
      g.moveTo(w, y);
      g.lineTo(0, y + w * 0.7);
      g.stroke();
    }
  });
}

export function bands(base: string, line: string, n: number): THREE.CanvasTexture {
  return canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = line;
    for (let i = 0; i < n; i++) {
      const y = (i / n) * h;
      g.fillRect(0, y, w, 2);
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(0, y + 3, w, 3);
      g.fillStyle = line;
    }
  });
}

export function std(p: THREE.MeshStandardMaterialParameters, rim = 1): THREE.MeshStandardMaterial {
  return rimLit(new THREE.MeshStandardMaterial(p), rim);
}

/** A tapered piece grown along +Y from y0 to y1. */
export function piece(r0: number, r1: number, y0: number, y1: number, mat: THREE.Material, seg = 12, sz = 1): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1);
  g.translate(0, (y0 + y1) / 2, 0);
  g.scale(1, 1, sz);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Lathe from (radius, y) pairs, optionally flattened front-back. */
export function lathe(profile: [number, number][], mat: THREE.Material, seg = 20, sz = 1, sx = 1): THREE.Mesh {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.scale(sx, 1, sz);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export function ball(r: number, mat: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const g = new THREE.SphereGeometry(r, 16, 12);
  g.scale(sx, sy, sz);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export function box(x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat);
  m.castShadow = true;
  return m;
}

/**
 * Katana in sword space: grip at the origin, blade along +Y starting at `tsuba`, cutting edge
 * toward +Z. Curvature (sori) bends the tip toward the spine.
 */
export function katana(tsuba: number, blade: number, opts: { tsukaColor: string; tsubaGold?: boolean; sori?: number }): THREE.Group {
  const g = new THREE.Group();
  const N = 28;
  const W = 0.032;
  const T = 0.0075;
  const sori = opts.sori ?? 0.022;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  // Four faces: edge-right, right-spine, spine-left, left-edge (flat shaded strips).
  const cross = (u: number): [number, number][] => {
    const taper = 1 - u * 0.28;
    const kissaki = u > 0.93 ? (u - 0.93) / 0.07 : 0;
    const w = W * taper * (1 - kissaki * 0.98);
    const t = T * taper * (1 - kissaki * 0.9);
    return [
      [0, w * 0.55],
      [t / 2, -w * 0.05],
      [0, -w * 0.45],
      [-t / 2, -w * 0.05],
    ];
  };
  const faceCol = [
    [1.0, 1.0, 1.04],
    [0.72, 0.74, 0.8],
    [0.6, 0.62, 0.68],
    [0.72, 0.74, 0.8],
  ];
  for (let f = 0; f < 4; f++) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = tsuba + u * blade;
      const zc = -sori * u * u;
      const cs = cross(u);
      const a = cs[f];
      const b = cs[(f + 1) % 4];
      pos.push(a[0], y, zc + a[1], b[0], y, zc + b[1]);
      const c = faceCol[f];
      const hamon = f === 0 || f === 3 ? 1 : 0.95;
      col.push(c[0] * hamon, c[1] * hamon, c[2] * hamon, c[0], c[1], c[2]);
      if (i < N) {
        const k = base + i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  bg.setIndex(idx);
  bg.computeVertexNormals();
  const steel = new THREE.MeshStandardMaterial({
    color: 0xe4e8ef,
    metalness: 1,
    roughness: 0.2,
    vertexColors: true,
    side: THREE.DoubleSide,
    envMapIntensity: 1.6,
  });
  const bladeMesh = new THREE.Mesh(bg, steel);
  bladeMesh.castShadow = true;
  g.add(bladeMesh);

  const tsukaTex = wrapTexture(opts.tsukaColor, "#d8d0c0");
  tsukaTex.repeat.set(1, 1.6);
  const tsukaMat = std({ map: tsukaTex, roughness: 0.85 }, 0.6);
  const handleLen = 0.26;
  const tsuka = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0155, handleLen, 10), tsukaMat);
  tsuka.scale.set(0.8, 1, 1.1);
  tsuka.position.y = tsuba - handleLen / 2 - 0.006;
  g.add(tsuka);
  const gold = std({ color: 0xb08a3e, metalness: 1, roughness: 0.35 }, 0.5);
  const iron = std({ color: 0x1c1b1c, metalness: 0.8, roughness: 0.45 }, 0.5);
  const kashira = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.015, 0.018, 10), iron);
  kashira.scale.set(0.85, 1, 1.1);
  kashira.position.y = tsuba - handleLen - 0.012;
  g.add(kashira);
  const tsubaG = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.008, 20), opts.tsubaGold ? gold : iron);
  tsubaG.scale.set(0.9, 1, 1.05);
  tsubaG.position.y = tsuba - 0.002;
  g.add(tsubaG);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.0035, 6, 24), gold);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = tsuba - 0.002;
  g.add(rim);
  const habaki = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.028, 0.036), gold);
  habaki.position.set(0, tsuba + 0.016, 0.001);
  g.add(habaki);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Tube along a curve whose radius tapers from r0 to r1 (helmet horns). */
export function taperTube(points: THREE.Vector3[], r0: number, r1: number, mat: THREE.Material, flat = 1): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const TS = 24;
  const RS = 8;
  const geo = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= TS; i++) {
    const u = i / TS;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= RS; j++) {
      const k = i * (RS + 1) + j;
      v.fromBufferAttribute(p, k).sub(c);
      v.multiplyScalar(r);
      v.z *= flat;
      p.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}
