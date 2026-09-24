// Social preview + README stills from the running game (dev server: the title is lettered with
// the game's own brush code, src/ui/brush.ts). Writes media/og.png, public/og.jpg and media/*.jpg.
// Usage: node tools/og.mjs [og] [stills]
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { launch } from "./gpu.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const media = join(root, "media");
mkdirSync(media, { recursive: true });
const want = process.argv.slice(2);
const doOg = !want.length || want.includes("og");
const doStills = !want.length || want.includes("stills");

/** Runs a set piece, hides the HUD and (optionally) frames it from a camera placed relative to the fighters' midpoint. */
async function frame(page, name, cam, extra = 0, hud = false) {
  await page.evaluate(
    ([n, c, e, h]) => {
      const d = window.__duel;
      d.scene(n);
      if (e) d.step(e / 60);
      document.getElementById("hud").style.visibility = h ? "visible" : "hidden";
      if (c) {
        const g = d.game;
        const V = g.player.pos.constructor;
        const P = g.player.pos;
        const B = g.boss.pos;
        const mx = (P.x + B.x) / 2;
        const mz = (P.z + B.z) / 2;
        g.cam.override = { pos: new V(mx + c[0], c[1], mz + c[2]), look: new V(mx + c[3], c[4], mz + c[5]) };
        d.step(1 / 60);
      }
    },
    [name, cam, extra, hud],
  );
  await page.waitForTimeout(400);
}

const errors = [];

if (doOg) {
  const { browser, page, errors: e } = await launch({ width: 1280, height: 640 });
  await frame(page, "deflect", [2.7, 0.8, 2.5, -1.1, 1.6, -0.5], 1);
  await page.evaluate(async () => {
    const { brushText, brushStroke, LATIN_FONT } = await import("/src/ui/brush.ts");
    const url = (c) => c.toDataURL();
    const o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;z-index:50;pointer-events:none;font-family:" + LATIN_FONT;
    o.innerHTML = `
      <div style="position:absolute;inset:0;background:
        linear-gradient(90deg, rgba(9,7,12,.86) 0%, rgba(9,7,12,.62) 24%, rgba(9,7,12,.18) 44%, rgba(9,7,12,0) 58%),
        linear-gradient(0deg, rgba(9,7,12,.55) 0%, rgba(9,7,12,0) 26%),
        radial-gradient(120% 90% at 62% 40%, rgba(0,0,0,0) 55%, rgba(6,4,8,.45) 100%)"></div>
      <img id="k" style="position:absolute;left:14px;top:-4px;width:520px">
      <img id="s" style="position:absolute;left:58px;top:262px;width:450px;opacity:.95">
      <img id="l" style="position:absolute;left:44px;top:302px;width:470px">
      <div style="position:absolute;left:78px;top:420px;width:470px;color:rgba(239,231,218,.9);font-style:italic;font-size:25px;letter-spacing:.05em;line-height:1.35;text-shadow:0 2px 10px rgba(0,0,0,.8)">
        Deflect his blade. Break his posture.<br>Land the deathblow.
      </div>
      <div style="position:absolute;left:80px;bottom:40px;color:rgba(232,222,206,.62);font-size:15px;letter-spacing:.22em;text-transform:uppercase;text-shadow:0 1px 6px rgba(0,0,0,.9)">
        Plays in your browser
      </div>
      <img id="h" style="position:absolute;left:448px;top:66px;width:72px;opacity:.92">`;
    document.body.append(o);
    const set = (id, c) => new Promise((r) => { const i = o.querySelector("#" + id); i.onload = r; i.src = url(c); });
    // Hanko seal: a red square with the kanji knocked out in white-ish paper.
    const seal = document.createElement("canvas");
    seal.width = seal.height = 160;
    const sg = seal.getContext("2d");
    const ink = brushText("忍", { size: 150, color: "#b8261a", seed: 5, dry: 0.25, splatter: 0, pad: 0 });
    sg.fillStyle = "#b8261a";
    sg.fillRect(10, 10, 140, 140);
    sg.globalCompositeOperation = "destination-out";
    const glyph = brushText("忍", { size: 112, color: "#ffffff", seed: 9, dry: 0.4, splatter: 0, pad: 0 });
    sg.drawImage(glyph, 80 - glyph.width / 2, 80 - glyph.height / 2);
    sg.globalCompositeOperation = "destination-out";
    sg.lineWidth = 5;
    sg.strokeRect(22, 22, 116, 116);
    void ink;
    await Promise.all([
      set("k", brushText("雪刃", { size: 260, color: "#f1ebe0", seed: 21, weight: 500, dry: 0.7, splatter: 0.6, glow: "rgba(255,120,40,0.32)" })),
      set("s", brushStroke(900, 110, "#9a1d12", 5)),
      set("l", brushText("SHINOBI DUEL", { size: 64, font: LATIN_FONT, weight: 700, color: "#efe7da", seed: 4, dry: 0.35, splatter: 0.1, letterSpacing: 0.28 })),
      set("h", seal),
    ]);
  });
  await page.waitForTimeout(300);
  const png = await page.screenshot({ type: "png" });
  await sharp(png).png({ compressionLevel: 9, palette: true, quality: 95, dither: 0.6 }).toFile(join(media, "og.png"));
  await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(join(root, "public", "og.jpg"));
  errors.push(...e);
  await browser.close();
  console.log("og: media/og.png, public/og.jpg");
}

if (doStills) {
  const { browser, page, errors: e } = await launch({ width: 1600, height: 900 });
  const stills = [
    ["01-duel", "portrait", null, 0],
    ["02-perilous", "fight", null, 0, true],
    ["03-deflect", "deflect", [3.6, 1.4, 1.6, 0.4, 1.25, 0], 0],
    ["04-deathblow", "finisher", null, 0, true],
  ];
  for (const [file, name, cam, extra, hud] of stills) {
    await frame(page, name, cam, extra, hud);
    const png = await page.screenshot({ type: "png" });
    await sharp(png).resize(1280).jpeg({ quality: 84, mozjpeg: true }).toFile(join(media, `${file}.jpg`));
    console.log("still:", file);
  }
  errors.push(...e);
  await browser.close();
}

if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("no console/page errors");
