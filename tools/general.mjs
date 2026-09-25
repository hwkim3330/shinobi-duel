// "General vs AI": a scripted human at the general's keys (real keyboard events) against the AI
// kunoichi, real time. Checks the mode runs a whole fight with no errors and writes screenshots.
//   node tools/general.mjs [seconds] [outdir]
import { launch } from "./gpu.mjs";
const SECS = +(process.argv[2] ?? 60);
const OUT = process.argv[3] ?? "shots";
const BASE = process.env.DUEL_URL ?? "http://localhost:7860/";
const { browser, page, errors } = await launch({ width: 1280, height: 720, url: `${BASE}?mode=general` });
await page.screenshot({ path: `${OUT}/title-general.png` });
await page.keyboard.press("KeyF"); // any key starts the fight (F is not a title key)
await page.waitForTimeout(2500);
const keys = ["KeyJ", "KeyJ", "KeyF", "KeyQ", "KeyC", "KeyE", "Space", "KeyR", "KeyX"];
let shot = 0;
for (let t = 0, i = 0; t < SECS * 1000; t += 500, i++) {
  const s = await page.evaluate(() => { const g = window.__duel.game, b = g.boss, p = g.player; return { st: g.state, d: Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z), bs: b.state, ps: p.state }; });
  if (s.st === "victory" || s.st === "defeat") {
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/end-general.png` });
    break;
  }
  await page.keyboard.down(s.d > 2.8 ? "KeyW" : i % 2 ? "KeyA" : "KeyD");
  await page.waitForTimeout(200);
  await page.keyboard.up("KeyW"); await page.keyboard.up("KeyA"); await page.keyboard.up("KeyD");
  if (s.ps === "attack" || s.ps === "airAttack") { await page.keyboard.down("KeyK"); await page.waitForTimeout(250); await page.keyboard.up("KeyK"); }
  else await page.keyboard.press(keys[(i * 5) % keys.length]);
  if (i === 12 || i === 40) await page.screenshot({ path: `${OUT}/fight-general-${shot++}.png` });
  await page.waitForTimeout(300);
}
const r = await page.evaluate(() => { const g = window.__duel.game; return { state: g.state, pH: g.player.health, bH: g.boss.health, markers: g.boss.markers, phase: g.boss.phase, st: g.stats }; });
console.log(JSON.stringify({ ...r, st: { deflects: r.st.deflects, hitsTaken: r.st.hitsTaken, playerHits: r.st.playerHits, bossBlocks: r.st.bossBlocks, bossDeflects: r.st.bossDeflects, mikiri: r.st.mikiri, breaks: r.st.breaks, deaths: r.st.deaths } }), "errors", errors);
await browser.close();
