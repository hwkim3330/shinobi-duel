/**
 * Small verlet cloth grid in world space: the shinobi's scarf and hakama aprons, the general's
 * tattered cape and armoured skirt. The top row is pinned to anchors the rig provides every
 * step; sphere colliders keep it off the body; wind gusts push it around.
 */
import * as THREE from "three";

export interface Sphere {
  c: THREE.Vector3;
  r: number;
}

export class Cloth {
  readonly mesh: THREE.Mesh;
  readonly w: number;
  readonly h: number;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly sx: number;
  private readonly sy: number;
  private readonly anchors: THREE.Vector3[];
  private inited = false;
  /** 0..1 per row: how strongly rows follow the anchor frame (stiff armour skirts). */
  stiffness = 0;
  windScale = 1;
  gravity = 9.8;
  damping = 0.985;
  hangDir = new THREE.Vector3(0, -1, 0);

  constructor(w: number, h: number, sx: number, sy: number, material: THREE.Material) {
    this.w = w;
    this.h = h;
    this.sx = sx;
    this.sy = sy;
    this.pos = new Float32Array(w * h * 3);
    this.prev = new Float32Array(w * h * 3);
    this.anchors = Array.from({ length: w }, () => new THREE.Vector3());
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        uv.push(i / (w - 1), 1 - j / (h - 1));
        if (i < w - 1 && j < h - 1) {
          const a = j * w + i;
          idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /** Same grid, material and tuning (re-pinned onto another body). */
  clone(): Cloth {
    const c = new Cloth(this.w, this.h, this.sx, this.sy, this.mesh.material as THREE.Material);
    c.stiffness = this.stiffness;
    c.windScale = this.windScale;
    c.gravity = this.gravity;
    c.damping = this.damping;
    c.hangDir.copy(this.hangDir);
    c.mesh.castShadow = this.mesh.castShadow;
    return c;
  }

  /** Set pinned top-row anchors (world space). */
  pin(i: number, p: THREE.Vector3): void {
    this.anchors[i].copy(p);
  }

  reset(): void {
    this.inited = false;
  }

  private init(): void {
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const k = (j * this.w + i) * 3;
        const a = this.anchors[i];
        this.pos[k] = a.x + this.hangDir.x * j * this.sy;
        this.pos[k + 1] = a.y + this.hangDir.y * j * this.sy;
        this.pos[k + 2] = a.z + this.hangDir.z * j * this.sy;
        this.prev[k] = this.pos[k];
        this.prev[k + 1] = this.pos[k + 1];
        this.prev[k + 2] = this.pos[k + 2];
      }
    }
    this.inited = true;
  }

  step(dt: number, wind: THREE.Vector3, t: number, colliders: Sphere[]): void {
    if (!this.inited) this.init();
    const P = this.pos;
    const Q = this.prev;
    const W = this.w;
    const dt2 = dt * dt;
    for (let j = 1; j < this.h; j++) {
      for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 3;
        const g = 0.55 + 0.45 * Math.sin(t * 2.7 + j * 0.45 + i * 0.9) * Math.sin(t * 1.3 + i);
        const ws = this.windScale * (j / this.h) * g;
        const ax = wind.x * ws;
        const ay = -this.gravity + wind.y * ws;
        const az = wind.z * ws;
        const x = P[k];
        const y = P[k + 1];
        const z = P[k + 2];
        P[k] = x + (x - Q[k]) * this.damping + ax * dt2;
        P[k + 1] = y + (y - Q[k + 1]) * this.damping + ay * dt2;
        P[k + 2] = z + (z - Q[k + 2]) * this.damping + az * dt2;
        Q[k] = x;
        Q[k + 1] = y;
        Q[k + 2] = z;
      }
    }
    for (let i = 0; i < W; i++) {
      const a = this.anchors[i];
      P[i * 3] = Q[i * 3] = a.x;
      P[i * 3 + 1] = Q[i * 3 + 1] = a.y;
      P[i * 3 + 2] = Q[i * 3 + 2] = a.z;
    }
    for (let it = 0; it < 4; it++) {
      for (let j = 0; j < this.h; j++) {
        for (let i = 0; i < W; i++) {
          const a = j * W + i;
          if (i < W - 1) this.solve(a, a + 1, this.sx, j === 0);
          if (j < this.h - 1) this.solve(a, a + W, this.sy, j === 0);
          if (j < this.h - 2) this.solve(a, a + 2 * W, this.sy * 2, j === 0, 0.5);
        }
      }
      // Stiff rows are pulled toward where they'd hang in the anchor frame.
      if (this.stiffness > 0) {
        for (let j = 1; j < this.h; j++) {
          for (let i = 0; i < W; i++) {
            const k = (j * W + i) * 3;
            const a = this.anchors[i];
            const tx = a.x + this.hangDir.x * j * this.sy;
            const ty = a.y + this.hangDir.y * j * this.sy;
            const tz = a.z + this.hangDir.z * j * this.sy;
            const s = this.stiffness * 0.25;
            P[k] += (tx - P[k]) * s;
            P[k + 1] += (ty - P[k + 1]) * s;
            P[k + 2] += (tz - P[k + 2]) * s;
          }
        }
      }
      for (const c of colliders) {
        const r2 = c.r * c.r;
        for (let n = W; n < W * this.h; n++) {
          const k = n * 3;
          const dx = P[k] - c.c.x;
          const dy = P[k + 1] - c.c.y;
          const dz = P[k + 2] - c.c.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < r2 && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const s = (c.r - d) / d;
            P[k] += dx * s;
            P[k + 1] += dy * s;
            P[k + 2] += dz * s;
          }
        }
      }
    }
    // Never sink through the roof.
    for (let n = W; n < W * this.h; n++) {
      if (P[n * 3 + 1] < 0.08) P[n * 3 + 1] = 0.08;
    }
  }

  private solve(a: number, b: number, rest: number, pinA: boolean, k = 1): void {
    const P = this.pos;
    const ia = a * 3;
    const ib = b * 3;
    const dx = P[ib] - P[ia];
    const dy = P[ib + 1] - P[ia + 1];
    const dz = P[ib + 2] - P[ia + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = ((d - rest) / d) * k;
    const pinB = b < this.w;
    if (pinA && pinB) return;
    if (pinA) {
      P[ib] -= dx * diff;
      P[ib + 1] -= dy * diff;
      P[ib + 2] -= dz * diff;
    } else if (pinB) {
      P[ia] += dx * diff;
      P[ia + 1] += dy * diff;
      P[ia + 2] += dz * diff;
    } else {
      P[ia] += dx * diff * 0.5;
      P[ia + 1] += dy * diff * 0.5;
      P[ia + 2] += dz * diff * 0.5;
      P[ib] -= dx * diff * 0.5;
      P[ib + 1] -= dy * diff * 0.5;
      P[ib + 2] -= dz * diff * 0.5;
    }
  }

  updateMesh(): void {
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
