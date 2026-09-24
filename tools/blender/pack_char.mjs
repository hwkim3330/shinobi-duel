// Packs a Blender character export for the game:
//   blender/cache/<who>_raw.glb → public/assets/chars/<who>.glb
// Textures → WebP (1k, 2k with --tex 2048), animation keys resampled, geometry + animation meshopt-compressed.
// Usage: node tools/blender/pack_char.mjs <player|boss> [--tex 2048]
import { mkdirSync, statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compressTexture, dedup, meshopt, prune, resample, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const who = process.argv[2] ?? "player";
const ti = process.argv.indexOf("--tex");
const size = ti > 0 ? Number(process.argv[ti + 1]) : 1024;
const src = `blender/cache/${who}_raw.glb`;
const dst = `public/assets/chars/${who}.glb`;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});
const doc = await io.read(src);
await doc.transform(dedup(), prune(), weld(), resample({ tolerance: 1e-4 }));
for (const t of doc.getRoot().listTextures()) await compressTexture(t, { encoder: sharp, targetFormat: "webp", resize: [size, size], quality: 85 });
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
mkdirSync("public/assets/chars", { recursive: true });
await io.write(dst, doc);
const r = doc.getRoot();
console.log(
  `${dst}: ${(statSync(dst).size / 1048576).toFixed(2)} MB, ${r.listAnimations().length} clips, ${r.listTextures().length} textures, ${r.listMeshes().length} meshes`,
);
