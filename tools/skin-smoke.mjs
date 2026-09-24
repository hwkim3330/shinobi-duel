// Skinned-body smoke test without real assets: builds a Mixamo-shaped skeleton in the page
// (mixamorig-prefixed bones, ×0.01 armature, Hips root motion, every required clip), exports it
// to GLB and loads it back through GLTFLoader, then checks the SkinnedCharacter layer and plays a
// stepped fight on two skinned bodies. Dev server only (uses window.__duel.dev).
// Usage: node tools/skin-smoke.mjs
import { launch } from "./gpu.mjs";

const { browser, page, errors } = await launch({ width: 960, height: 540 });

const results = await page.evaluate(async () => {
  const d = window.__duel;
  const g = d.game;
  const T = await d.dev.three();
  const { SkinnedCharacter } = await d.dev.skinned();
  const { SKINS } = await d.dev.config();
  const { GLTFExporter } = await d.dev.exporter();
  const { GLTFLoader } = await d.dev.gltf();
  const out = [];
  const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail });
  g.pause();

  /** A crude Mixamo-like character: `prefix` + bone names, centimetres under a 0.01 armature. */
  const makeAsset = async (height, prefix, clipNames) => {
    const H = height * 100;
    const arm = new T.Group();
    arm.name = "Armature";
    arm.scale.setScalar(0.01);
    const bones = [];
    const mk = (n, x, y, z, parent) => {
      const b = new T.Bone();
      b.name = prefix + n;
      b.position.set(x, y, z);
      (parent ?? arm).add(b);
      bones.push(b);
      return b;
    };
    const hips = mk("Hips", 0, H * 0.53, 0);
    const s2 = mk("Spine2", 0, H * 0.06, 0, mk("Spine1", 0, H * 0.06, 0, mk("Spine", 0, H * 0.06, 0, hips)));
    mk("Head", 0, H * 0.05, 0, mk("Neck", 0, H * 0.1, 0, s2));
    for (const [s, sd] of [["Right", -1], ["Left", 1]]) {
      const sh = mk(s + "Shoulder", sd * H * 0.05, H * 0.08, 0, s2);
      mk(s + "Hand", sd * H * 0.15, 0, 0, mk(s + "ForeArm", sd * H * 0.16, 0, 0, mk(s + "Arm", sd * H * 0.07, 0, 0, sh)));
      mk(s + "Foot", 0, -H * 0.24, 0, mk(s + "Leg", 0, -H * 0.24, 0, mk(s + "UpLeg", sd * H * 0.05, -H * 0.03, 0, hips)));
    }
    const geo = new T.BoxGeometry(H * 0.3, H, H * 0.2).translate(0, H / 2, 0);
    const n = geo.attributes.position.count;
    geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) w[i * 4] = 1;
    geo.setAttribute("skinWeight", new T.Float32BufferAttribute(w, 4));
    const mesh = new T.SkinnedMesh(geo, new T.MeshStandardMaterial({ color: 0x777777 }));
    mesh.name = "Body";
    arm.add(mesh);
    arm.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(bones));
    const scene = new T.Scene();
    scene.add(arm);
    const clips = clipNames.map((name) => {
      const dur = name.startsWith("attack") || name.startsWith("combo") ? 0.9 : 1.2;
      const hy = H * 0.53;
      const q = (a) => new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), a).toArray();
      return new T.AnimationClip("Armature|" + name, dur, [
        // Root motion (to be stripped): 40 cm forward drift + 30 cm sideways.
        new T.VectorKeyframeTrack(prefix + "Hips.position", [0, dur], [0, hy, 0, 30, hy - 4, 40]),
        new T.QuaternionKeyframeTrack(prefix + "RightArm.quaternion", [0, dur * 0.4, dur * 0.6, dur], [...q(0), ...q(1.4), ...q(-0.6), ...q(0)]),
      ]);
    });
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips });
    return new GLTFLoader().parseAsync(glb, "");
  };

  const P = SKINS.player;
  const B = SKINS.boss;
  const extra = ["walk", "walk_back", "strafe_left", "strafe_right", "run", "stagger", "jump"];
  const pAsset = await makeAsset(1.8, "mixamorig", [...new Set([...P.required, ...extra])]);
  // Boss uses the other Mixamo naming variant (mixamorig1_) to exercise normalization.
  const bAsset = await makeAsset(1.9, "mixamorig1_", [...new Set([...B.required, ...extra, "death"])]);
  const pBody = SkinnedCharacter.fromParts(P, pAsset.scene, pAsset.animations, g.shinobi);
  const bBody = SkinnedCharacter.fromParts(B, bAsset.scene, bAsset.animations, g.general);
  check("load: GLB round-trip builds both bodies", !!pBody && !!bBody, `player clips ${pBody?.clips.size}, boss clips ${bBody?.clips.size}`);
  if (!pBody || !bBody) return out;

  // Rejection path: a body missing required clips falls back (warning, not error).
  const partial = await makeAsset(1.8, "mixamorig", ["idle", "attack1"]);
  check("load: missing required clips keeps the procedural body", SkinnedCharacter.fromParts(P, partial.scene, partial.animations, g.shinobi) === null, "fromParts returned null");

  const bone = (b, n) => b.bone(n);
  check("bones: mixamorig / mixamorig1_ prefixes normalized", ["Hips", "Spine2", "Head", "RightHand", "LeftLeg"].every((n) => bone(pBody, n) && bone(bBody, n)), [...pBody.clips.get("attack1").tracks.map((t) => t.name)].join(", "));

  // Height normalization.
  const box = new T.Box3().setFromObject(pBody.rig.root);
  check("scale: model scaled to the configured height", Math.abs(box.max.y - box.min.y - P.height) < 0.05, `bind height ${(box.max.y - box.min.y).toFixed(3)} m (config ${P.height})`);

  // Root motion stripped while the arm (and sword) animate.
  const W = new T.Vector3();
  const V = new T.Vector3();
  pBody.rig.root.position.set(0, 0, 0);
  pBody.rig.yaw = 0;
  pBody.play("attack1", 0);
  let drift = 0, swordLen = 0, handGap = [99, 0], tipMove = 0;
  const tip0 = new T.Vector3();
  for (let i = 0; i < 100; i++) {
    pBody.step(1 / 120, V, 0);
    bone(pBody, "Hips").getWorldPosition(W);
    drift = Math.max(drift, Math.hypot(W.x, W.z));
    swordLen = pBody.rig.tipW.distanceTo(pBody.rig.hiltW);
    const hg = bone(pBody, "RightHand").getWorldPosition(new T.Vector3()).distanceTo(pBody.rig.hiltW);
    handGap = [Math.min(handGap[0], hg), Math.max(handGap[1], hg)];
    if (i === 0) tip0.copy(pBody.rig.tipW);
    tipMove = Math.max(tipMove, pBody.rig.tipW.distanceTo(tip0));
  }
  check("root motion: Hips x/z pinned (gameplay moves the fighter)", drift < 0.01, `hips drift ${(drift * 100).toFixed(2)} cm (clip drifts 50 cm)`);
  check("sword: katana in the right-hand socket, hitbox = blade", Math.abs(swordLen - P.sword.blade) < 0.005 && handGap[1] - handGap[0] < 1e-3 && tipMove > 0.3, `hilt→tip ${swordLen.toFixed(3)} m, hand→hilt ${handGap[0].toFixed(3)}-${handGap[1].toFixed(3)} m (constant), tip moved ${tipMove.toFixed(2)} m with the arm`);

  // Events → timelines.
  const a1 = pBody.timeline("attack1");
  const c = bBody.timeline("combo");
  const cd = bBody.timeline("comboDelay");
  // Gameplay timings are the procedural rig's (the tuned combat); the clips are time-warped onto them.
  const inc = (h) => h.every((x, i) => i === 0 || x.start > h[i - 1].end);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  check("events: skinned timelines are the tuned procedural ones", same(a1, g.shinobi.timeline("attack1")) && same(c, g.general.timeline("combo")) && same(cd, g.general.timeline("comboDelay")) && c.hits.length === 3 && inc(c.hits), `attack1 hit ${a1.hits[0].start.toFixed(3)}-${a1.hits[0].end.toFixed(3)} s, chain ${a1.chain.toFixed(3)}; combo hits ${c.hits.map((h) => h.start.toFixed(2)).join("/")}, comboDelay third ${cd.hits[2].start.toFixed(2)}`);
  // The clip's own contact frame (blade analysis / table) lands on the gameplay contact.
  const wp = pBody.warpFor("attack1");
  const vAt = (w, t) => {
    for (let i = 1; i < w.g.length; i++) if (t <= w.g[i]) return w.v[i - 1] + ((w.v[i] - w.v[i - 1]) * (t - w.g[i - 1])) / (w.g[i] - w.g[i - 1]);
    return w.v[w.v.length - 1];
  };
  const clipC = (() => {
    const ev = pBody.eventsOf("attack1");
    const d = pBody.clips.get("attack1").duration;
    const h = ev.hits[0];
    return (ev.norm ? d : 1) * (h.contact ?? (h.start + h.end) / 2);
  })();
  check("warp: the clip's contact frame plays at the gameplay contact", wp && Math.abs(vAt(wp, a1.hits[0].contact) - clipC) < 1e-3, `gameplay contact ${a1.hits[0].contact.toFixed(3)} s -> clip ${wp ? vAt(wp, a1.hits[0].contact).toFixed(3) : "-"} s (clip contact ${clipC.toFixed(3)} s)`);

  // Mixer state machine: crossfade weights, fading action retired, hitstop scaling, hold.
  const live = (body) => body.mixer._actions.filter((a) => body.mixer._isActiveAction(a) && a.getEffectiveWeight() > 1e-4);
  pBody.play("idle", 0);
  pBody.step(1 / 120, V, 0);
  pBody.play("attack1", 0.08);
  for (let i = 0; i < 5; i++) pBody.step(1 / 120, V, 0);
  const acts = live(pBody);
  const wsum = acts.reduce((s, a) => s + a.getEffectiveWeight(), 0);
  for (let i = 0; i < 30; i++) pBody.step(1 / 120, V, 0);
  const running = live(pBody).map((a) => a.getClip().name);
  check("mixer: crossfade blends (weights sum to 1) then retires the old action", acts.length === 2 && Math.abs(wsum - 1) < 0.02 && running.length === 1 && running[0] === "attack1", `mid-fade ${acts.length} actions, weight sum ${wsum.toFixed(3)}; after: ${running.join(",")}`);
  pBody.play("hit", 0);
  const hitAct = pBody.mixer._actions.find((a) => pBody.mixer._isActiveAction(a) && a.getClip().name === "hit");
  const hitEnd = pBody.timeline("hit").end;
  check("mixer: reaction clips fitted to the gameplay state's length", !!hitAct && Math.abs(hitEnd - g.shinobi.timeline("hit").end) < 1e-9 && hitAct.loop === T.LoopOnce && hitAct.clampWhenFinished, `hit state ${hitEnd.toFixed(3)} s (procedural ${g.shinobi.timeline("hit").end.toFixed(3)}), LoopOnce + clamp`);
  pBody.play("attack1", 0);
  const at = () => pBody.anim.time;
  const t0 = at();
  pBody.step((1 / 120) * 0.02, V, 0);
  const dHit = at() - t0;
  pBody.setHold(true);
  for (let i = 0; i < 10; i++) pBody.step(1 / 120, V, 0);
  const dHold = at() - t0 - dHit;
  pBody.setHold(false);
  for (let i = 0; i < 12; i++) pBody.step(1 / 120, V, 0);
  const lag = t0 + dHit + 22 / 120 - at();
  check("mixer: hitstop-scaled time, hold, catch-up to the gameplay clock", Math.abs(dHit - (1 / 120) * 0.02) < 1e-7 && dHold === 0 && Math.abs(lag) < 1e-6, `hitstop step advanced ${(dHit * 1000).toFixed(3)} ms, held ${(dHold * 1000).toFixed(1)} ms, lag after catch-up ${(lag * 1000).toFixed(2)} ms`);
  bBody.play("combo", 0);
  let seg = "";
  for (let i = 0; i < 240 && !seg; i++) {
    bBody.step(1 / 120, V, 0);
    const r = live(bBody).filter((a) => a.getEffectiveWeight() > 0.5).map((a) => a.getClip().name);
    if (r.includes("combo2")) seg = `combo2 at ${(i / 120).toFixed(3)} s`;
  }
  check("mixer: attack plans chain their segments", seg !== "", seg || "never reached combo2");

  // Swap both into the game and play a stepped fight.
  g.useBody("player", pBody);
  g.useBody("boss", bBody);
  g.toTitle();
  const kinds = [g.playerBody.kind, g.bossBody.kind].join("/");
  g.startFight();
  g.bot.deflect = true;
  g.bot.play = true;
  let nan = 0;
  const serial0 = g.boss.serial;
  const windows = [];
  let clothOk = true;
  for (let i = 0; i < 60 * 8; i++) {
    g.step(1 / 60);
    const p = g.player.pos, b = g.boss.pos, h = g.bossBody.rig.tipW;
    if (!Number.isFinite(p.x + p.z + b.x + b.z + h.x + h.y + h.z)) nan++;
    if (g.boss.attack && !windows.includes(g.boss.attack.name)) {
      const tl = bBody.timeline(g.boss.attack.name);
      windows.push(g.boss.attack.name);
      if (Math.abs(g.boss.attack.hits[0].t0 - tl.hits[0].start) > 1e-9) windows.push("MISMATCH");
    }
    if (g.state !== "fight") break;
  }
  for (const cl of bBody.cloths) if (![...cl.cloth.mesh.geometry.attributes.position.array].every(Number.isFinite)) clothOk = false;
  check("game: fight runs on two skinned bodies (timings from their events)", kinds === "skinned/skinned" && nan === 0 && g.boss.serial > serial0 && !windows.includes("MISMATCH") && clothOk && bBody.cloths.length === 1 && pBody.cloths.length === 2, `bodies ${kinds}, attacks ${g.boss.serial - serial0} (${windows.join(",")}), NaN ${nan}, cape+scarf cloth finite ${clothOk}, state ${g.state}, deflects ${g.stats.deflects}, hits ${g.stats.hitsTaken}`);

  // And back to the procedural rig.
  g.useBody("player", g.shinobi);
  g.useBody("boss", g.general);
  g.toTitle();
  check("fallback: swapping back to the procedural rig", g.playerBody.kind === "procedural" && g.bossBody.kind === "procedural" && g.shinobi.rig.root.visible && !pBody.rig.root.visible, `bodies ${g.playerBody.kind}/${g.bossBody.kind}`);
  g.resume();
  return out;
});

let fails = 0;
for (const r of results) {
  if (!r.ok) fails++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
}
await browser.close();
const real = errors.filter((e) => !/\[chars\].*missing clips/.test(e));
if (real.length) {
  console.log("ERRORS:\n" + real.join("\n"));
  fails++;
}
console.log(fails ? `${fails} FAILED` : `ALL PASS (${results.length})`);
process.exit(fails ? 1 : 0);
