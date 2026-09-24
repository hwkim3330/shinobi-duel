/**
 * Shared shader patches:
 *   - fog: exponential fog tinted toward the sun, plus low-lying mist below the roof line so
 *     the courtyard and the keep's stone base drown in haze (installed once, globally)
 *   - snowify: world-up surfaces gather noisy snow (roofs, ridge, lantern caps, shoulders)
 *   - rimLit: warm fresnel rim from the low sun behind the fighters, the painterly edge light
 */
import * as THREE from "three";

export const SUN_DIR = new THREE.Vector3(-0.3, 0.075, -1).normalize();
/** Light direction is a little higher than the visible sun so shadows stay readable. */
export const LIGHT_DIR = new THREE.Vector3(-0.72, 0.3, -0.62).normalize();

const v3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

export function installFog(): void {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogDir;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // World-space camera→vertex from the view-space position (rotation part is orthonormal, so
  // v * M is the inverse rotation). Sprites / points have no 'transformed'; every shader has mvPosition.
  vFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogD = normalize(vFogDir);
  float fogH = vFogDir.y + cameraPosition.y;
  // Height mist: the courtyard below the roof line drowns in haze (thicker the lower it goes).
  float mist = (1.0 - exp(-length(vFogDir) * 0.022)) * (1.0 - smoothstep(-18.0, -0.5, fogH));
  fogFactor = max(fogFactor, mist * 0.95);
  float fogSun = pow(max(dot(fogD, ${v3(SUN_DIR)}), 0.0), 4.0);
  // Warm band #c79682 toward the sun, a hot core right around it (in-scattering).
  vec3 fogC = mix(fogColor, vec3(0.62, 0.34, 0.24), fogSun * 0.75) + vec3(0.5, 0.24, 0.1) * pow(fogSun, 6.0) * 0.6;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif`;
  installSkinRim();
}

/** Tuned edge light on the skinned fighters (see TASKS.md "Lighting pass"). */
export const SKIN_RIM = { sun: 0.62, sky: 0.22, sunPow: 2.6 };

/**
 * Sekiro-style separation for every skinned body, done in the light loop (the character code is
 * untouched): grazing edges that face the shadowed sun (directional light 0, three sorts shadowed
 * lights first) take its orange light, strongest when the sun is behind the fighter; edges facing
 * away take the cold sky. Adds to direct diffuse, so fog, AO and the grade treat it like light.
 */
function installSkinRim(): void {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.lights_fragment_end.includes("SKIN_RIM")) return;
  C.lights_fragment_end += /* glsl */ `
#if ( defined( USE_SKINNING ) || defined( CHAR_RIM ) ) && NUM_DIR_LIGHTS > 0
  { // SKIN_RIM
    float rimF = 1.0 - saturate(dot(geometryNormal, geometryViewDir));
    vec3 rimL = directionalLights[0].direction;
    float rimBack = saturate(dot(-geometryViewDir, rimL) * 0.5 + 0.5);
    float rimSide = smoothstep(-0.25, 0.55, dot(geometryNormal, rimL));
    vec3 rimTint = mix(material.diffuseColor, vec3(0.6), 0.65);
    reflectedLight.directDiffuse += directionalLights[0].color * rimTint * pow(rimF, ${SKIN_RIM.sunPow.toFixed(1)})
      * rimSide * (0.3 + 0.7 * rimBack) * ${SKIN_RIM.sun.toFixed(3)};
    reflectedLight.directDiffuse += vec3(0.35, 0.45, 0.8) * rimTint * pow(rimF, 2.5) * (1.0 - rimSide)
      * saturate(geometryNormal.y * 0.5 + 0.6) * ${SKIN_RIM.sky.toFixed(3)};
  }
#endif`;
}

const NOISE_GLSL = /* glsl */ `
float snH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float snNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(snH(i), snH(i + vec3(1,0,0)), f.x), mix(snH(i + vec3(0,1,0)), snH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(snH(i + vec3(0,0,1)), snH(i + vec3(1,0,1)), f.x), mix(snH(i + vec3(0,1,1)), snH(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export interface SnowOpts {
  /** 0..1 how much snow sticks. */
  amount?: number;
  /** noise frequency (1/m). */
  scale?: number;
  /** snow albedo (linear). */
  color?: THREE.Color;
  /** Noise weight on coverage: higher = patchier (bare tile between drifts). */
  patch?: number;
  /** Fade fine detail to a flat averaged albedo with distance [near, far] m (kills moiré). */
  far?: [number, number];
}

export function snowify<T extends THREE.MeshStandardMaterial>(mat: T, opts: SnowOpts = {}): T {
  const amount = opts.amount ?? 0.8;
  const scale = opts.scale ?? 1.3;
  const col = opts.color ?? new THREE.Color(0.78, 0.82, 0.9);
  const patch = opts.patch ?? 0.9;
  const far = opts.far;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 snWp = vec4(transformed, 1.0);
        vec3 snN = objectNormal;
        #ifdef USE_INSTANCING
          snWp = instanceMatrix * snWp;
          snN = mat3(instanceMatrix) * snN;
        #endif
        vSnowW = (modelMatrix * snWp).xyz;
        vSnowN = normalize(mat3(modelMatrix) * snN);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;\nfloat snowAmt = 0.0;\n${NOISE_GLSL}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float n = snNoise(vSnowW * ${scale.toFixed(3)}) * 0.6 + snNoise(vSnowW * ${(scale * 4.1).toFixed(3)}) * 0.4;
          float up = vSnowN.y;
          snowAmt = smoothstep(0.35, 0.8, up + (n - 0.5) * ${patch.toFixed(3)}) * ${amount.toFixed(3)};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${col.r.toFixed(3)}, ${col.g.toFixed(3)}, ${col.b.toFixed(3)}), snowAmt);
          ${
            far
              ? `float snFar = smoothstep(${far[0].toFixed(1)}, ${far[1].toFixed(1)}, distance(vSnowW, cameraPosition));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.41, 0.47), snFar * 0.8);
          snowAmt = mix(snowAmt, 0.5, snFar);`
              : ""
          }
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.88, snowAmt);",
      );
  };
  mat.customProgramCacheKey = () => `snow-${amount}-${scale}-${patch}-${far ?? ""}`;
  return mat;
}

/** Shared uniforms for the rim light (sun direction in view space, updated each frame). */
export const RIM = {
  uSunView: { value: new THREE.Vector3(0, 0, -1) },
  uRimColor: { value: new THREE.Color(2.5, 1.05, 0.45) },
  uRimCold: { value: new THREE.Color(0.1, 0.15, 0.34) },
};

export function rimLit<T extends THREE.MeshStandardMaterial>(mat: T, strength = 1): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uSunView = RIM.uSunView;
    sh.uniforms.uRimColor = RIM.uRimColor;
    sh.uniforms.uRimCold = RIM.uRimCold;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uSunView;\nuniform vec3 uRimColor;\nuniform vec3 uRimCold;")
      .replace(
        "#include <opaque_fragment>",
        `{
          vec3 rv = normalize(vViewPosition);
          float fres = pow(1.0 - saturate(dot(normal, rv)), 2.6);
          float toSun = saturate(dot(normal, uSunView) * 0.6 + 0.4);
          outgoingLight += uRimColor * fres * pow(toSun, 2.2) * ${strength.toFixed(2)} * 0.55;
          outgoingLight += uRimCold * fres * (1.0 - toSun) * 0.6;
        }
        #include <opaque_fragment>`,
      );
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `rim-${strength}-${key ? key() : ""}`;
  return mat;
}

/** Small canvas texture helper. */
export function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
