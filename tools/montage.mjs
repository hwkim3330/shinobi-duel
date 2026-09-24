// Tile shots/*.png matching a prefix into shots/montage.png (for quick review; delete after).
// Usage: node tools/montage.mjs <prefix> [cols] [cell]
import { readdirSync } from "node:fs";
import sharp from "sharp";
const [pre, colsA, cellA] = process.argv.slice(2);
const cols = +(colsA ?? 4), cell = +(cellA ?? 300);
const files = readdirSync("shots").filter((f) => f.startsWith(pre) && f.endsWith(".png")).sort();
const rows = Math.ceil(files.length / cols);
const comp = await Promise.all(files.map(async (f, i) => ({ input: await sharp("shots/" + f).resize(cell, cell).png().toBuffer(), left: (i % cols) * cell, top: Math.floor(i / cols) * cell })));
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: "#000" } }).composite(comp).png().toFile("shots/montage.png");
console.log(files.map((f, i) => `${i}:${f}`).join("  "));
