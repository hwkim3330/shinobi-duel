// Stress check: the player stands still and eats every hit; samples the worst frame times.
import { launch } from "./gpu.mjs";

const { browser, page, errors } = await launch();
await page.evaluate(() => {
  const d = window.__duel;
  d.startFight();
  d.game.bot.play = false;
  d.game.bot.deflect = false;
  window.__ft = [];
  let last = performance.now();
  const tick = (now) => {
    window.__ft.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const ft = window.__ft.splice(0);
    const st = window.__duel.stats();
    return { worst: Math.max(...ft).toFixed(1), n: ft.length, hp: st.player.health, hits: st.hitsTaken, state: st.state };
  });
  console.log(JSON.stringify(s));
  if (s.state === "dying" || s.state === "defeat") break;
}
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
