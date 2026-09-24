// Headless Chromium on the real GPU (ANGLE/D3D11). Refuses to run on a software rasterizer so
// screenshots and fps numbers are meaningful.
import { chromium } from "playwright";

export const URL = process.env.DUEL_URL ?? "http://localhost:5411/";

export async function launch({ width = 1600, height = 900 } = {}) {
  // DUEL_VIEW=960x540 forces a small viewport (light GPU load while the machine is shared).
  const view = /^(\d+)x(\d+)$/.exec(process.env.DUEL_VIEW ?? "");
  if (view) [width, height] = [+view[1], +view[2]];
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: [
      "--use-angle=d3d11",
      "--use-gl=angle",
      "--enable-gpu",
      "--enable-gpu-rasterization",
      "--ignore-gpu-blocklist",
      "--force_high_performance_gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("crash", () => console.log("!! page crashed"));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__duel && window.__duel.ready, null, { timeout: 60000 });
  const renderer = await page.evaluate(() => window.__duel.stats().renderer);
  if (/swiftshader|llvmpipe|basic render|software/i.test(renderer)) {
    await browser.close();
    throw new Error(`Refusing to run on a software renderer: ${renderer}`);
  }
  return { browser, page, errors, renderer };
}
