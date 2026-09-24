// Reference frames from a YouTube search's first result → shinobi-duel/research/ (delete after).
// Usage: node tools/frames.mjs "<query>" <prefix> <startSec> <count> <everySec>
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [q, prefix, start = "30", count = "6", every = "1"] = process.argv.slice(2);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "research");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
const page = await ctx.newPage();
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
for (const label of ["Reject all", "Accept all"]) {
  const b = page.getByRole("button", { name: label }).first();
  if (await b.isVisible().catch(() => false)) {
    await b.click();
    await page.waitForTimeout(2000);
    break;
  }
}
const href = await page.locator("a#video-title").first().getAttribute("href");
console.log("video:", href);
const id = new URL(href, "https://www.youtube.com").searchParams.get("v");
await page.goto(`https://www.youtube.com/watch?v=${id}&t=${start}s`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
// Skip ads if present.
for (let i = 0; i < 6; i++) {
  const skip = page.locator(".ytp-skip-ad-button, .ytp-ad-skip-button-modern").first();
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
  const ad = await page.locator(".ad-showing").count();
  if (!ad) break;
  await page.waitForTimeout(3000);
}
await page.evaluate((s) => {
  const v = document.querySelector("video");
  if (v) {
    v.currentTime = s;
    v.play();
  }
}, +start);
await page.waitForTimeout(1500);
const player = page.locator("#movie_player");
for (let i = 0; i < +count; i++) {
  const t = await page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);
  await player.screenshot({ path: join(out, `${prefix}_${i}.png`) });
  console.log(prefix, i, t.toFixed(2));
  await page.waitForTimeout(+every * 1000);
}
await browser.close();
