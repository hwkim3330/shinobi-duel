// Stability soak (real-time loop): 5 bot fights back to back, ~2 min random-input fuzz, then a
// tab switch and resizes. Tracks errors, renderer resource counts, JS heap, stuck states and
// frame hitches (>20 ms) during combat.
// Usage: node tools/soak.mjs [fuzzSeconds=120]
import { launch } from "./gpu.mjs";

const fuzzSecs = Number(process.argv[2] ?? 120);
const { browser, page, errors } = await launch();
let fails = 0;
const report = (ok, name, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  —  ${detail}`);
};

await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const tick = (now) => {
    const st = window.__duel.game.state;
    if (st === "fight" && !document.hidden) window.__ft.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__res = () => {
    const g = window.__duel.game;
    const m = g.renderer.info.memory;
    return { geo: m.geometries, tex: m.textures, prog: g.renderer.info.programs.length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1 };
  };
});
const res = () => page.evaluate(() => window.__res());
const hitches = async () => {
  const ft = await page.evaluate(() => window.__ft.splice(0));
  const worst = ft.length ? Math.max(...ft) : 0;
  return { n: ft.length, over20: ft.filter((t) => t > 20).length, worst, avg: ft.length ? 1000 / (ft.reduce((a, b) => a + b, 0) / ft.length) : 0 };
};

// ------------------------------------------------------------ 5 bot fights
await page.waitForTimeout(1500);
const r0 = await res();
const fights = [];
for (let f = 0; f < 5; f++) {
  await page.evaluate(() => {
    const d = window.__duel;
    d.startFight();
    d.autoPlay(true);
  });
  const t0 = Date.now();
  let out = "timeout";
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__duel.game.state);
    if (s === "victory" || s === "defeat" || s === "dying") {
      out = s;
      break;
    }
  }
  await page.waitForTimeout(1500);
  const h = await hitches();
  fights.push({ out, secs: ((Date.now() - t0) / 1000).toFixed(1), ...h, ...(await res()) });
}
for (const [i, f] of fights.entries()) console.log(`fight ${i + 1}: ${f.out} in ${f.secs} s, ${f.avg.toFixed(0)} fps avg, worst frame ${f.worst.toFixed(1)} ms, >20 ms: ${f.over20}/${f.n}, geo ${f.geo} tex ${f.tex} prog ${f.prog} heap ${f.heap} MB`);
const r1 = await res();
report(fights.every((f) => f.out === "victory"), "stability: 5 bot fights back to back", fights.map((f) => f.out).join(", "));
report(r1.geo <= r0.geo + 4 && r1.tex <= r0.tex + 2 && r1.prog <= r0.prog + 2, "stability: no geometry/texture/program growth over 5 fights", `geo ${r0.geo}->${r1.geo}, tex ${r0.tex}->${r1.tex}, programs ${r0.prog}->${r1.prog}, heap ${r0.heap}->${r1.heap} MB`);
const over = fights.reduce((a, f) => a + f.over20, 0);
const frames = fights.reduce((a, f) => a + f.n, 0);
report(over <= Math.max(3, frames * 0.002), "stability: frame hitches >20 ms in combat (5 fights)", `${over} of ${frames} frames, worst ${Math.max(...fights.map((f) => f.worst)).toFixed(1)} ms`);

// ------------------------------------------------------------ fuzz
await page.evaluate(() => {
  const d = window.__duel;
  d.startFight();
  d.autoPlay(false);
  window.__fuzz = { stuck: [], restarts: 0, maxP: 0, samples: 0, nan: 0 };
  const g = d.game;
  const inp = g.input;
  let s = 7;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const acts = ["attack", "attack", "block", "block", "dodge", "jump", "jump", "lock", "heal"];
  const keys = ["Enter", "KeyE", "Escape", "KeyJ", "Space"];
  const since = { p: g.player.state, pt: performance.now(), b: g.boss.state, bt: performance.now() };
  window.__fuzzT = setInterval(() => {
    const now = performance.now();
    if (R() < 0.6) {
      const a = acts[Math.floor(R() * acts.length)];
      inp.press(a);
      const hold = R() < 0.3 ? 80 + R() * 700 : 30;
      setTimeout(() => inp.release(a), hold);
    }
    if (R() < 0.3) inp.botAxis = R() < 0.2 ? null : { x: Math.round(R() * 2 - 1), y: Math.round(R() * 2 - 1) };
    const f = window.__fuzz;
    f.samples++;
    const p = g.player;
    const b = g.boss;
    if (!Number.isFinite(p.pos.x + p.pos.z + b.pos.x + b.pos.z + g.camera.position.x)) f.nan++;
    if (p.state !== since.p) {
      since.p = p.state;
      since.pt = now;
    }
    // A new attack instance (strings chain attack → attack) restarts the clock too.
    if (b.state !== since.b || b.serial !== since.bs) {
      since.b = b.state;
      since.bs = b.serial;
      since.bt = now;
    }
    const pLong = !["move", "dead", "finisher", "victory"].includes(p.state) && now - since.pt > 3000;
    const bLong = ["attack", "block", "recoil", "flinch", "whiff", "mikiried", "kicked", "throw", "rise"].includes(b.state) && now - since.bt > 4000;
    if ((pLong || bLong) && f.stuck.length < 10) f.stuck.push(`${p.state}/${b.state}@${g.gameTime.toFixed(1)}`);
    // Menu keys arrive through the prompt (mashed like a player would); the fuzz keeps going
    // through deaths, resurrections, defeats, victories and the title.
    if (R() < 0.3) {
      const was = g.state;
      const k = inp.promptPress(keys[Math.floor(R() * keys.length)]);
      if (k) f.restarts++;
      if (k && was === "victory") f.wins = (f.wins ?? 0) + 1;
    }
    if (g.state === "title" && R() < 0.05) d.startFight();
  }, 60);
});
const tf0 = Date.now();
while (Date.now() - tf0 < fuzzSecs * 1000) await page.waitForTimeout(5000);
const fz = await page.evaluate(() => {
  clearInterval(window.__fuzzT);
  window.__duel.game.input.botAxis = null;
  return window.__fuzz;
});
const hf = await hitches();
const r2 = await res();
report(fz.stuck.length === 0 && fz.nan === 0, `stability: ${fuzzSecs} s random-input fuzz, no stuck states / NaN`, `${fz.samples} ticks, ${fz.restarts} restarts, stuck: ${fz.stuck.join(" ") || "none"}, NaN ${fz.nan}`);
report(hf.over20 <= Math.max(3, hf.n * 0.002), "stability: fuzz frame hitches >20 ms", `${hf.over20} of ${hf.n} frames, worst ${hf.worst.toFixed(1)} ms, ${hf.avg.toFixed(0)} fps avg`);
report(r2.geo <= r0.geo + 4 && r2.tex <= r0.tex + 2 && r2.prog <= r0.prog + 2, "stability: no resource growth after fuzz", `geo ${r2.geo}, tex ${r2.tex}, programs ${r2.prog}, heap ${r2.heap} MB`);

// ------------------------------------------------------------ tab switch + resize
await page.evaluate(() => window.__duel.startFight());
const gt0 = await page.evaluate(() => window.__duel.game.gameTime);
const other = await browser.newPage();
await other.goto("about:blank");
await other.bringToFront();
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await other.waitForTimeout(3000);
await page.bringToFront();
await other.close();
await page.waitForTimeout(1500);
const back = await page.evaluate(() => ({ gt: window.__duel.game.gameTime, fps: window.__duel.game.fps, st: window.__duel.game.state }));
report(Number.isFinite(back.gt) && back.gt > gt0 && back.fps > 50, "stability: tab switch and back", `game clock ${gt0.toFixed(1)} -> ${back.gt.toFixed(1)} s, ${back.fps.toFixed(0)} fps after return, state ${back.st}`);

const sizes = [];
for (const [w, h] of [[900, 600], [1920, 1080], [1280, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(700);
  sizes.push(await page.evaluate(([w, h]) => {
    const g = window.__duel.game;
    const c = g.renderer.domElement;
    const pr = g.renderer.getPixelRatio();
    return { w, h, ok: Math.abs(c.width - Math.floor(w * pr)) <= 1 && Math.abs(g.camera.aspect - w / h) < 1e-3, cw: c.width, ch: c.height };
  }, [w, h]));
}
report(sizes.every((s) => s.ok), "stability: resize updates canvas + camera", sizes.map((s) => `${s.w}x${s.h}->${s.cw}x${s.ch}`).join(", "));

await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.slice(0, 20).join("\n"));
  fails++;
} else console.log("no console/page errors");
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
