// Reference-gathering helper: screenshots of image searches → shinobi-duel/research/ (delete after).
// Usage: node tools/research.mjs "query one" "query two" ...
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "research");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
for (const q of process.argv.slice(2)) {
  await page.goto(`https://www.bing.com/images/search?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const name = q.replace(/[^a-z0-9]+/gi, "_").slice(0, 50);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(name);
}
await browser.close();
