// Lists shader programs / geometries created after startup by one bot fight (first-use hitches).
// Usage: node tools/progs.mjs
import { launch } from "./gpu.mjs";

const { browser, page, errors } = await launch();
await page.waitForTimeout(1500);
const snap = () =>
  page.evaluate(() => {
    const r = window.__duel.game.renderer;
    return { progs: r.info.programs.map((p) => p.name + "|" + p.cacheKey.slice(0, 60)), geo: r.info.memory.geometries };
  });
const a = await snap();
await page.evaluate(() => {
  window.__duel.startFight();
  window.__duel.autoPlay(true);
});
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500);
  if ((await page.evaluate(() => window.__duel.game.state)) === "victory") break;
}
await page.waitForTimeout(2000);
const b = await snap();
console.log(`geometries ${a.geo} -> ${b.geo}`);
for (const p of b.progs) if (!a.progs.includes(p)) console.log("new program:", p);
await browser.close();
console.log(errors.length ? errors.join("\n") : "no errors");
