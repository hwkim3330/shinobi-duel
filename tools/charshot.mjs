// Close-up screenshots of skinned-body poses (?debug=anim) → shots/char_<who>_<clip>_<t>.png.
// Usage: node tools/charshot.mjs <player|boss> <clip@t,...> [--sword ox,oy,oz,rx,ry,rz] [--view dist,side,up]
//   e.g. node tools/charshot.mjs player idle@0.5,attack1@0.2 --view 1.6,1.2,0.2
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "shots");
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1].split(",").map(Number) : null);
const who = args[0] ?? "player";
const shots = (args[1] ?? "idle@0").split(",").map((s) => s.split("@"));
const sword = opt("--sword");
const view = opt("--view");

const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || m.text().includes("[chars]")) && errors.push(m.text()));
await page.goto((process.env.DUEL_URL ?? "http://localhost:5411/") + "?debug=anim&anyclips", { waitUntil: "load" });
await page.waitForFunction(() => window.__duel?.ready && window.__duel.anim, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: "#animdbg,#title,#hud,#end{display:none!important}" });
for (const [clip, t] of shots) {
  const r = await page.evaluate(
    ({ who, clip, t, sword, view }) => {
      const A = window.__duel.anim;
      if (view) A.view(...view);
      if (sword) A.tuneSword(who, sword.slice(0, 3), sword.slice(3, 6));
      return A.scrub(who, clip, +t);
    },
    { who, clip, t, sword, view },
  );
  await page.waitForTimeout(120);
  const f = join(out, `char_${who}_${clip}_${t}.png`);
  await page.screenshot({ path: f });
  console.log(f, "hilt", r.hilt.map((x) => x.toFixed(2)).join(","), "tip", r.tip.map((x) => x.toFixed(2)).join(","));
}
await browser.close();
if (errors.length) console.log("ERRORS/WARN:\n" + errors.join("\n"));
