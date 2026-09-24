/**
 * Post pipeline (pmndrs/postprocessing):
 *   scene (HDR half-float, MSAA) → N8AO contact shadows → god rays + mipmap bloom (sparks, lanterns,
 *   sun) → grade: exposure, hue-preserving filmic curve, then in display space a cold-lift /
 *   warm-gain split tone, luminance-keyed saturation (muted mid-tones, hot highlights keep their
 *   colour), soft S-curve, paper grain (the painterly touch), hit flash, finisher desaturation,
 *   cinematic bars → chromatic aberration (pulses on hits) + vignette.
 */
import * as THREE from "three";
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  KernelSize,
  RenderPass,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";

/** Tuned grade (see TASKS.md "Lighting pass"). */
export const GRADE = {
  exposure: 0.8,
  /** Saturation of shadows / mid-tones and of bright highlights (sparks, lanterns, sun). */
  satLow: 0.8,
  satHigh: 1.12,
  /** Lift added to the shadows (display space, cold) and gain on the highlights (warm). */
  lift: [0.008, 0.02, 0.05],
  gain: [1.04, 0.99, 0.93],
  contrast: 0.32,
  grain: 0.024,
};

const GRADE_FRAG = /* glsl */ `
uniform float uExposure;
uniform float uSatLow;
uniform float uSatHigh;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uContrast;
uniform float uGrain;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDesat;
uniform float uBars;
uniform float uFade;
float gH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gN(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gH(i), gH(i + vec2(1, 0)), u.x), mix(gH(i + vec2(0, 1)), gH(i + vec2(1, 1)), u.x), u.y); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb * uExposure, 0.0);
  // Filmic shoulder; half of it applied on luminance so hot oranges stay orange (no yellow skew).
  float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 tm = aces(c);
  vec3 tl = c * (aces(vec3(l0)).x / max(l0, 1e-4));
  c = clamp(mix(tm, tl, 0.45), 0.0, 1.0);
  // Display space for the grade.
  c = pow(c, vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Low-saturation dusk, but sparks / lanterns / the sun keep their heat.
  c = mix(vec3(l), c, mix(uSatLow, uSatHigh, smoothstep(0.6, 0.95, l)));
  // Split tone: cold blue lift in the shadows, warm peach gain in the highlights.
  c = c * mix(vec3(1.0), uGain, smoothstep(0.35, 1.0, l)) + uLift * (1.0 - smoothstep(0.0, 0.5, l));
  // Cold shadows: pull the magenta out of the lower tones so the peach lives only in the light.
  c *= mix(vec3(0.9, 0.97, 1.08), vec3(1.0), smoothstep(0.12, 0.55, l));
  // Gentle S-curve around mid grey.
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  // Finisher: bleed colour out, keep a warm/red cast.
  float gl = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(gl * 1.08, gl * 0.9, gl * 0.86), uDesat);
  c = mix(c, uFlashColor, uFlash);
  // Paper / brush grain (static, screen space): a washi texture instead of video noise.
  vec2 fc = gl_FragCoord.xy;
  float paper = gN(fc * 0.35) * 0.5 + gN(fc * 0.09 + 7.0) * 0.5;
  float fib = gN(vec2(fc.x * 0.02, fc.y * 0.6));
  c *= 1.0 + (paper - 0.5) * uGrain + (fib - 0.5) * uGrain * 0.35;
  c += (gH(fc + fract(time) * 91.0) - 0.5) * 0.012;
  float bar = uBars * 0.11;
  c *= step(bar, uv.y) * step(uv.y, 1.0 - bar);
  c *= 1.0 - uFade;
  outputColor = vec4(pow(max(c, 0.0), vec3(2.2)), inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", GRADE_FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ["uExposure", new THREE.Uniform(GRADE.exposure)],
        ["uSatLow", new THREE.Uniform(GRADE.satLow)],
        ["uSatHigh", new THREE.Uniform(GRADE.satHigh)],
        ["uLift", new THREE.Uniform(new THREE.Vector3(...GRADE.lift))],
        ["uGain", new THREE.Uniform(new THREE.Vector3(...GRADE.gain))],
        ["uContrast", new THREE.Uniform(GRADE.contrast)],
        ["uGrain", new THREE.Uniform(GRADE.grain)],
        ["uFlash", new THREE.Uniform(0)],
        ["uFlashColor", new THREE.Uniform(new THREE.Color(1, 0.85, 0.6))],
        ["uDesat", new THREE.Uniform(0)],
        ["uBars", new THREE.Uniform(0)],
        ["uFade", new THREE.Uniform(0)],
      ]),
    });
  }
  u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!;
  }
}

export class Post {
  private readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  private readonly grade: GradeEffect;
  private readonly ca: ChromaticAberrationEffect;
  private readonly vignette: VignetteEffect;
  private readonly ao: N8AOPostPass;

  /** Transient intensities, decayed each frame (real time). */
  flash = 0;
  aberration = 0;
  desat = 0;
  bars = 0;
  fade = 0;
  private flashColor = new THREE.Color(1, 0.85, 0.6);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, sun?: THREE.Mesh) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });
    this.composer.addPass(new RenderPass(scene, camera));
    // Contact shadows: armour rows, cloth folds and feet on the tiles read as form, not plastic.
    this.ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
    this.ao.setQualityMode("Medium");
    this.ao.configuration.aoRadius = 0.6;
    this.ao.configuration.distanceFalloff = 0.4;
    this.ao.configuration.intensity = 3.8;
    // Cold occlusion (blue-violet, never black): shadows stay dusk-coloured.
    this.ao.configuration.color = new THREE.Color(0.07, 0.07, 0.13);
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.halfRes = true;
    this.composer.addPass(this.ao);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.15,
      luminanceSmoothing: 0.35,
      intensity: 0.95,
      radius: 0.72,
      levels: 8,
    });
    this.grade = new GradeEffect();
    const rays = sun
      ? [
          new GodRaysEffect(camera, sun, {
            density: 0.94,
            decay: 0.93,
            weight: 0.26,
            exposure: 0.3,
            samples: 60,
            clampMax: 1.0,
            kernelSize: KernelSize.SMALL,
            blur: true,
          }),
        ]
      : [];
    this.composer.addPass(new EffectPass(camera, ...rays, this.bloom, this.grade));

    this.ca = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.2,
    });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    this.vignette.blendMode.blendFunction = BlendFunction.NORMAL;
    this.composer.addPass(new EffectPass(camera, this.ca, this.vignette));
  }

  hitFlash(amount: number, color?: THREE.ColorRepresentation): void {
    this.flash = Math.max(this.flash, amount);
    if (color !== undefined) this.flashColor.set(color);
    else this.flashColor.setRGB(1, 0.85, 0.6);
  }

  kickAberration(amount: number): void {
    this.aberration = Math.max(this.aberration, amount);
  }

  render(dt: number): void {
    this.flash *= Math.exp(-dt / 0.06);
    this.aberration *= Math.exp(-dt / 0.12);
    const g = this.grade;
    g.u("uFlash").value = this.flash;
    (g.u("uFlashColor").value as THREE.Color).copy(this.flashColor);
    g.u("uDesat").value = this.desat;
    g.u("uBars").value = this.bars;
    g.u("uFade").value = this.fade;
    const a = 0.0001 + this.aberration * 0.0012;
    this.ca.offset.set(a, a * 0.6);
    this.vignette.darkness = 0.55 + this.desat * 0.25;
    this.composer.render(dt);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.ao.setSize(w, h);
  }
}
