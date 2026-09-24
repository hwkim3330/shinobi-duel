/**
 * ?debug=anim — clip inspector for tuning src/chars/animEvents.ts.
 *
 * Lists each fighter's clips with durations, scrubs any clip (the game pauses; the camera frames
 * the fighter), marks the clip's current events on the timeline, shows hilt/tip markers and the
 * tip speed, and "suggest" proposes hit windows / wind-up peaks from the blade's speed curve.
 * `window.__duel.anim` exposes the same for tools/anim-inspect.mjs.
 */
import * as THREE from "three";
import type { Timeline } from "../chars/animEvents";
import type { Fighter } from "../chars/Fighter";
import type { Game } from "../game/Game";

type Who = "player" | "boss";

export interface Suggestion {
  clip: string;
  dur: number;
  hits: { start: number; end: number; contact: number }[];
  windupPeak: number[];
  peakSpeed: number;
}

function body(game: Game, who: Who): Fighter {
  return who === "player" ? game.playerBody : game.bossBody;
}

/** Tip position relative to the root, sampled across the clip. */
function sampleTip(f: Fighter, clip: string, dur: number, dt = 1 / 120): { t: number; p: THREE.Vector3 }[] {
  const out: { t: number; p: THREE.Vector3 }[] = [];
  for (let t = 0; t <= dur + 1e-6; t += dt) {
    f.scrub(clip, t);
    out.push({ t, p: f.rig.tipW.clone().sub(f.rig.root.position) });
  }
  return out;
}

/**
 * Hit windows from the blade's motion: a cut is fast tip travel while the tip is out in front of
 * the body (a wind-up is fast too, but behind or above). Contact = the tip's most forward
 * moment in the window; wind-up peak = the slowest moment in the 0.5 s before it.
 */
export function suggest(f: Fighter, clip: string): Suggestion {
  const info = f.listClips().find((c) => c.name === clip);
  const dur = info?.dur ?? 0;
  const s = sampleTip(f, clip, dur);
  const yaw = f.rig.yaw;
  const c = Math.cos(-yaw);
  const sn = Math.sin(-yaw);
  const fwd = s.map((x) => x.p.x * sn + x.p.z * c);
  const sp = s.map((x, i) => (i ? x.p.distanceTo(s[i - 1].p) / (x.t - s[i - 1].t) : 0));
  const peak = Math.max(0, ...sp);
  const reach = Math.max(0, ...fwd);
  const on = sp.map((v, i) => v > peak * 0.25 && fwd[i] > reach * 0.45);
  // Close 1-3 sample gaps so one cut isn't split.
  for (let i = 1; i < on.length - 1; i++) if (!on[i] && on[i - 1]) for (let k = i + 1; k < Math.min(on.length, i + 4); k++) if (on[k]) for (let m = i; m < k; m++) on[m] = true;
  const hits: Suggestion["hits"] = [];
  const windupPeak: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || (i > 0 && on[i - 1])) continue;
    let j = i;
    let best = i;
    while (j < on.length && on[j]) {
      if (fwd[j] > fwd[best]) best = j;
      j++;
    }
    if (s[Math.min(j, s.length - 1)].t - s[i].t < 0.03) continue;
    let w = i;
    for (let k = i; k >= 0 && s[i].t - s[k].t < 0.5; k--) if (sp[k] < sp[w]) w = k;
    hits.push({ start: +s[i].t.toFixed(3), end: +s[Math.min(j, s.length - 1)].t.toFixed(3), contact: +s[best].t.toFixed(3) });
    windupPeak.push(+s[w].t.toFixed(3));
    i = j;
  }
  return { clip, dur, hits, windupPeak, peakSpeed: +peak.toFixed(1) };
}

export function mountAnimDebug(game: Game): void {
  const css = document.createElement("style");
  css.textContent = `
  #animdbg { position: fixed; top: 10px; right: 10px; width: 330px; max-height: 92vh; overflow: auto; z-index: 10; background: rgba(12,10,9,0.88); color: #eee; font: 12px/1.35 ui-monospace, monospace; padding: 10px; border: 1px solid #555; pointer-events: auto; }
  #animdbg select, #animdbg button, #animdbg input { font: inherit; }
  #animdbg .clips { margin: 6px 0; max-height: 180px; overflow: auto; border: 1px solid #333; }
  #animdbg .clips div { padding: 1px 4px; cursor: pointer; } #animdbg .clips div.on { background: #6a2a18; }
  #animdbg .bar { position: relative; height: 18px; margin: 4px 0 2px; background: #222; }
  #animdbg .bar span { position: absolute; top: 0; bottom: 0; width: 2px; }
  #animdbg pre { white-space: pre-wrap; background: #111; padding: 4px; margin: 4px 0; }`;
  document.head.appendChild(css);
  const root = document.createElement("div");
  root.id = "animdbg";
  document.body.appendChild(root);
  root.innerHTML = `<b>anim debug</b> <select id="ad-who"><option value="player">player</option><option value="boss">boss</option></select> <span id="ad-kind"></span>
  <div class="clips" id="ad-clips"></div>
  <div class="bar" id="ad-bar"></div>
  <input id="ad-t" type="range" min="0" max="1" step="0.001" value="0" style="width:100%">
  <div><button id="ad-play">play</button> <button id="ad-sug">suggest</button> <button id="ad-copy">copy events</button> <button id="ad-exit">back to game</button></div>
  <div id="ad-info"></div><pre id="ad-ev"></pre>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>("#" + id)!;
  const markers = [0xffffff, 0xff5020].map((c) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
    m.renderOrder = 10;
    m.visible = false;
    game.scene.add(m);
    return m;
  });
  let who: Who = "player";
  let clip = "";
  let dur = 1;
  let t = 0;
  let playing = false;
  let last = performance.now();
  let lastTip = new THREE.Vector3();
  let active = false;
  let viewK: [number, number, number] = [2.6, 1.9, 0.3];

  const render = () => {
    const f = body(game, who);
    f.scrub(clip, t);
    const tip = f.rig.tipW.clone().sub(f.rig.root.position);
    const speed = tip.distanceTo(lastTip) * 120;
    lastTip = tip;
    markers[0].position.copy(f.rig.hiltW);
    markers[1].position.copy(f.rig.tipW);
    const c = f.rig.chestW;
    // Front three-quarter view of the fighter.
    const fwd = new THREE.Vector3(Math.sin(f.rig.yaw), 0, Math.cos(f.rig.yaw));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    game.cam.override = { pos: c.clone().addScaledVector(fwd, viewK[0]).addScaledVector(side, viewK[1]).add(new THREE.Vector3(0, viewK[2], 0)), look: c.clone() };
    game.frame(1 / 60, true);
    $("ad-info").textContent = `t ${t.toFixed(3)} s / ${dur.toFixed(3)} s  (${(t / dur).toFixed(3)} norm)  tip ~${speed.toFixed(1)} m/s`;
  };

  const showEvents = () => {
    const f = body(game, who);
    let tl: Timeline | null = null;
    try {
      tl = f.timeline(clip);
    } catch {
      tl = null;
    }
    const bar = $("ad-bar");
    bar.innerHTML = "";
    const mark = (at: number, color: string, title: string) => {
      if (at < 0 || !(dur > 0)) return;
      const s = document.createElement("span");
      s.style.left = `${Math.min(100, (at / dur) * 100)}%`;
      s.style.background = color;
      s.title = title;
      bar.appendChild(s);
    };
    if (tl) {
      tl.hits.forEach((h, i) => {
        const band = document.createElement("span");
        band.style.left = `${(h.start / dur) * 100}%`;
        band.style.width = `${((h.end - h.start) / dur) * 100}%`;
        band.style.background = "rgba(220,60,30,0.45)";
        band.title = `hit ${i}`;
        bar.appendChild(band);
        mark(h.contact, "#ff0", `contact ${i}`);
      });
      tl.windupPeak.forEach((g) => mark(g, "#8cf", "windupPeak"));
      mark(tl.plunge, "#f0f", "plunge");
      mark(tl.leapOff, "#0f8", "leapOff");
      mark(tl.slam, "#0f8", "slam");
    }
    $("ad-ev").textContent = tl ? JSON.stringify({ hits: tl.hits, windupPeak: tl.windupPeak, end: tl.end }, null, 1) : "(no events)";
  };

  const pick = (name: string) => {
    clip = name;
    dur = body(game, who).listClips().find((c) => c.name === name)?.dur ?? 1;
    const s = $<HTMLInputElement>("ad-t");
    s.max = String(dur);
    t = 0;
    s.value = "0";
    for (const d of $("ad-clips").children) d.classList.toggle("on", (d as HTMLElement).dataset.clip === name);
    showEvents();
    render();
  };

  const list = () => {
    const f = body(game, who);
    $("ad-kind").textContent = f.kind;
    const box = $("ad-clips");
    box.innerHTML = "";
    for (const c of f.listClips()) {
      const d = document.createElement("div");
      d.dataset.clip = c.name;
      d.textContent = `${c.name.padEnd(14)} ${c.dur.toFixed(3)} s${c.loop ? "  loop" : ""}`;
      d.onclick = () => enter(c.name);
      box.appendChild(d);
    }
  };

  const enter = (name: string) => {
    if (!active) {
      active = true;
      game.pause();
      for (const m of markers) m.visible = true;
    }
    pick(name);
  };

  $<HTMLSelectElement>("ad-who").onchange = (e) => {
    who = (e.target as HTMLSelectElement).value as Who;
    list();
  };
  $<HTMLInputElement>("ad-t").oninput = (e) => {
    t = +(e.target as HTMLInputElement).value;
    if (active) render();
  };
  $("ad-play").onclick = () => {
    playing = !playing;
    last = performance.now();
    $("ad-play").textContent = playing ? "pause" : "play";
  };
  $("ad-sug").onclick = () => {
    if (!clip) return;
    const s = suggest(body(game, who), clip);
    $("ad-ev").textContent = "suggested (seconds; divide by dur for norm):\n" + JSON.stringify(s, null, 1);
    render();
  };
  $("ad-copy").onclick = () => void navigator.clipboard?.writeText($("ad-ev").textContent ?? "");
  $("ad-exit").onclick = () => {
    active = false;
    playing = false;
    for (const m of markers) m.visible = false;
    game.cam.override = null;
    game.toTitle();
    game.resume();
  };
  const tick = () => {
    requestAnimationFrame(tick);
    if (!active || !playing) return;
    const now = performance.now();
    t = (t + (now - last) / 1000) % Math.max(dur, 1e-3);
    last = now;
    $<HTMLInputElement>("ad-t").value = String(t);
    render();
  };
  tick();
  list();

  (window.__duel as Record<string, unknown>).anim = {
    list: (w: Who) => body(game, w).listClips(),
    kind: (w: Who) => body(game, w).kind,
    timeline: (w: Who, c: string) => body(game, w).timeline(c),
    suggest: (w: Who, c: string) => suggest(body(game, w), c),
    tuneSword: (w: Who, offset: [number, number, number], rot: [number, number, number]) =>
      ((body(game, w) as Fighter & { active?: Fighter }).active as Fighter & { tuneSword?: (o: typeof offset, r: typeof rot) => void }).tuneSword?.(offset, rot),
    view: (dist: number, side: number, up: number) => (viewK = [dist, side, up]),
    scrub: (w: Who, c: string, at: number) => {
      who = w;
      $<HTMLSelectElement>("ad-who").value = w;
      list();
      enter(c);
      t = at;
      $<HTMLInputElement>("ad-t").value = String(at);
      render();
      const f = body(game, w);
      return { hilt: f.rig.hiltW.toArray(), tip: f.rig.tipW.toArray() };
    },
  };
}
