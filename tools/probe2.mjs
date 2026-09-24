import { launch } from "./gpu.mjs";
const { browser, page } = await launch();
await page.evaluate(() => window.__duel.scene("thrust"));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const d = [...document.body.children].find((e) => e.tagName === "DIV" && e.style.width === "13vh");
  d.style.background = "black";
});
await page.waitForTimeout(100);
await page.screenshot({ path: "shots/probe.png", clip: { x: 700, y: 100, width: 300, height: 220 } });
const r = await page.evaluate(() => [...document.body.children].map((e) => e.tagName + "#" + e.id + " z=" + getComputedStyle(e).zIndex + " pos=" + getComputedStyle(e).position));
console.log(r);
await browser.close();
