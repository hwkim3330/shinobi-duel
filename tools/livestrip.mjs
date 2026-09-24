// Frames of the live (stepped) game with a side camera on one fighter → shots/live_<name>_<i>.png.
// Usage: node tools/livestrip.mjs <scenario> [frames] [every]
//   guardwalk — the kunoichi strafes with her guard up; turn — she turns on the spot (lock-on);
//   dodge — directional dodges; combo — the general's combo into a deflect; heal — the gourd.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./gpu.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "shots");
mkdirSync(out, { recursive: true });
const [name = "guardwalk", nA = "6", eA = "10"] = process.argv.slice(2);
const { browser, page, errors } = await launch({ width: 960, height: 540 });
await page.waitForFunction(() => window.__duel?.ready, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.addStyleTag({ content: "#title,#hud,#end{display:none!important}" });
await page.evaluate((name) => {
  const g = window.__duel.game;
  g.pause();
  g.startFight();
  g.bot.play = false;
  g.bot.deflect = name === "combo";
  g.boss.passive = true;
  g.boss.enter("idle");
  g.boss.attack = null;
  g.place(name === "combo" ? 2.4 : 3.2);
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  const inp = g.input;
  if (name === "guardwalk") {
    inp.press("block");
    inp.botAxis = { x: 1, y: 0 };
  } else if (name === "turn") {
    g.player.yaw += 2.4;
  } else if (name === "dodge") {
    inp.botAxis = { x: 1, y: 0 };
    inp.press("dodge");
    inp.release("dodge");
  } else if (name === "combo") g.forceBossAttack("combo");
  else if (name === "heal") {
    inp.press("heal");
    inp.release("heal");
  }
  window.__strip = { who: name === "combo" ? "boss" : "player" };
}, name);
for (let i = 0; i < +nA; i++) {
  await page.evaluate((every) => {
    const g = window.__duel.game;
    for (let k = 0; k < every; k++) g.step(1 / 60);
    const f = window.__strip.who === "boss" ? g.bossBody : g.playerBody;
    const c = f.rig.chestW.clone();
    const yaw = f.rig.yaw;
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const pos = c.clone();
    pos.x += side.x * 2.6 + fwd.x * 1.2;
    pos.z += side.z * 2.6 + fwd.z * 1.2;
    pos.y += 0.25;
    g.cam.override = { pos, look: c };
    g.frame(1 / 60, true);
  }, +eA);
  await page.screenshot({ path: join(out, `live_${name}_${i}.png`) });
}
await browser.close();
const real = errors.filter((e) => !/transformed/.test(e) && !/Shader Error|VALIDATE_STATUS|Program Info|^\s*\d+:|Vertex shader/.test(e));
console.log(`${nA} frames → shots/live_${name}_*.png${real.length ? "\nERRORS:\n" + real.join("\n") : ""}`);
