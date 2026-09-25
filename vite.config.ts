import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";

/** Build id: netplay only pairs two copies of the same build (the lockstep needs identical code). */
function buildId(): string {
  try {
    return execSync("git rev-parse --short=10 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}

// GitHub Pages serves under /shinobi-duel/ (GITHUB_PAGES=1 in the workflow); everything else
// (dev, Vercel, any static host) uses a relative base.
const base = process.env.GITHUB_PAGES ? "/shinobi-duel/" : "./";

/**
 * `virtual:char-assets`: which character files exist, so the game only ever requests files that
 * are there (no 404s when the Mixamo assets haven't arrived). GLBs come from
 * public/assets/chars/; raw Mixamo FBX from assets/mixamo/<who>/ are offered by the dev server
 * only. Adding or removing files reloads the page.
 */
function charAssets(): Plugin {
  const id = "virtual:char-assets";
  const rid = "\0" + id;
  const root = process.cwd();
  const glbDir = resolve(root, "public/assets/chars");
  const fbxDir = resolve(root, "assets/mixamo");
  let serve = false;
  const list = (dir: string, ext: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => extname(f).toLowerCase() === ext) : []);
  const scan = () => {
    const glb: Record<string, string> = {};
    for (const f of list(glbDir, ".glb")) glb[basename(f, ".glb").toLowerCase()] = `assets/chars/${f}`;
    const fbx: Record<string, Record<string, string>> = {};
    // Raw FBX only on request (CHARS_FBX=1): the GLB is the shipping path, and Mixamo downloads
    // landing in assets/mixamo/ must not reload a running page.
    if (serve && process.env.CHARS_FBX === "1")
      for (const who of ["player", "boss"]) {
        const files = list(join(fbxDir, who), ".fbx");
        if (files.length) fbx[who] = Object.fromEntries(files.map((f) => [basename(f, extname(f)).toLowerCase(), `/assets/mixamo/${who}/${f}`]));
      }
    return { glb, fbx };
  };
  return {
    name: "char-assets",
    configResolved(c) {
      serve = c.command === "serve";
    },
    resolveId: (i) => (i === id ? rid : undefined),
    load: (i) => (i === rid ? `export default ${JSON.stringify(scan())};` : undefined),
    configureServer(server) {
      server.watcher.add(process.env.CHARS_FBX === "1" ? [glbDir, fbxDir] : [glbDir]);
      const onChange = (file: string) => {
        const f = resolve(file);
        if (!f.startsWith(glbDir) && !(process.env.CHARS_FBX === "1" && f.startsWith(fbxDir))) return;
        const m = server.moduleGraph.getModuleById(rid);
        if (m) server.moduleGraph.invalidateModule(m);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

export default defineConfig({
  base,
  define: { __BUILD__: JSON.stringify(process.env.DUEL_BUILD ?? buildId()) },
  plugins: [charAssets()],
  server: { port: 5411, strictPort: true, open: false },
  preview: { port: 5410, strictPort: true, open: false },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
