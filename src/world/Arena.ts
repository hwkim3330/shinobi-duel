/**
 * The one arena: a castle rooftop at dusk.
 *
 * Built in Blender (tools/blender/build_arena.py) from Poly Haven CC0 textures and shipped as
 * public/assets/arena.glb (WebP textures, meshopt geometry, baked AO):
 *   fighting floor  26 m square of dark clay round tiles with snow in the channels
 *   ridge beam      raised ridge + onigawara end tiles along the far (-z) edge
 *   eaves           upturned skirts on the other three edges, the building dropping away below
 *   keep            five-tier keep (each tier ~0.82x the one below), curved roofs with snow slabs
 *   compound        halls, turrets and walls on stone bases stepping down, snowy pines
 *   lanterns        paper lanterns on posts (nodes LanternHang_NN, "_L" = carries a point light)
 * In code: the dusk sky (procedural clouds / sun / haze over the Poly Haven HDRI), distant mountains,
 * mist (Surround), the lights, and the lantern swing / flicker.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { rng } from "../core/math";
import { canvasTexture, LIGHT_DIR, SUN_DIR, snowify, type SnowOpts } from "./materials";
import { Surround } from "./Surround";

export const ARENA_HALF = 11.2;
export const RIDGE_Z = -13.2;

const ASSETS = `${import.meta.env.BASE_URL}assets/`;
/** qwantani_dusk_2_puresky: the afterglow sits at u = 0.6 of the equirect. */
const HDR_SUN_U = 0.6;
/** Rotation (about +y, in equirect-angle terms) that puts the HDRI's glow behind the game's sun. */
const HDR_ROT = 2 * Math.PI * (HDR_SUN_U - 0.5) - Math.atan2(SUN_DIR.z, SUN_DIR.x);

const SKY_GLSL = /* glsl */ `
uniform vec3 uSun;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
// Dusk palette (scene-linear): mauve sky #a18b86, warm band #c79682 toward the sun, cold
// blue-violet away from it.
vec3 horizonCol(vec3 d) {
  vec2 hz = normalize(d.xz + 1e-5);
  float toward = max(dot(hz, normalize(uSun.xz)), 0.0);
  vec3 c = mix(vec3(0.15, 0.155, 0.23), vec3(0.34, 0.25, 0.24), smoothstep(-0.6, 0.5, dot(hz, normalize(uSun.xz))));
  return mix(c, vec3(0.66, 0.33, 0.22), pow(toward, 4.0));
}
#ifdef SKY_HDR
uniform sampler2D uHdr;
uniform float uHdrRot;
uniform float uHdrGain;
uniform float uHdrMix;
vec3 hdrSky(vec3 d) {
  float c = cos(uHdrRot), s = sin(uHdrRot);
  vec3 r = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
  vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return texture2D(uHdr, uv).rgb * uHdrGain;
}
#endif
vec3 skyCol(vec3 d, bool clouds) {
  float y = d.y;
  float s = max(dot(d, uSun), 0.0);
  vec3 hor = horizonCol(d);
  vec3 c = mix(hor, vec3(0.24, 0.18, 0.2), smoothstep(0.0, 0.3, y));
  c = mix(c, vec3(0.065, 0.065, 0.11), smoothstep(0.22, 0.8, y));
#ifdef SKY_HDR
  // The photographed dusk gradient (mauve zenith, peach afterglow) under the painted clouds.
  c = mix(c, hdrSky(d), uHdrMix * smoothstep(-0.02, 0.06, y));
#endif
  c = mix(c, hor * 0.85, (1.0 - smoothstep(-0.12, 0.0, y)));
  // Huge low sun behind haze: a wide peach bloom around a compact hot core.
  c += vec3(1.2, 0.62, 0.34) * pow(s, 24.0) * 1.1 + vec3(0.62, 0.33, 0.2) * pow(s, 6.0) * 0.5 + vec3(0.12, 0.06, 0.04) * pow(s, 2.0);
  // Pale-gold disc #fef2d1 with a crisp edge, several times the halo so it reads as the sun.
  float disk = smoothstep(0.99615, 0.99645, s);
  c = mix(c, vec3(14.0, 12.4, 8.9), disk);
  if (clouds) {
    float az = atan(d.x, d.z);
    float band = smoothstep(-0.01, 0.04, y) * (1.0 - smoothstep(0.1, 0.24, y));
    float cl = fbm(vec2(az * 5.0, y * 70.0)) * fbm(vec2(az * 13.0 + 3.1, y * 26.0));
    cl = smoothstep(0.16, 0.5, cl) * band;
    float glow = pow(s, 10.0);
    vec3 cc = mix(vec3(0.15, 0.13, 0.19), vec3(1.3, 0.6, 0.32), glow * 0.9 + pow(s, 3.0) * 0.25);
    c = mix(c, cc, cl * 0.88);
    // Silver lining at cloud edges near the sun.
    c += vec3(2.5, 1.1, 0.5) * glow * cl * (1.0 - cl) * 2.0;
    // High cloud deck: wind-combed streaks lit pink-orange toward the sun, lavender away.
    if (y > 0.02) {
      vec2 q = d.xz / (y + 0.06);
      float hc = fbm(q * vec2(0.9, 2.6) + vec2(3.0, 0.0)) * fbm(q * vec2(2.2, 5.5) - 1.3);
      hc = smoothstep(0.18, 0.46, hc) * smoothstep(0.02, 0.1, y) * (1.0 - smoothstep(0.45, 0.8, y));
      float sw = pow(max(dot(normalize(d.xz), normalize(uSun.xz)), 0.0), 2.0);
      vec3 hcc = mix(vec3(0.17, 0.135, 0.165), vec3(0.44, 0.29, 0.25), sw * (1.0 - smoothstep(0.08, 0.45, y)) * 0.85 + glow * 0.6);
      hcc *= 0.75 + fbm(q * 4.0) * 0.5;
      c = mix(c, hcc, hc * 0.7);
    }
    // Low haze bank that swallows the bottom of the sun.
    float haze = 1.0 - smoothstep(-0.02, 0.05, y);
    c = mix(c, hor * 1.05 + vec3(0.8, 0.4, 0.22) * glow, haze * 0.8);
  }
  return c;
}
`;

function makeSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uHdr: { value: null },
      uHdrRot: { value: HDR_ROT },
      uHdrGain: { value: 0.16 },
      uHdrMix: { value: 0 },
    },
    defines: { SKY_HDR: "" },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() { gl_FragColor = vec4(skyCol(normalize(vDir), true), 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  // A 1x1 stand-in until the HDRI arrives, so the sampler is always bound.
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  mat.uniforms.uHdr.value = blank;
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

function makeMountains(): THREE.Group {
  const g = new THREE.Group();
  const layers = [
    { r: 1050, h: 190, base: 40, dark: [0.1, 0.1, 0.16], haze: 0.72, seed: 3 },
    { r: 640, h: 120, base: 10, dark: [0.07, 0.075, 0.12], haze: 0.5, seed: 11 },
    { r: 330, h: 62, base: -6, dark: [0.04, 0.045, 0.07], haze: 0.22, seed: 29 },
  ];
  // A saddle in every range where the sun sets, so the huge low disc sits in the haze between peaks.
  const sunAz = Math.atan2(SUN_DIR.x, SUN_DIR.z);
  for (const L of layers) {
    const N = 360;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const R = rng(L.seed);
    const ph = [R() * 6, R() * 6, R() * 6, R() * 6, R() * 6];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      let h =
        Math.sin(a * 3 + ph[0]) * 0.35 +
        Math.sin(a * 7 + ph[1]) * 0.25 +
        Math.abs(Math.sin(a * 13 + ph[2])) * 0.25 +
        Math.abs(Math.sin(a * 29 + ph[3])) * 0.1 +
        Math.sin(a * 61 + ph[4]) * 0.04;
      const da = Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz));
      h = L.base + (0.35 + h * 0.65) * L.h * (1 - 0.92 * Math.exp(-((da / 0.2) ** 2)));
      const x = Math.sin(a) * L.r;
      const z = Math.cos(a) * L.r;
      pos.push(x, -60, z, x, h, z);
      uv.push(i / N, 0, i / N, 1);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN_DIR.clone() } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying float vY;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW; varying float vY;
        ${SKY_GLSL}
        void main() {
          vec3 d = normalize(vW - cameraPosition);
          // Haze toward the horizon tint plus a soft round sun glow; sampling skyCol at a fixed
          // elevation would smear the sun disc into a vertical pillar.
          float sg = max(dot(d, uSun), 0.0);
          vec3 hz = horizonCol(d) * 0.92 + vec3(0.7, 0.3, 0.13) * pow(sg, 5.0) * 0.55 + vec3(1.2, 0.5, 0.2) * pow(sg, 40.0) * 0.5;
          float s = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 4.0);
          vec3 dark = vec3(${L.dark.join(",")});
          // Snowy upper slopes catch cold sky light where they face away from the sun.
          float snow = smoothstep(${(L.base + L.h * 0.35).toFixed(1)}, ${(L.base + L.h * 0.9).toFixed(1)}, vY + n2(vW.xz * 0.02) * ${(L.h * 0.3).toFixed(1)});
          vec3 lit = mix(dark, vec3(0.2, 0.22, 0.32), snow * (1.0 - s) * 0.8);
          // Thinner haze on the sun-averted side so the far ranges keep layered cold silhouettes.
          float haze = ${L.haze.toFixed(2)} * (0.72 + 0.28 * s) + (1.0 - smoothstep(-40.0, ${(L.base + L.h).toFixed(1)}, vY)) * 0.25;
          vec3 c = mix(lit, hz, clamp(haze, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.DoubleSide,
      fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}

/** Snow-shader settings per glTF material (the tuned look of the procedural arena). */
const SNOW_ALBEDO = new THREE.Color(0.52, 0.57, 0.7);
const SNOW: Record<string, SnowOpts> = {
  clay_tiles: { amount: 0.58, scale: 0.3, patch: 2.8, far: [12, 26], color: new THREE.Color(0.44, 0.48, 0.6) },
  kawara: { amount: 0.3, scale: 0.35 },
  stone: { amount: 0.6, scale: 0.4 },
  wood_dark: { amount: 0.7 },
  lacquer: { amount: 0.9 },
  pine_needles: { amount: 0.6, scale: 0.9 },
};

export interface Lantern {
  group: THREE.Object3D;
  phase: number;
  light?: THREE.PointLight;
  mat: THREE.MeshStandardMaterial;
  /** Rest orientation; the swing is applied on top. */
  rest: THREE.Quaternion;
}

/** Lantern paper emissive (blooms above the 0.9 threshold) and the warm pool it throws. */
const LANTERN = { paper: 4.2, light: 16 };

/**
 * The fighters' rigid attachments (armour, helmet crest, hat, swords) hang off bones as plain
 * meshes, so they miss the USE_SKINNING rim. Everything under a skinned body's root gets the
 * CHAR_RIM define instead (one recompile when a character appears; character code untouched).
 */
function tagCharacterRim(scene: THREE.Scene): void {
  const roots = new Set<THREE.Object3D>();
  scene.traverse((o) => {
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    let r: THREE.Object3D = o;
    while (r.parent && r.parent !== scene) r = r.parent;
    roots.add(r);
  });
  for (const r of roots) {
    r.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
        mat.defines ??= {};
        if ("CHAR_RIM" in mat.defines) continue;
        mat.defines.CHAR_RIM = "";
        mat.needsUpdate = true;
      }
    });
  }
}

const _swing = new THREE.Quaternion();
const _euler = new THREE.Euler();

export class Arena {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly lanterns: Lantern[] = [];
  readonly surround: Surround;
  /** True once arena.glb and the sky HDRI are in the scene. */
  loaded = false;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private t = 0;
  private rimScan = 0;

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.group);
    scene.background = new THREE.Color(0x3a3440);
    // Mauve dusk haze (the sky's horizon colour), warmed toward the sun in the fog chunk.
    scene.fog = new THREE.FogExp2(0x6e6270, 0.0072);

    this.sky = makeSky();
    this.group.add(this.sky);
    this.group.add(makeMountains());
    this.surround = new Surround();
    this.group.add(this.surround.group);

    // Lights: low orange sun behind the boss (key from behind = rim on both fighters), cold
    // blue sky and front fill so the shadow side is blue, never black or grey.
    this.sun = new THREE.DirectionalLight(0xff9d5c, 6.2);
    this.sun.position.copy(LIGHT_DIR).multiplyScalar(40);
    this.sun.castShadow = true;
    // One 4k map over the rooftop (~1 cm texels): crisp contact under the feet, and the Vogel-disk
    // PCF radius softens the edges the way a hazy low sun does.
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -17;
    sc.right = 17;
    sc.top = 17;
    sc.bottom = -17;
    sc.near = 10;
    sc.far = 75;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.add(new THREE.HemisphereLight(0x5f6c96, 0x262c3e, 0.5));
    // Cold front fill: the camera usually looks into the sun, so this is what shapes the
    // fighters' visible sides (cold blue shadow side, warm rim from the sun behind).
    const fill = new THREE.DirectionalLight(0x93a3d6, 0.8);
    fill.position.set(-9, 6, 20);
    scene.add(fill);
  }

  /** Loads the Blender-built rooftop and the dusk HDRI (sky gradient + image-based lighting). */
  async load(renderer: THREE.WebGLRenderer): Promise<void> {
    const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [gltf, hdr] = await Promise.all([
      gltfLoader.loadAsync(`${ASSETS}arena.glb`),
      new HDRLoader().loadAsync(`${ASSETS}sky_dusk.hdr`),
    ]);

    const root = gltf.scene;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const patched = new Set<THREE.Material>();
    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const mesh = o as THREE.Mesh;
      const near = /^Roof_|^Lantern/.test(mesh.name) || /^Lantern/.test(mesh.parent?.name ?? "");
      // Only the rooftop sits inside the sun's shadow frustum; the floor tiles and snow receive
      // but don't cast (they're flat and 250k triangles).
      mesh.receiveShadow = near;
      mesh.castShadow = near && !/_clay|_snow/.test(mesh.name);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const mat = m as THREE.MeshStandardMaterial;
        if (patched.has(mat)) continue;
        patched.add(mat);
        for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap, mat.emissiveMap]) if (tex) tex.anisotropy = aniso;
        // Baked copies are named "<material>__<object>".
        const base = mat.name.split("__")[0];
        const snow = SNOW[base];
        if (snow) snowify(mat, snow);
        // Snow a little below white and cold: it takes the orange sun and the blue sky, and
        // stays under the bloom threshold instead of washing the rooftop out.
        if (base === "snow") mat.color.copy(SNOW_ALBEDO);
      }
    });

    // Lanterns: each swinging part gets its own paper material so they flicker out of step.
    const R = rng(17);
    const hangs: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (/^LanternHang_\d+/.test(o.name)) hangs.push(o);
    });
    hangs.sort((a, b) => a.name.localeCompare(b.name));
    const haloMat = new THREE.SpriteMaterial({
      map: canvasTexture(64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, "rgba(255,255,255,1)");
        gr.addColorStop(0.25, "rgba(255,255,255,0.45)");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }),
      color: new THREE.Color(1.0, 0.46, 0.17).multiplyScalar(0.55),
      // Additive glow: fogging it toward the haze colour would brighten the mist, not dim the halo.
      fog: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    for (const hang of hangs) {
      let mat: THREE.MeshStandardMaterial | null = null;
      hang.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m.name === "lantern_paper") {
          if (!mat) {
            mat = m.clone();
            // Candle-warm paper: glTF exports the emissive as the white-balanced texture.
            mat.emissive.set(0xff9a45);
          }
          mesh.material = mat;
        }
      });
      if (!mat) continue;
      // Soft glow around the paper (the bloom pass adds the tight core).
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(1.5);
      halo.position.y = -0.3;
      halo.renderOrder = 5;
      hang.add(halo);
      const L: Lantern = { group: hang, phase: R() * 6, mat, rest: hang.quaternion.clone() };
      if (hang.name.endsWith("_L")) {
        const pl = new THREE.PointLight(0xff8a3c, LANTERN.light, 13, 1.35);
        pl.position.y = -0.45;
        hang.add(pl);
        L.light = pl;
      }
      this.lanterns.push(L);
    }
    this.group.add(root);

    // Sky gradient + IBL from the HDRI, rotated so its afterglow sits behind the game's sun.
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.minFilter = hdr.magFilter = THREE.LinearFilter;
    hdr.generateMipmaps = false;
    this.sky.material.uniforms.uHdr.value = hdr;
    this.sky.material.uniforms.uHdrMix.value = 0.45;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    pmrem.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = env;
    this.scene.environmentRotation.set(0, HDR_ROT, 0);
    this.scene.environmentIntensity = 0.16;
    this.loaded = true;
  }

  /** Give the fighters' rigid attachments the character rim (see tagCharacterRim). */
  tagCharacterRim(): void {
    tagCharacterRim(this.scene);
  }

  update(dt: number, wind: number): void {
    this.t += dt;
    this.surround.update(this.t);
    // Fallback for bodies that appear after start-up (main.ts tags them before the shader warm-up).
    this.rimScan -= dt;
    if (this.rimScan <= 0) {
      this.rimScan = 1;
      this.tagCharacterRim();
    }
    for (const L of this.lanterns) {
      const k = 0.6 + wind;
      _euler.set(Math.sin(this.t * 1.3 + L.phase) * 0.07 * k, 0, Math.sin(this.t * 0.9 + L.phase * 2) * 0.05 * k);
      L.group.quaternion.copy(L.rest).multiply(_swing.setFromEuler(_euler));
      const flick = 1 + Math.sin(this.t * 11 + L.phase * 5) * 0.04 + Math.sin(this.t * 23 + L.phase) * 0.03;
      L.mat.emissiveIntensity = LANTERN.paper * flick;
      if (L.light) L.light.intensity = LANTERN.light * flick;
    }
  }
}
