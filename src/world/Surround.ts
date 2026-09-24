/**
 * Between the rooftop and the mountains (the compound, turrets and pines are in arena.glb):
 * drifting mist banks at several depths that drown the courtyard, and a sun disc mesh that drives
 * the god-ray pass.
 */
import * as THREE from "three";
import { SUN_DIR } from "./materials";

const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uCold;
uniform vec3 uWarm;
uniform float uAlpha;
uniform float uScale;
uniform float uInner;
varying vec3 vW;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.02 + 1.7; a *= 0.5; } return s; }
void main() {
  vec2 p = vW.xz * uScale + vec2(uTime * 0.012, uTime * 0.004);
  float n = fbm(p + fbm(p * 0.7 - uTime * 0.01) * 1.4);
  float d = length(vW.xz);
  float inner = smoothstep(uInner, uInner * 1.6, d);
  float a = smoothstep(0.3, 0.75, n) * uAlpha * inner;
  vec3 v = normalize(vW - cameraPosition);
  float s = pow(max(dot(normalize(v.xz), normalize(uSun.xz)), 0.0), 3.0);
  vec3 c = mix(uCold, uWarm, s) * (0.75 + n * 0.5);
  gl_FragColor = vec4(c, a);
}`;

const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uCold;
uniform vec3 uWarm;
uniform float uAlpha;
varying vec3 vW;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.02 + 1.7; a *= 0.5; } return s; }
void main() {
  vec2 p = vec2(vUv.x * 40.0 + uTime * 0.01, vUv.y * 3.0);
  float n = fbm(p);
  float fade = (1.0 - smoothstep(0.15, 0.95, vUv.y)) * smoothstep(0.0, 0.08, vUv.y);
  float a = clamp(n * 1.4 - 0.25, 0.0, 1.0) * fade * uAlpha;
  vec3 v = normalize(vW - cameraPosition);
  float s = pow(max(dot(normalize(v.xz), normalize(uSun.xz)), 0.0), 2.5);
  gl_FragColor = vec4(mix(uCold, uWarm, s) * (0.8 + n * 0.4), a);
}`;

const VERT = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export class Surround {
  readonly group = new THREE.Group();
  readonly sunMesh: THREE.Mesh;
  private readonly mists: THREE.ShaderMaterial[] = [];

  constructor() {
    const g = this.group;
    // ---------------------------------------------------------------- mist
    const sun = SUN_DIR.clone();
    const mist = (y: number, size: number, alpha: number, scale: number, inner: number, cold: number[], warm: number[]) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSun: { value: sun },
          uCold: { value: new THREE.Color(...cold) },
          uWarm: { value: new THREE.Color(...warm) },
          uAlpha: { value: alpha },
          uScale: { value: scale },
          uInner: { value: inner },
        },
        vertexShader: VERT,
        fragmentShader: MIST_FRAG,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.renderOrder = 2;
      g.add(mesh);
      this.mists.push(mat);
    };
    mist(-24, 900, 0.95, 0.018, 24, [0.27, 0.26, 0.34], [0.95, 0.52, 0.34]);
    mist(-18, 700, 0.6, 0.03, 30, [0.3, 0.29, 0.37], [1.0, 0.56, 0.37]);
    mist(-12, 500, 0.34, 0.045, 38, [0.33, 0.32, 0.4], [1.05, 0.6, 0.4]);
    // Thin sheet just under the eaves: mist between the roof and the compound.
    mist(-6, 360, 0.2, 0.06, 20, [0.36, 0.34, 0.42], [1.1, 0.64, 0.44]);
    const curtain = (r: number, h: number, y: number, alpha: number) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSun: { value: sun },
          uCold: { value: new THREE.Color(0.3, 0.28, 0.36) },
          uWarm: { value: new THREE.Color(1.05, 0.58, 0.4) },
          uAlpha: { value: alpha },
        },
        vertexShader: VERT,
        fragmentShader: CURTAIN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 64, 1, true), mat);
      mesh.position.y = y + h / 2;
      mesh.renderOrder = 1;
      g.add(mesh);
      this.mists.push(mat);
    };
    curtain(150, 36, -28, 0.32);
    curtain(300, 62, -32, 0.36);
    curtain(560, 140, -40, 0.55);

    // ---------------------------------------------------------------- sun disc for god rays
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(38, 24, 16),
      // Same white-gold as the sky's disc so the two never read as a dull disc inside a halo; the
      // god-ray pass clamps its samples at 1.0, so the rays barely change.
      new THREE.MeshBasicMaterial({ color: new THREE.Color(14.0, 12.4, 8.9), fog: false, transparent: true, depthWrite: false }),
    );
    this.sunMesh.position.copy(SUN_DIR).multiplyScalar(1100);
    this.sunMesh.frustumCulled = false;
    g.add(this.sunMesh);
  }

  update(t: number): void {
    for (const m of this.mists) m.uniforms.uTime.value = t;
  }
}
