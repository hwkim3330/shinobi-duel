// Two real browsers, one duel over the lobby server: the kunoichi side runs the deflect bot on its
// keyboard controller, the general side mashes his moveset. Both run the whole fight themselves;
// the check is that they agree (state hashes every second, and the final outcome) and never stall.
//   node tools/netplay.mjs [seconds]      (needs server/server.mjs on :7860 serving dist/)
import { launch } from "./gpu.mjs";
const BASE = process.env.NET_URL ?? "http://localhost:7860/";
const SECS = +(process.argv[2] ?? 60);
// NET_EXTRA="&p2p=0&lag=60" forces the relay and adds 60 ms each way; NET_DESYNC=1 corrupts the
// guest's copy of the fight once, to exercise the resync.
const EXTRA = process.env.NET_EXTRA ?? "";
const room = "T" + Math.random().toString(36).slice(2, 6).toUpperCase();
const A = await launch({ width: 800, height: 450, url: `${BASE}?room=${room}&as=shinobi&host=1${EXTRA}` });
if (process.env.NET_LOBBY_WAIT) await new Promise((r) => setTimeout(r, +process.env.NET_LOBBY_WAIT));
const B = await launch({ width: 800, height: 450, url: `${BASE}?room=${room}${EXTRA}` });
const started = (p) => p.waitForFunction(() => window.__duel.game.net && !window.__duel.game.netLobby, null, { timeout: 40000 });
await Promise.all([started(A.page), started(B.page)]);
const info = (p) => p.evaluate(() => { const g = window.__duel.game; return { role: g.localRole, delay: g.net.delay, host: g.net.host }; });
console.log("A", await info(A.page), "B", await info(B.page));
await A.page.evaluate(() => { const g = window.__duel.game; Object.assign(g.bot, { dom: true, play: true, deflect: true, jitter: 0.04, miss: 0.12 }); });
await B.page.evaluate(() => {
  const g = window.__duel.game; const d = g.dom;
  const keys = ["attack", "attack", "heavy", "feint", "thrust", "sweep", "leap", "grab", "flurry"];
  let i = 0;
  setInterval(() => {
    const b = g.boss, p = g.player;
    const dist = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    d.botAxis = dist > 2.6 ? { x: 0, y: 1 } : { x: (i % 2) ? 0.6 : -0.6, y: 0 };
    const k = keys[(i++ * 7) % keys.length];
    d.press(k); setTimeout(() => d.release(k), 60);
    if (i % 5 === 0) { d.press("block"); setTimeout(() => d.release("block"), 400); }
    if (g.state === "victory" || g.state === "defeat") g.netFlags |= 4;
  }, 450);
});
await A.page.evaluate(() => setInterval(() => { const g = window.__duel.game; if (g.state === "dying" && g.promptShown) g.netFlags |= 1; if (g.state === "victory" || g.state === "defeat") g.netFlags |= 4; }, 300));
const snap = (p) => p.evaluate(() => { const g = window.__duel.game, n = g.net; return { tick: n.tick, state: g.state, pH: +g.player.health.toFixed(2), bH: +g.boss.health.toFixed(2), bM: g.boss.markers, desync: n.desyncs, resync: n.resyncs, rtt: Math.round(n.rtt), stall: +n.stalledFor.toFixed(2), fights: g.fightsStarted, fps: Math.round(g.fps), deflects: g.stats.deflects, hits: g.stats.hitsTaken, pHits: g.stats.playerHits }; });
let maxStall = 0;
if (process.env.NET_DESYNC) setTimeout(() => void B.page.evaluate(() => { window.__duel.game.boss.health -= 7; window.__duel.game.player.pos.x += 0.3; }), 12000);
for (let t = 0; t < SECS; t += 5) {
  await A.page.waitForTimeout(5000);
  const [a, b] = await Promise.all([snap(A.page), snap(B.page)]);
  maxStall = Math.max(maxStall, a.stall, b.stall);
  console.log(`${t + 5}s`, JSON.stringify(a), "|", JSON.stringify(b));
}
const path = await A.page.evaluate(() => window.__duel.game.net.t.path);
console.log("path", path, "maxStall", maxStall, "errorsA", A.errors, "errorsB", B.errors);
await A.browser.close(); await B.browser.close();
