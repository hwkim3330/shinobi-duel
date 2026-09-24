// When do new shader programs appear during a fight? Logs the game state at each increase.
import { launch } from "./gpu.mjs";
const { browser, page } = await launch();
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = window.__duel.game;
  window.__log = [];
  let n = g.renderer.info.programs.length;
  const tick = () => {
    const m = g.renderer.info.programs.length;
    if (m !== n) {
      const s = window.__duel.stats();
      window.__log.push(`${n}->${m} t=${g.gameTime.toFixed(2)} ${g.state} boss=${s.boss.state}/${s.boss.attack} player=${s.player.state} defl=${s.deflects} hits=${s.playerHits}`);
      n = m;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__duel.startFight();
  window.__duel.autoPlay(true);
});
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500);
  if ((await page.evaluate(() => window.__duel.game.state)) === "victory") break;
}
await page.waitForTimeout(2000);
console.log((await page.evaluate(() => window.__log)).join("\n"));
await browser.close();
