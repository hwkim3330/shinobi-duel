// Debug probe: stage a scene, run a JS snippet against window.__duel.game, screenshot.
// Usage: node tools/probe.mjs <scene> <out-name> "<js using g>"
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./gpu.mjs";

const [scene, name, code = ""] = process.argv.slice(2);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "shots", `${name}.png`);
const { browser, page, errors } = await launch();
await page.evaluate((s) => window.__duel.scene(s), scene);
const r = await page.evaluate((c) => {
  const g = window.__duel.game;
  const res = String(new Function("g", c)(g) ?? "");
  g.frame(1 / 60, true);
  return res;
}, code);
if (r) console.log(r);
await page.waitForTimeout(700);
await page.screenshot({ path: out });
await browser.close();
console.log(errors.length ? errors.join("\n") : "ok");
