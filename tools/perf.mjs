// A/B frame-rate check: runs the fight idle and hides one scene part at a time.
// Usage: node tools/perf.mjs
import { launch } from "./gpu.mjs";

const { browser, page, errors } = await launch();
await page.evaluate(() => {
  const d = window.__duel;
  d.startFight();
  d.game.boss.passive = true;
  window.__ft = [];
  let last = performance.now();
  const tick = (now) => {
    window.__ft.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const measure = async (label, js) => {
  await page.evaluate((c) => new Function("g", c)(window.__duel.game), js);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ft.splice(0));
  await page.waitForTimeout(2000);
  const ft = await page.evaluate(() => window.__ft.splice(0));
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
  const info = await page.evaluate(() => {
    const r = window.__duel.game.renderer.info.render;
    return `${r.calls} calls`;
  });
  console.log(`${label.padEnd(22)} ${(1000 / avg).toFixed(1)} fps  ${info}`);
};

const hide = (test) => `g.scene.traverse((o) => { if (${test}) o.visible = false; });`;
const show = `g.scene.traverse((o) => { o.visible = true; });`;

await measure("baseline", "");
await measure("no instanced", hide("o.isInstancedMesh"));
await measure("restore", show);
await measure("no characters", hide("o.isSkinnedMesh || (o.parent && o.parent.userData && o.parent.userData.char)"));
await measure("restore", show);
await measure("no shadows", "g.renderer.shadowMap.enabled = false;");
await measure("restore", "g.renderer.shadowMap.enabled = true;");
await measure("no AO", "g.post.ao.enabled = false;");
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
