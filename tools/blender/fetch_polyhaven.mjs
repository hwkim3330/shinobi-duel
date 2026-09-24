// Downloads the Poly Haven (CC0) sources for the arena into blender/tex/ (skips files already there).
// Usage: node tools/blender/fetch_polyhaven.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const OUT = "blender/tex";
const sets = { roof_tiles: "2k", japanese_stone_wall: "2k", plastered_wall_02: "1k", weathered_planks: "1k", snow_02: "1k" };
const maps = { Diffuse: "diff", nor_gl: "nor_gl", Rough: "rough", AO: "ao", Displacement: "disp" };
const HDRI = "qwantani_dusk_2_puresky";

mkdirSync(OUT, { recursive: true });
const get = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());
for (const [id, res] of Object.entries(sets)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [k, short] of Object.entries(maps)) {
    const e = files[k]?.[res]?.jpg ?? files[k]?.[res]?.png;
    if (!e) continue;
    const out = `${OUT}/${id}_${short}_${res}.${e.url.split(".").pop()}`;
    if (!existsSync(out)) writeFileSync(out, await get(e.url));
    console.log(out);
  }
}
const h = await (await fetch(`https://api.polyhaven.com/files/${HDRI}`)).json();
const out = `${OUT}/${HDRI}_1k.hdr`;
if (!existsSync(out)) writeFileSync(out, await get(h.hdri["1k"].hdr.url));
console.log(out, "(copy to public/assets/sky_dusk.hdr)");
