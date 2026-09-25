import * as THREE from "three";
import { loadBodies } from "./chars/loadBodies";
import { activeDifficulty, DIFFICULTY, DIFFICULTY_PRESETS, type DifficultyName } from "./game/difficulty";
import { Input } from "./core/Input";
import { deflectPosture, Game, KICK_HEAD_POSTURE, MIKIRI_POSTURE } from "./game/Game";
import { GOURD, REZ } from "./game/Player";
import { Lockstep, type Role } from "./net/Lockstep";
import { type CtlMsg, signalURL, Transport } from "./net/Transport";
import { Menu, type TitleMode } from "./ui/Menu";

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const game = new Game(canvas, hud);
const urlq = new URLSearchParams(location.search);
const onlineRoom = urlq.get("room");
const onlineQuick = urlq.has("quick");
const online = !!onlineRoom || onlineQuick;
// An online page never runs the title's simulation: both browsers start the duel from the
// state the page was built in (bodies loaded, nothing stepped).
if (online) game.netLobby = true;
game.start();
const bodies = loadBodies({ player: game.shinobi, boss: game.general }, (who, body) => game.useBody(who, body));
if (urlq.get("debug") === "anim") void import("./debug/AnimDebug").then((m) => m.mountAnimDebug(game));

type SceneName = "title" | "fight" | "thrust" | "overhead" | "deflect" | "break" | "finisher" | "finisher2" | "victory" | "portrait" | "portrait2" | "closeP" | "closeB" | "closeP2";

function until(pred: () => boolean, max = 6, dt = 1 / 60): boolean {
  for (let t = 0; t < max; t += dt) {
    if (pred()) return true;
    game.step(dt);
  }
  return pred();
}

/** Deterministic set pieces for screenshots and checks (pauses the real-time loop). */
function scene(name: SceneName): Record<string, unknown> {
  game.pause();
  const b = game.boss;
  const s = game.stats;
  const close = (d: number) => {
    game.startFight();
    game.place(d);
    b.cooldown = 99;
    game.step(0.5);
  };
  game.cam.override = null;
  switch (name) {
    case "portrait":
    case "portrait2": {
      close(3);
      game.step(0.6);
      const back = name === "portrait2";
      game.cam.override = {
        pos: new THREE.Vector3(back ? -2.2 : 3.2, 1.5, back ? -5.5 : 1.2),
        look: new THREE.Vector3(0, 1.2, back ? 0 : -0.5),
      };
      game.step(0.1);
      break;
    }
    case "closeP":
    case "closeP2":
    case "closeB": {
      close(3);
      game.step(0.6);
      const P = game.player.pos;
      const B = game.boss.pos;
      game.cam.override =
        name === "closeB"
          ? { pos: new THREE.Vector3(B.x + 1.6, 1.7, B.z + 2.3), look: new THREE.Vector3(B.x, 1.45, B.z) }
          : name === "closeP"
            ? { pos: new THREE.Vector3(P.x - 1.3, 1.35, P.z - 1.4), look: new THREE.Vector3(P.x, 1.05, P.z) }
            : { pos: new THREE.Vector3(P.x + 1.2, 1.4, P.z + 1.6), look: new THREE.Vector3(P.x, 1.05, P.z) };
      game.step(0.1);
      break;
    }
    case "finisher2":
      scene("break");
      game.bot.deflect = false;
      game.startFinisher();
      until(() => game.player.stateT >= 0.75, 4, 1 / 120);
      break;
    case "title":
      game.toTitle();
      game.step(2.5);
      break;
    case "fight":
      game.startFight();
      game.step(1.95);
      break;
    case "thrust":
      close(3.4);
      game.forceBossAttack("thrust");
      game.step(0.5);
      break;
    case "overhead":
      close(3);
      game.forceBossAttack("overhead");
      game.step(0.95);
      break;
    case "deflect": {
      close(2.6);
      game.bot.deflect = true;
      const n = s.deflects;
      game.forceBossAttack("combo");
      until(() => s.deflects > n, 3, 1 / 120);
      game.step(3 / 60);
      break;
    }
    case "break":
    case "finisher":
    case "victory": {
      close(2.6);
      game.bot.deflect = true;
      b.posture = 96;
      const n = s.breaks;
      game.forceBossAttack("overhead");
      until(() => s.breaks > n, 4, 1 / 120);
      game.step(0.45);
      if (name === "break") break;
      game.bot.deflect = false;
      game.startFinisher();
      until(() => game.player.stateT >= 0.5, 3, 1 / 120);
      if (name === "finisher") break;
      until(() => game.state === "victory", 8);
      game.step(0.3);
      break;
    }
  }
  return stats();
}

function stats(): Record<string, unknown> {
  return {
    renderer: game.rendererName,
    fps: +game.fps.toFixed(1),
    state: game.state,
    player: { health: game.player.health, posture: +game.player.posture.toFixed(1), state: game.player.state },
    boss: { health: +game.boss.health.toFixed(1), posture: +game.boss.posture.toFixed(1), state: game.boss.state, attack: game.boss.attack?.name ?? null },
    ...game.stats,
    drawCalls: game.renderer.info.render.calls,
    triangles: game.renderer.info.render.triangles,
  };
}

declare global {
  interface Window {
    __duel: Record<string, unknown>;
  }
}

window.__duel = {
  ready: false,
  game,
  stats,
  rules: {
    DIFFICULTY,
    DIFFICULTY_PRESETS,
    get DEFLECT_POSTURE() {
      return DIFFICULTY.deflectPosture;
    },
    deflectPosture,
    MIKIRI_POSTURE,
    KICK_HEAD_POSTURE,
    GOURD,
    REZ,
    DEFLECT_STEPS: Input.DEFLECT_STEPS,
    MASH_RESET: Input.MASH_RESET,
  },
  /** Difficulty for the next fight ('easy' | 'medium' | 'hard'); `difficulty()` → [chosen, running]. */
  setDifficulty: (d: DifficultyName) => game.setDifficulty(d),
  difficulty: () => [game.difficulty, activeDifficulty()],
  scene,
  step: (s: number) => game.step(s),
  pause: () => game.pause(),
  resume: () => game.resume(),
  startFight: () => game.startFight(),
  toTitle: () => game.toTitle(),
  forceBossAttack: (n: string) => game.forceBossAttack(n),
  autoDeflect: (on: boolean) => {
    game.bot.deflect = on;
  },
  autoPlay: (on: boolean) => {
    game.bot.deflect = on;
    game.bot.play = on;
  },
};

// The rooftop (arena.glb + sky HDRI) streams in behind the title; `ready` waits for it and for its
// shaders, so the first fight never compiles programs.
const loading = document.createElement("div");
loading.textContent = "the castle rises from the mist…";
loading.style.cssText =
  "position:fixed;left:0;right:0;bottom:5%;text-align:center;font:italic 15px Georgia,serif;letter-spacing:.12em;color:rgba(236,226,214,.72);pointer-events:none;transition:opacity .6s";
document.body.append(loading);
/**
 * The arena adds materials and lantern lights (which changes every program's light hash), so compile
 * the whole scene again, hidden combat fx included, the way the composer draws it: into a linear
 * render target. Programs are created synchronously inside compileAsync, so the fx are only
 * un-hidden for that call and never reach the screen.
 */
function warmArena(): Promise<void> {
  const r = game.renderer;
  const hidden: THREE.Object3D[] = [];
  game.scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const prev = r.getRenderTarget();
  r.setRenderTarget(rt);
  const done = r.compileAsync(game.scene, game.camera);
  r.setRenderTarget(prev);
  for (const o of hidden) o.visible = false;
  return done.then(() => rt.dispose());
}
// The skinned bodies (and their rim-lit materials) are compiled in the same pass.
game.arena
  .load(game.renderer)
  .then(() => bodies.catch(() => undefined))
  // Lighting agent: rim-tag the fighters' armour before the warm-up so it compiles with everything else.
  .then(() => game.arena.tagCharacterRim())
  .then(warmArena)
  .catch((e: unknown) => console.error("[arena] failed to load", e))
  .finally(() => {
    loading.style.opacity = "0";
    setTimeout(() => loading.remove(), 700);
    window.__duel.ready = true;
  });

// Dev-only hooks for tools/skin-smoke.mjs (stripped from production builds).
if (import.meta.env.DEV) {
  window.__duel.dev = {
    three: () => Promise.resolve(THREE),
    skinned: () => import("./chars/SkinnedCharacter"),
    config: () => import("./chars/skinnedConfig"),
    gltf: () => import("three/addons/loaders/GLTFLoader.js"),
    exporter: () => import("three/addons/exporters/GLTFExporter.js"),
  };
}

// ------------------------------------------------------------------ modes and netplay

const menu = new Menu();
const TITLE_MODE_KEY = "shinobi-duel.mode";
function loadTitleMode(): TitleMode {
  const q = urlq.get("mode");
  if (q === "general" || q === "solo") return q;
  try {
    const v = localStorage.getItem(TITLE_MODE_KEY);
    if (v === "general" || v === "solo") return v;
  } catch {
    /* storage blocked */
  }
  return "solo";
}
function pickTitleMode(m: TitleMode): void {
  if (game.state !== "title" || online) return;
  game.setMode(m);
  game.hud.showControls(m === "general" ? "general" : "shinobi");
  menu.setMode(m);
  try {
    localStorage.setItem(TITLE_MODE_KEY, m);
  } catch {
    /* storage blocked */
  }
}
menu.onMode = pickTitleMode;
menu.onOnline = (room, as) => {
  const u = new URL(location.href);
  u.search = "";
  if (room) u.searchParams.set("room", room);
  else u.searchParams.set("quick", "1");
  u.searchParams.set("as", as);
  u.searchParams.set("host", room ? "1" : "0");
  location.href = u.toString();
};
const leave = () => {
  transport?.close();
  const u = new URL(location.href);
  u.search = "";
  location.href = u.toString();
};
menu.onLeave = leave;
game.onNet = (e) => {
  if (e === "leave") leave();
};
if (!online) pickTitleMode(loadTitleMode());

let transport: Transport | null = null;
let lockstep: Lockstep | null = null;

if (online) {
  game.hud.showTitle(false);
  menu.showModes(false);
  const pref: Role = urlq.get("as") === "general" ? "general" : "shinobi";
  menu.showLobby(onlineRoom, urlq.get("host") === "1", "reaching the lobby…");
  let peerHello: { v: string; bodies: string; ready: boolean; as: Role } | null = null;
  let started = false;
  let measuring = false;
  const pongs: number[] = [];
  const bodyKinds = () => `${game.playerBody.kind}/${game.bossBody.kind}`;
  const hello = () => transport?.sendCtl({ t: "hello", v: BUILD, bodies: bodyKinds(), ready: !!window.__duel.ready, as: pref });
  const begin = (role: Role, delay: number, d: DifficultyName) => {
    if (started) return;
    started = true;
    lockstep = new Lockstep(transport!, role, delay);
    game.attachNet(lockstep);
    game.hud.showControls(role);
    menu.hideLobby();
    game.netStart(d);
  };
  const maybeStart = () => {
    if (!transport?.host || started || measuring || !peerHello || !window.__duel.ready || !peerHello.ready) return;
    if (peerHello.v !== BUILD) return menu.showError("You and your opponent are on different versions of the game. Both reload the page and try again.");
    if (peerHello.bodies !== bodyKinds()) return menu.showError(`The fighters loaded differently on the two machines (${bodyKinds()} here, ${peerHello.bodies} there). Both reload and try again.`);
    measuring = true;
    menu.lobbyStatus(transport.path === "p2p" ? "linked directly · measuring…" : "finding a direct link…");
    // Give the direct link a few seconds to come up, then time the round trip on the best path.
    const t0 = performance.now();
    const probe = () => {
      if (transport!.path !== "p2p" && performance.now() - t0 < 5000) return void setTimeout(probe, 200);
      let n = 0;
      const tick = () => {
        transport!.sendCtl({ t: "ping", at: performance.now() });
        if (++n < 8) setTimeout(tick, 120);
        else
          setTimeout(() => {
            const rtt = pongs.length ? pongs.sort((a, b) => a - b)[Math.floor(pongs.length / 2)] : 250;
            // Input delay covers half the round trip (plus a little jitter room), at 120 Hz.
            const delay = Math.max(3, Math.min(40, Math.ceil(rtt / 2 / (1000 / 120)) + 2));
            const hostRole = pref;
            transport!.sendCtl({ t: "start", delay, hostRole, d: "medium" });
            begin(hostRole, delay, "medium");
          }, 400);
      };
      tick();
    };
    probe();
  };
  const onCtl = (m: CtlMsg) => {
    if (lockstep?.ctl(m)) return;
    if (m.t === "hello") {
      peerHello = m as unknown as typeof peerHello;
      menu.lobbyStatus(peerHello!.ready ? "opponent here · getting ready…" : "opponent here · their castle is still loading…");
      maybeStart();
    } else if (m.t === "ping") transport?.sendCtl({ t: "pong", at: m.at });
    else if (m.t === "pong") pongs.push(performance.now() - (m.at as number));
    else if (m.t === "start") {
      const hostRole = m.hostRole as Role;
      begin(hostRole === "shinobi" ? "general" : "shinobi", m.delay as number, (m.d as DifficultyName) ?? "medium");
    }
  };
  transport = new Transport(signalURL(), {
    onJoined: (room, host) => {
      menu.showLobby(onlineRoom ? room : null, host, host ? "waiting for your opponent…" : "joining…");
    },
    onPeer: () => {
      menu.lobbyStatus("opponent found · linking…");
      hello();
    },
    onCtl,
    onInp: (b) => lockstep?.onPacket(b),
    onPath: (p) => {
      if (!started) menu.lobbyStatus(p === "p2p" ? "linked directly" : "linked through the relay");
      maybeStart();
    },
    onClosed: (why) => menu.showError(started ? `The duel was cut: ${why}.` : `Couldn't start the duel: ${why}.`),
  });
  transport.open(onlineRoom ? onlineRoom.toUpperCase() : null, BUILD);
  // Tell the other side once the castle has loaded here.
  const readyWait = setInterval(() => {
    if (!window.__duel.ready) return;
    clearInterval(readyWait);
    hello();
    maybeStart();
  }, 250);
}

// Per frame: which panels show, the connection line, the general's move panel.
function menuFrame(): void {
  const st = game.state;
  const fighting = st === "fight" || st === "deathblow" || st === "finisher" || st === "dying";
  if (!online) menu.showModes(st === "title");
  const b = game.boss;
  const p = game.player;
  menu.pilot(game.localRole === "general" && (st === "fight" || st === "deathblow"), {
    perilCD: b.perilCD,
    leapCD: b.leapCD,
    phase: b.phase,
    dist: Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z),
  });
  if (lockstep && transport) {
    const ms = Math.round(lockstep.rtt);
    const path = transport.path === "p2p" ? "P2P" : "RELAY";
    const sync = lockstep.desyncs ? `  ·  resync ${lockstep.resyncs}` : "";
    menu.netLine(`${path}  ·  ${ms} ms  ·  delay ${lockstep.delay}${sync}`);
    menu.waiting(fighting && lockstep.stalledFor > 0.4);
  }
  requestAnimationFrame(menuFrame);
}
requestAnimationFrame(menuFrame);
