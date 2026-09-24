/**
 * Brush lettering generated in code (no web fonts): draw a heavy system serif / Mincho glyph,
 * smear it with jittered copies, erode it with bristle-streak noise and threshold it back into
 * crisp ink with ragged dry-brush edges, then flick a few splatters around it.
 */
import { rng } from "../core/math";

export const KANJI_FONT = `"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", "Noto Serif JP", "Yu Gothic", "Meiryo", serif`;
export const LATIN_FONT = `"Palatino Linotype", "Book Antiqua", Georgia, "Times New Roman", serif`;

export interface BrushOpts {
  font?: string;
  weight?: number | string;
  size: number;
  color?: string;
  seed?: number;
  /** 0..1 how dry/streaky the brush is. */
  dry?: number;
  splatter?: number;
  letterSpacing?: number;
  pad?: number;
  glow?: string;
}

function valueNoise(R: () => number, w: number, h: number): (x: number, y: number) => number {
  const gw = w + 2;
  const grid = new Float32Array(gw * (h + 2));
  for (let i = 0; i < grid.length; i++) grid[i] = R();
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = grid[(yi % h) * gw + (xi % w)];
    const b = grid[(yi % h) * gw + ((xi + 1) % w)];
    const c = grid[((yi + 1) % h) * gw + (xi % w)];
    const d = grid[((yi + 1) % h) * gw + ((xi + 1) % w)];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function brushText(text: string, o: BrushOpts): HTMLCanvasElement {
  const R = rng(o.seed ?? 7);
  const kanji = !o.font || o.font === KANJI_FONT;
  const font = `${o.weight ?? (kanji ? 300 : 900)} ${o.size}px ${o.font ?? KANJI_FONT}`;
  const pad = o.pad ?? Math.round(o.size * 0.35);
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = font;
  const ls = o.letterSpacing ?? 0;
  const chars = [...text];
  const widths = chars.map((c) => meas.measureText(c).width);
  const tw = widths.reduce((a, b) => a + b, 0) + ls * o.size * (chars.length - 1);
  const W = Math.ceil(tw + pad * 2);
  const H = Math.ceil(o.size * 1.3 + pad * 2);

  const mask = document.createElement("canvas");
  mask.width = W;
  mask.height = H;
  const mg = mask.getContext("2d")!;
  mg.font = font;
  mg.textBaseline = "middle";
  mg.fillStyle = "#fff";
  let x = pad;
  if (kanji) {
    // Broad-nib calligraphy: draw thin glyphs, then sweep them along an angled nib (a Minkowski
    // sum with a slanted segment). Horizontals come out thin and verticals fat, like a brush,
    // whatever system font is available.
    const thin = document.createElement("canvas");
    thin.width = W;
    thin.height = H;
    const tg = thin.getContext("2d")!;
    tg.font = font;
    tg.textBaseline = "middle";
    tg.textAlign = "center";
    tg.fillStyle = "#fff";
    chars.forEach((c, i) => {
      tg.save();
      tg.translate(x + widths[i] / 2, H / 2);
      tg.rotate((R() - 0.5) * 0.08);
      tg.fillText(c, 0, 0);
      tg.restore();
      x += widths[i] + ls * o.size;
    });
    const nib = o.size * 0.04;
    const ang = -0.62;
    const steps = 18;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps - 0.5;
      mg.globalAlpha = 1;
      mg.drawImage(thin, Math.cos(ang) * nib * t, Math.sin(ang) * nib * t);
    }
  } else {
    // Each glyph with its own tiny tilt and a smeared, jittered stack.
    chars.forEach((c, i) => {
      const cx = x + widths[i] / 2;
      const rot = (R() - 0.5) * 0.08;
      for (let k = 0; k < 7; k++) {
        mg.save();
        mg.globalAlpha = k === 0 ? 1 : 0.22;
        mg.translate(cx + (R() - 0.5) * o.size * 0.03, H / 2 + (R() - 0.5) * o.size * 0.03);
        mg.rotate(rot + (R() - 0.5) * 0.02);
        mg.textAlign = "center";
        mg.fillText(c, k * o.size * 0.006, 0);
        mg.restore();
      }
      x += widths[i] + ls * o.size;
    });
  }

  let img = mg.getImageData(0, 0, W, H);
  if (kanji) {
    // Domain-warp the glyphs so no edge stays typographically straight.
    const src = img.data;
    const warped = mg.createImageData(W, H);
    const wn = valueNoise(R, 64, 64);
    const amp = o.size * 0.012;
    const f = 1 / (o.size * 0.09);
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const dx = (wn((xx * f) % 64, (yy * f) % 64) - 0.5) * 2 * amp;
        const dy = (wn((xx * f + 17) % 64, (yy * f + 31) % 64) - 0.5) * 2 * amp;
        const sx = Math.min(W - 1, Math.max(0, Math.round(xx + dx)));
        const sy = Math.min(H - 1, Math.max(0, Math.round(yy + dy)));
        const si = (sy * W + sx) * 4;
        const di = (yy * W + xx) * 4;
        warped.data[di] = src[si];
        warped.data[di + 1] = src[si + 1];
        warped.data[di + 2] = src[si + 2];
        warped.data[di + 3] = src[si + 3];
      }
    }
    img = warped;
  }
  const d = img.data;
  const dry = o.dry ?? 0.6;
  const nA = valueNoise(R, 64, 512);
  const nB = valueNoise(R, 128, 128);
  const col = hex(o.color ?? "#0d0a0a");
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      let a = d[i + 3] / 255;
      if (a <= 0) continue;
      // Bristle streaks: stretched noise along a slightly diagonal stroke direction.
      const sx = (xx + yy * 0.35) / (o.size * 0.9);
      const sy = (yy - xx * 0.12) / (o.size * 0.018);
      const streak = nA((sx * 8) % 64, Math.abs(sy) % 512);
      const blot = nB((xx / (o.size * 0.12)) % 128, (yy / (o.size * 0.12)) % 128);
      a = a * (1 - dry * 0.55 + dry * 0.55 * streak) * (0.85 + blot * 0.3);
      a = smoothstep(0.32, 0.52, a);
      const shade = 0.85 + blot * 0.3;
      d[i] = col[0] * shade;
      d[i + 1] = col[1] * shade;
      d[i + 2] = col[2] * shade;
      d[i + 3] = a * 255;
    }
  }
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const og = out.getContext("2d")!;
  if (o.glow) {
    og.shadowColor = o.glow;
    og.shadowBlur = o.size * 0.25;
  }
  mg.putImageData(img, 0, 0);
  og.drawImage(mask, 0, 0);
  og.shadowBlur = 0;
  // Splatter flicks.
  const n = Math.round((o.splatter ?? 0.5) * 18);
  og.fillStyle = o.color ?? "#0d0a0a";
  for (let k = 0; k < n; k++) {
    const px = pad * 0.6 + R() * (W - pad * 1.2);
    const py = H / 2 + (R() - 0.5) * o.size * 1.1;
    const r = o.size * (0.004 + R() * 0.018);
    og.globalAlpha = 0.5 + R() * 0.5;
    og.beginPath();
    og.arc(px, py, r, 0, Math.PI * 2);
    og.fill();
  }
  og.globalAlpha = 1;
  return out;
}

/** A single horizontal brush stroke (used under titles and as the HUD bar backing). */
export function brushStroke(w: number, h: number, color: string, seed = 3): HTMLCanvasElement {
  const R = rng(seed);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const n = valueNoise(R, 32, 256);
  const col = hex(color);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = (y / h) * 2 - 1;
      // Thick at the start, tapering and breaking up toward the end.
      const thick = 0.9 - u * 0.45 + Math.sin(u * 9) * 0.04;
      const edge = 1 - smoothstep(thick - 0.2, thick, Math.abs(v));
      const streak = n((u * 6) % 32, ((y / h) * 200) % 256);
      const dryEnd = smoothstep(0.55, 1, u);
      let a = edge * (1 - dryEnd * 0.8 + dryEnd * 0.8 * streak * 1.3);
      a *= smoothstep(0, 0.04, u) * (1 - smoothstep(0.93, 1, u + streak * 0.1));
      a = smoothstep(0.3, 0.55, a);
      const i = (y * w + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hex(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
