// Real-time playtest: title → a key → the fight on the live loop. The bot deflects every
// blockable blow ~80 ms before contact, mikiri-counters thrusts (steps into them), jumps sweeps
// and kicks off his head, dodges grabs, drinks the gourd once, punishes openings and takes both
// deathblows (phase 1 → he rises → phase 2 → finisher). Also samples fps.
// Usage: node tools/bot.mjs [seconds=150]
import { launch } from "./gpu.mjs";

const limit = Number(process.argv[2] ?? 150);
const { browser, page, errors, renderer } = await launch();
console.log("renderer:", renderer);
// Real flow: title screen -> a key press -> the fight.
await page.evaluate(() => window.__duel.toTitle());
await page.waitForTimeout(1500);
const titleShown = await page.evaluate(() => !document.getElementById("title").classList.contains("hidden"));
const hintShown = await page.evaluate(() => document.querySelectorAll("#title .keys img").length);
await page.mouse.click(640, 360);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const leftTitle = await page.evaluate(() => window.__duel.stats().state);
await page.evaluate(() => window.__duel.autoPlay(true));
const fps = [];
let last = null;
let sawPhase2 = false;
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < limit) {
  await page.waitForTimeout(1000);
  last = await page.evaluate(() => ({ ...window.__duel.stats(), phase: window.__duel.game.boss.phase, markers: window.__duel.game.boss.markers, gourd: window.__duel.game.player.gourd }));
  if (last.phase === 2) sawPhase2 = true;
  if (last.state === "fight") fps.push(last.fps);
  process.stdout.write(
    `t=${((Date.now() - t0) / 1000).toFixed(0)}s ${last.state} fps=${last.fps} P${last.phase} m${last.markers} boss hp=${last.boss.health} post=${last.boss.posture} (${last.boss.state}/${last.boss.attack}) ` +
      `player hp=${last.player.health} defl=${last.deflects} mk=${last.mikiri} jump=${last.sweepsJumped} kick=${last.headKicks} grabEv=${last.grabsEvaded} heal=${last.heals} hit=${last.hitsTaken} breaks=${last.breaks}\n`,
  );
  if (last.victory || last.state === "defeat") break;
}
await page.waitForTimeout(5200);
const shown = await page.evaluate(() => {
  const e = document.getElementById("end");
  const img = e?.querySelector("img.e-latin");
  const up = !!e && !e.classList.contains("hidden") && e.classList.contains("show") && img && img.src.startsWith("data:");
  return up ? e.dataset.kind : "";
});
await browser.close();

const avg = fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : 0;
const report = {
  renderer,
  titleShown,
  controlsHintLines: hintShown,
  afterKey: leftTitle,
  seconds: ((Date.now() - t0) / 1000).toFixed(1),
  fpsAvg: +avg.toFixed(1),
  fpsMin: fps.length ? Math.min(...fps) : 0,
  phase2: sawPhase2,
  deflects: last.deflects,
  lateDeflects: last.lateDeflects,
  blocks: last.blocks,
  mikiri: last.mikiri,
  sweepsJumped: last.sweepsJumped,
  headKicks: last.headKicks,
  grabsEvaded: last.grabsEvaded,
  heals: last.heals,
  hitsTaken: last.hitsTaken,
  deaths: last.deaths,
  resurrections: last.resurrections,
  dodged: last.dodged,
  playerHits: last.playerHits,
  bossBlocks: last.bossBlocks,
  bossDeflects: last.bossDeflects,
  breaks: last.breaks,
  deathblows: last.deathblows,
  finishers: last.finishers,
  victory: last.victory,
  endScreen: shown,
  contactErr: last.contactErr.slice(0, 20),
  hitLog: last.hitLog,
  errors,
};
console.log(JSON.stringify(report, null, 2));
const ok =
  titleShown &&
  hintShown >= 4 &&
  leftTitle !== "title" &&
  sawPhase2 &&
  last.deflects >= 6 &&
  last.mikiri >= 1 &&
  last.sweepsJumped >= 1 &&
  last.heals === 1 &&
  last.deathblows >= 2 &&
  last.finishers === 1 &&
  last.victory &&
  shown === "victory" &&
  errors.length === 0;
console.log(ok ? "BOT PASS" : "BOT FAIL");
process.exit(ok ? 0 : 1);
