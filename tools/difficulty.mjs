// Difficulty choice on the title, with real keyboard / mouse events on the live loop:
// A / D, the arrows, 1 / 2 / 3 and clicks change the selection and never start the fight; the
// choice survives a reload (localStorage); `?difficulty=` overrides it without storing it; one key
// starts the fight on the chosen preset; three rounds of die → resurrect → die → defeat → restart
// keep it (no loop, one fight per restart); Esc → title → a new choice applies to the next fight
// only; `__duel.setDifficulty` + startFight for tests. Usage: node tools/difficulty.mjs
import { launch, URL } from "./gpu.mjs";

const base = URL.replace(/\?.*$/, "");
const { browser, page, errors } = await launch({ width: 960, height: 540 });
let fails = 0;
const check = (ok, name, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  —  ${detail}`);
};
const st = () =>
  page.evaluate(() => {
    const d = window.__duel;
    const g = d.game;
    const [chosen, running] = d.difficulty();
    return {
      state: g.state,
      fights: g.fightsStarted,
      chosen,
      running,
      shown: document.querySelector("#title .diff .opt.on")?.dataset.difficulty ?? "",
      mark: document.querySelector("#playerbar .diffmark")?.dataset.difficulty ?? "",
      stored: localStorage.getItem("shinobi-duel.difficulty"),
      early: d.rules.DIFFICULTY.deflectEarly,
      gourdMax: d.rules.GOURD.charges,
      p: { hp: +g.player.health.toFixed(1), rez: g.player.rez, gourd: g.player.gourd },
      armed: g.input.promptArmed,
      end: document.getElementById("end").dataset.kind ?? "",
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
const clickOpt = async (id) => {
  const box = await page.locator(`#title .diff .opt[data-difficulty="${id}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const EXPECT = { easy: { early: 0.3, gourd: 4 }, medium: { early: 0.25, gourd: 3 }, hard: { early: 0.2, gourd: 3 } };

// ------------------------------------------------------------------ title selection
await page.evaluate(() => localStorage.removeItem("shinobi-duel.difficulty"));
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__duel && window.__duel.ready, null, { timeout: 60000 });
await page.waitForTimeout(800);
let s = await st();
check(s.state === "title" && s.chosen === "medium" && s.shown === "medium" && s.running === "medium", "default is medium", `state ${s.state}, chosen ${s.chosen}, shown ${s.shown}, running ${s.running}`);

const seq = [
  ["ArrowLeft", "easy"],
  ["KeyA", "easy"],
  ["KeyD", "medium"],
  ["ArrowRight", "hard"],
  ["KeyD", "hard"],
  ["Digit1", "easy"],
  ["Numpad2", "medium"],
  ["Digit3", "hard"],
];
let seqOk = true;
const seqLog = [];
for (const [k, want] of seq) {
  await page.keyboard.press(k);
  await page.waitForTimeout(120);
  s = await st();
  seqLog.push(`${k}->${s.chosen}`);
  if (s.chosen !== want || s.shown !== want || s.state !== "title" || s.fights !== 0) seqOk = false;
}
check(seqOk, "selection keys change the choice and never start the fight", `${seqLog.join(", ")}; state ${s.state}, fights ${s.fights}`);
await clickOpt("medium");
await page.waitForTimeout(150);
await clickOpt("easy");
await page.waitForTimeout(300);
s = await st();
check(s.chosen === "easy" && s.shown === "easy" && s.state === "title" && s.fights === 0, "clicking an option selects it and never starts the fight", `chosen ${s.chosen}, state ${s.state}, fights ${s.fights}`);
check(s.stored === "easy" && s.running === "medium", "the choice is remembered, not applied before a fight", `stored ${s.stored}, running ${s.running}`);

await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__duel && window.__duel.ready, null, { timeout: 60000 });
await page.waitForTimeout(800);
s = await st();
check(s.chosen === "easy" && s.shown === "easy" && s.state === "title", "the choice survives a reload", `chosen ${s.chosen}, shown ${s.shown}`);

// ------------------------------------------------------------------ fight + death loop on easy
await page.keyboard.press("Enter");
s = await waitFor((s) => s.state === "fight");
check(
  s.state === "fight" && s.fights === 1 && s.running === "easy" && s.early === EXPECT.easy.early && s.p.gourd === EXPECT.easy.gourd && s.mark === "easy",
  "one key starts the fight on the chosen preset",
  `state ${s.state}, fights ${s.fights}, running ${s.running}, deflectEarly ${s.early}, gourd ${s.p.gourd}, mark ${s.mark}`,
);

for (let round = 1; round <= 3; round++) {
  await page.waitForTimeout(1200);
  const f0 = (await st()).fights;
  await kill();
  s = await waitFor((s) => s.end === "death" && s.armed, 8000);
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  s = await waitFor((s) => s.state === "fight");
  check(s.state === "fight" && s.p.rez === 0 && s.running === "easy" && s.early === EXPECT.easy.early && s.fights === f0, `round ${round}: resurrection keeps easy`, `state ${s.state}, rez ${s.p.rez}, running ${s.running}, early ${s.early}, fights ${f0}->${s.fights}`);
  // In the fight the selector keys are just movement / nothing.
  await page.evaluate(() => (window.__duel.game.boss.passive = true));
  for (const k of ["Digit3", "KeyD", "ArrowRight", "Digit2"]) await page.keyboard.press(k);
  await page.waitForTimeout(400);
  s = await st();
  check(s.chosen === "easy" && s.running === "easy" && s.fights === f0 && s.state === "fight", `round ${round}: selector keys do nothing mid-fight`, `chosen ${s.chosen}, running ${s.running}, fights ${s.fights}`);
  await kill();
  s = await waitFor((s) => s.state === "defeat" && s.armed, 8000);
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  s = await waitFor((s) => s.state === "fight");
  await page.waitForTimeout(1000);
  s = await st();
  check(
    s.state === "fight" && s.fights === f0 + 1 && s.running === "easy" && s.early === EXPECT.easy.early && s.p.gourd === EXPECT.easy.gourd && s.p.rez === 1 && s.mark === "easy",
    `round ${round}: restart after defeat keeps easy, one fight`,
    `state ${s.state}, fights ${f0}->${s.fights}, running ${s.running}, gourd ${s.p.gourd}, rez ${s.p.rez}, mark ${s.mark}`,
  );
}

// ------------------------------------------------------------------ Esc → title → a new choice
await page.evaluate(() => (window.__duel.game.player.rez = 0));
await kill();
s = await waitFor((s) => s.state === "defeat" && s.armed, 8000);
await page.waitForTimeout(300);
const f1 = s.fights;
await page.keyboard.press("Escape");
s = await waitFor((s) => s.state === "title");
await page.waitForTimeout(500);
s = await st();
check(s.state === "title" && s.shown === "easy" && s.fights === f1, "defeat → Esc → title keeps the choice highlighted", `state ${s.state}, shown ${s.shown}, fights ${s.fights}`);
await page.keyboard.press("KeyD");
await page.keyboard.press("KeyD");
await page.waitForTimeout(200);
s = await st();
check(s.state === "title" && s.chosen === "hard" && s.running === "easy" && s.fights === f1, "a new choice on the title applies only to the next fight", `state ${s.state}, chosen ${s.chosen}, running ${s.running}, fights ${s.fights}`);
await page.keyboard.press("KeyJ");
s = await waitFor((s) => s.state === "fight");
await page.waitForTimeout(600);
s = await st();
check(s.state === "fight" && s.fights === f1 + 1 && s.running === "hard" && s.early === EXPECT.hard.early && s.p.gourd === EXPECT.hard.gourd && s.stored === "hard", "one key → one fight on hard", `fights ${f1}->${s.fights}, running ${s.running}, early ${s.early}, gourd ${s.p.gourd}, stored ${s.stored}`);

// ------------------------------------------------------------------ test hooks
const hook = await page.evaluate(() => {
  const d = window.__duel;
  d.setDifficulty("medium");
  const midFight = d.difficulty();
  d.game.startFight();
  const after = { run: d.difficulty(), early: d.rules.DIFFICULTY.deflectEarly, gourd: d.game.player.gourd, steps: d.rules.DEFLECT_STEPS.join("/") };
  d.setDifficulty("bogus");
  return { midFight, after, bogus: d.difficulty()[0], stored: localStorage.getItem("shinobi-duel.difficulty") };
});
check(
  hook.midFight[0] === "medium" && hook.midFight[1] === "hard" && hook.after.run[1] === "medium" && hook.after.early === 0.25 && hook.after.gourd === 3 && hook.after.steps === "0.25/0.25/0.22/0.19/0.16" && hook.bogus === "medium" && hook.stored === "hard",
  "__duel.setDifficulty: next fight only, ignores bad names, doesn't touch the stored choice",
  JSON.stringify(hook),
);
await page.goto(`${base}?difficulty=easy`, { waitUntil: "load" });
await page.waitForFunction(() => window.__duel && window.__duel.ready, null, { timeout: 60000 });
await page.waitForTimeout(500);
s = await st();
check(s.chosen === "easy" && s.shown === "easy" && s.stored === "hard", "?difficulty= overrides the stored choice without storing it", `chosen ${s.chosen}, stored ${s.stored}`);
await page.evaluate(() => localStorage.removeItem("shinobi-duel.difficulty"));

await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  fails++;
}
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
