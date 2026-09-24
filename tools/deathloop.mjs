// Death / resurrection / defeat / restart repro on the real-time loop with real keyboard and
// mouse events (the bug: after the first death every key press restarted the fight, forever).
// Three rounds of: die (mashing keys while falling) → resurrect with one Enter → mash keys
// (must NOT restart) → die again → DEFEAT → mash during the beat → one Enter restarts cleanly
// → mash keys (must NOT restart again). Usage: node tools/deathloop.mjs
import { launch } from "./gpu.mjs";

const { browser, page, errors } = await launch({ width: 960, height: 540 });
let fails = 0;
const check = (ok, name, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  —  ${detail}`);
};
const st = () =>
  page.evaluate(() => {
    const g = window.__duel.game;
    return {
      state: g.state,
      fights: g.fightsStarted,
      p: { hp: +g.player.health.toFixed(1), state: g.player.state, rez: g.player.rez, gourd: g.player.gourd },
      b: { hp: +g.boss.health.toFixed(1), posture: +g.boss.posture.toFixed(1), markers: g.boss.markers, state: g.boss.state },
      end: document.getElementById("end").dataset.kind ?? "",
      endShown: !document.getElementById("end").classList.contains("hidden"),
      armed: g.input.promptArmed,
    };
  });
const waitFor = async (pred, ms = 8000) => {
  const t0 = Date.now();
  let s = await st();
  while (!pred(s) && Date.now() - t0 < ms) {
    await page.waitForTimeout(50);
    s = await st();
  }
  return s;
};
/** Mash a mix of keys / clicks for `ms`. */
const mash = async (ms) => {
  const keys = ["KeyJ", "KeyK", "Space", "Enter", "KeyE", "KeyW", "ShiftLeft", "KeyR"];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    const k = keys[i++ % keys.length];
    await page.keyboard.down(k);
    await page.waitForTimeout(25);
    await page.keyboard.up(k);
    if (i % 3 === 0) await page.mouse.click(480, 270, { button: i % 2 ? "left" : "right" });
    await page.waitForTimeout(35);
  }
};
const kill = () =>
  page.evaluate(() => {
    const g = window.__duel.game;
    g.player.health = 1;
    g.player.enter("move");
    g.bot.play = g.bot.deflect = false;
    g.place(2.2);
    g.boss.passive = false;
    g.forceBossAttack("overhead");
  });

// Title → fight with one key.
await page.evaluate(() => window.__duel.toTitle());
await page.waitForTimeout(800);
await page.keyboard.press("Enter");
let s = await waitFor((s) => s.state === "fight");
check(s.state === "fight" && s.fights === 1, "title: one key starts the fight", `state ${s.state}, fights started ${s.fights}`);

for (let round = 1; round <= 3; round++) {
  await page.waitForTimeout(1500);
  // Chip him so the "boss keeps his progress" rule is visible.
  await page.evaluate(() => {
    const b = window.__duel.game.boss;
    b.health = 63;
    b.posture = 30;
  });
  const fights0 = (await st()).fights;
  await kill();
  s = await waitFor((s) => s.state === "dying");
  const bossAtDeath = s.b;
  await mash(700); // mashing while he falls: nothing may happen
  s = await st();
  check(s.state === "dying" && s.p.rez === 1, `round ${round}: keys during the death beat are ignored`, `state ${s.state}, rez ${s.p.rez}`);
  s = await waitFor((s) => s.endShown && s.end === "death" && s.armed, 5000);
  check(s.end === "death" && s.armed, `round ${round}: resurrection prompt shown`, `end=${s.end} armed=${s.armed}`);
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  s = await waitFor((s) => s.state === "fight");
  check(
    s.state === "fight" && s.p.state === "revive" && s.p.rez === 0 && s.p.hp === 50 && s.b.markers === bossAtDeath.markers && Math.abs(s.b.hp - bossAtDeath.hp) < 0.5 && s.fights === fights0,
    `round ${round}: one Enter resurrects on the spot, boss keeps his state`,
    `state ${s.state}/${s.p.state}, hp ${s.p.hp}, rez ${s.p.rez}, gourd ${s.p.gourd}, boss hp ${bossAtDeath.hp}->${s.b.hp} markers ${s.b.markers}, fights ${fights0}->${s.fights}`,
  );
  await page.evaluate(() => (window.__duel.game.boss.passive = true));
  await mash(1500);
  s = await st();
  check(s.state === "fight" && s.fights === fights0 && s.p.rez === 0, `round ${round}: mashing after resurrecting doesn't restart`, `state ${s.state}, fights ${s.fights}, rez ${s.p.rez}`);
  await page.waitForTimeout(1200);
  await kill();
  s = await waitFor((s) => s.state === "defeat", 6000);
  check(s.state === "defeat" && s.end === "defeat", `round ${round}: second death with no resurrection → defeat`, `state ${s.state}, end ${s.end}`);
  await mash(600);
  s = await st();
  check(s.state === "defeat" && s.fights === fights0, `round ${round}: keys before the defeat prompt are ignored`, `state ${s.state}, fights ${s.fights}`);
  s = await waitFor((s) => s.armed, 4000);
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  s = await waitFor((s) => s.state === "fight");
  check(
    s.state === "fight" && s.fights === fights0 + 1 && s.p.hp === 100 && s.p.rez === 1 && s.p.gourd === 3 && s.b.hp === 100 && s.b.markers === 2 && !s.endShown,
    `round ${round}: one Enter restarts the fight cleanly`,
    `fights ${fights0}->${s.fights}, player ${s.p.hp}/${s.p.rez} rez/${s.p.gourd} gourd, boss ${s.b.hp} hp ${s.b.markers} markers, end shown ${s.endShown}`,
  );
  await page.evaluate(() => (window.__duel.game.boss.passive = true));
  await mash(2000);
  s = await st();
  check(s.fights === fights0 + 1 && s.state !== "title", `round ${round}: mashing in the new fight doesn't restart it`, `fights ${s.fights}, state ${s.state}`);
}

// Esc on the defeat screen goes to the title; a key there starts one fight.
await page.evaluate(() => {
  const g = window.__duel.game;
  g.player.rez = 0;
});
await kill();
s = await waitFor((s) => s.state === "defeat" && s.armed, 8000);
await page.waitForTimeout(300);
const f0 = s.fights;
await page.keyboard.press("Escape");
s = await waitFor((s) => s.state === "title");
await page.waitForTimeout(500);
await page.keyboard.press("KeyJ");
s = await waitFor((s) => s.state === "fight");
await mash(800);
s = await st();
check(s.state === "fight" && s.fights === f0 + 1, "defeat → Esc → title → one key → one fight", `state ${s.state}, fights ${f0}->${s.fights}`);

await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  fails++;
}
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
