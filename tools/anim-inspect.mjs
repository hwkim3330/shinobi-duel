// Clip inspector (headless side of ?debug=anim): lists each fighter's clips with durations, the
// event timeline combat currently reads, and windows suggested from the blade-tip speed curve.
// Usage: node tools/anim-inspect.mjs [player|boss] [clip] [--at seconds]
//   no clip  → every clip with duration; attack clips also get events vs suggestion
//   clip     → that clip only; --at poses it and prints hilt/tip world positions
import { chromium } from "playwright";

const URL = (process.env.DUEL_URL ?? "http://localhost:5411/") + "?debug=anim";
const args = process.argv.slice(2);
const at = args.includes("--at") ? +args[args.indexOf("--at") + 1] : null;
const pos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--at");
const whoArg = pos[0];
const clipArg = pos[1];

const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__duel?.ready && window.__duel.anim, null, { timeout: 60000 });
// Skinned bodies (if any) load asynchronously.
await page.waitForTimeout(1500);

const report = await page.evaluate(
  ({ whoArg, clipArg, at }) => {
    const A = window.__duel.anim;
    const out = [];
    for (const who of whoArg ? [whoArg] : ["player", "boss"]) {
      const clips = A.list(who);
      out.push(`\n== ${who} (${A.kind(who)}) — ${clips.length} clips`);
      for (const c of clips) {
        if (clipArg && c.name !== clipArg) continue;
        out.push(`  ${c.name.padEnd(14)} ${c.dur.toFixed(3)} s${c.loop ? "  loop" : ""}`);
        const tl = A.timeline(who, c.name);
        const attack = /attack|combo|overhead|thrust|leap|finisher/.test(c.name);
        if (!attack && !clipArg) continue;
        const f = (h) => `${h.start.toFixed(3)}-${h.end.toFixed(3)} (contact ${h.contact.toFixed(3)})`;
        out.push(`    events:    hits ${tl.hits.map(f).join(", ") || "-"}; windupPeak ${tl.windupPeak.map((x) => x.toFixed(3)).join(", ") || "-"}; end ${tl.end.toFixed(3)}`);
        const s = A.suggest(who, c.name);
        out.push(`    suggested: hits ${s.hits.map(f).join(", ") || "-"}; windupPeak ${s.windupPeak.join(", ") || "-"}; peak tip speed ${s.peakSpeed} m/s`);
        if (c.dur > 0) out.push(`    normalized suggestion: ${JSON.stringify({ norm: true, hits: s.hits.map((h) => ({ start: +(h.start / c.dur).toFixed(3), end: +(h.end / c.dur).toFixed(3), contact: +(h.contact / c.dur).toFixed(3) })), windupPeak: s.windupPeak.map((x) => +(x / c.dur).toFixed(3)) })}`);
        if (at !== null && clipArg) {
          const p = A.scrub(who, c.name, at);
          out.push(`    at ${at}s: hilt ${p.hilt.map((x) => x.toFixed(3)).join(",")}  tip ${p.tip.map((x) => x.toFixed(3)).join(",")}`);
        }
      }
    }
    return out.join("\n");
  },
  { whoArg, clipArg, at },
);
console.log(report);
await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
