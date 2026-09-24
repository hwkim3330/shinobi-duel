// Real-time capture of the first seconds after "press any key" (what a recording opens on).
// Saves shots/open_0.png ... every 0.5 s. Usage: node tools/strip.mjs [seconds=3.5]
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./gpu.mjs";

const secs = Number(process.argv[2] ?? 3.5);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "shots");
mkdirSync(out, { recursive: true });
const { browser, page, errors } = await launch();
await page.evaluate(() => window.__duel.toTitle());
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, `open_title${process.env.TAG ? "_" + process.env.TAG : ""}.png`) });
await page.mouse.click(640, 360);
await page.keyboard.press("Enter");
await page.evaluate(() => window.__duel.autoPlay(true));
const t0 = Date.now();
for (let i = 0; i * 0.5 <= secs; i++) {
  const wait = t0 + i * 500 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: join(out, `open_${i}${process.env.TAG ? "_" + process.env.TAG : ""}.png`) });
  const s = await page.evaluate(() => window.__duel.stats());
  console.log(`open_${i} t=${((Date.now() - t0) / 1000).toFixed(2)} ${s.state} boss=${s.boss.state}/${s.boss.attack} fps=${s.fps}`);
}
await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("no console/page errors");
