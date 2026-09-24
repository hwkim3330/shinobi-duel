// Packs the raw Blender export into the shipped arena:
//   blender/cache/arena_raw.glb → public/assets/arena.glb
// Textures resized and re-encoded as WebP (EXT_texture_webp), geometry welded, quantized and
// meshopt-compressed (EXT_meshopt_compression; the decoder ships from three/addons, served locally).
// Usage: node tools/blender/pack_arena.mjs [in] [out]
import { statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compressTexture, dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const src = process.argv[2] ?? "blender/cache/arena_raw.glb";
const dst = process.argv[3] ?? "public/assets/arena.glb";

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});
const doc = await io.read(src);

// Close-up surfaces keep 2k (the floor tiles sample 1/40 of the kawara photo per tile, and the floor
// AO covers 28 m); everything else is seen from 15 m+ and gets 1k.
const big = /kawara_diff|roof_tiles_nor|ao_Roof/i;
await doc.transform(dedup(), prune(), weld());
for (const t of doc.getRoot().listTextures()) {
  const s = big.test(t.getName()) ? 2048 : 1024;
  await compressTexture(t, { encoder: sharp, targetFormat: "webp", resize: [s, s], quality: 82 });
}
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));

await io.write(dst, doc);
const tex = doc.getRoot().listTextures();
let texBytes = 0;
for (const t of tex) texBytes += t.getImage()?.byteLength ?? 0;
console.log(`${dst}: ${(statSync(dst).size / 1048576).toFixed(2)} MB (${tex.length} textures, ${(texBytes / 1048576).toFixed(2)} MB of image data)`);
for (const t of tex) console.log(`  ${t.getName() || t.getURI()} ${t.getSize()?.join("x")} ${((t.getImage()?.byteLength ?? 0) / 1024).toFixed(0)} KB`);
