// Combat glitch checks: one scripted repro per bug found in the sword-fight / deflect pass.
// Deterministic (loop paused, stepped through window.__duel.game), procedural bodies.
// Usage: node tools/combat.mjs   (PASS/FAIL per check; exit 1 on any failure)
import { launch } from "./gpu.mjs";

const { browser, page, errors } = await launch({ width: 960, height: 540 });

const results = await page.evaluate(() => {
  const g = window.__duel.game;
  const FD = 1 / 120;
  const out = [];
  const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail });
  g.pause();
  const inp = g.input;
  const p = g.player;
  const b = g.boss;
  const V = p.pos.constructor;

  const frame = () => {
    g.fixed(FD);
    g.fixed(FD);
    g.frame(1 / 60, false);
  };
  const tap = (a) => {
    inp.press(a);
    inp.release(a);
  };
  const fresh = (dist = 2.4) => {
    g.startFight();
    g.bot.play = false;
    g.bot.deflect = false;
    inp.botAxis = null;
    for (const a of ["attack", "block", "dodge", "jump", "lock"]) {
      inp.release(a);
      inp.consume(a, 99);
    }
    b.passive = true;
    b.enter("idle");
    b.attack = null;
    g.place(dist);
    for (let i = 0; i < 6; i++) frame();
    inp.resetMash();
  };
  const segPt = (a, c, q) => {
    const ab = c.clone().sub(a);
    const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
    return a.clone().addScaledVector(ab, t).distanceTo(q);
  };
  const segSeg = (a0, a1, b0, b1) => {
    let best = 99;
    for (let i = 0; i <= 40; i++) best = Math.min(best, segPt(b0, b1, a0.clone().lerp(a1, i / 40)));
    return best;
  };
  const capsule = (rig) => {
    const a = new V(), c = new V();
    const r = rig.capsule(a, c);
    return { a, c, r };
  };
  /** Boss blade vs player capsule surface (negative = inside). */
  const depth = () => {
    const c = capsule(p.ch.rig);
    return segSeg(b.ch.rig.hiltW, b.ch.rig.tipW, c.a, c.c) - c.r;
  };
  // Record every spark (fx call) and every sound.
  const sparks = [];
  const sounds = [];
  for (const k of ["deflect", "block", "wound", "armour"]) {
    const f = g.fx[k].bind(g.fx);
    g.fx[k] = (pt, dir, ...a) => {
      sparks.push({ kind: k, pt: pt.clone() });
      return f(pt, dir, ...a);
    };
  }
  for (const k of ["clang", "blockThud", "hurt", "whoosh", "hitFlesh"]) {
    const f = g.audio[k].bind(g.audio);
    g.audio[k] = (...a) => {
      sounds.push({ k, pState: p.state, pT: p.stateT, swing: p.swing ? { t0: p.swing.t0 } : null });
      return f(...a);
    };
  }
  /** Run an attack with guard presses `lead` s before each expected contact ("hold" = held). */
  const guardRun = (atk, dist, lead) => {
    fresh(dist);
    sparks.length = 0;
    sounds.length = 0;
    const s0 = { ...g.stats };
    if (lead === "hold") inp.press("block");
    g.forceBossAttack(atk);
    const hits = b.attack.hits;
    const done = hits.map(() => false);
    const meet = [];
    let worstAfter = 99;
    let since = -1;
    for (let i = 0; i < 400 && (b.state === "attack" || since >= 0); i++) {
      if (typeof lead === "number")
        hits.forEach((h, j) => {
          if (!done[j] && b.state === "attack" && b.stateT >= h.contact - lead) {
            done[j] = true;
            tap("block");
          }
        });
      const n = sparks.length;
      frame();
      if (sparks.length > n) {
        const s = sparks[sparks.length - 1];
        if (s.kind === "deflect" || s.kind === "block")
          meet.push({ p: segPt(p.ch.rig.hiltW, p.ch.rig.tipW, s.pt), b: segPt(b.ch.rig.hiltW, b.ch.rig.tipW, s.pt), inP: segPt(capsule(p.ch.rig).a, capsule(p.ch.rig).c, s.pt) });
        since = 0;
      }
      if (since >= 0) {
        worstAfter = Math.min(worstAfter, depth());
        if (++since > 15) since = -1;
      }
    }
    if (lead === "hold") inp.release("block");
    return { meet, worstAfter, d: g.stats.deflects - s0.deflects, bl: g.stats.blocks - s0.blocks, h: g.stats.hitsTaken - s0.hitsTaken, sounds: sounds.map((s) => s.k) };
  };

  // ------------------------------------------------------------ 1. sparks at the blade contact
  {
    const runs = [];
    for (const atk of ["combo", "comboDelay", "overhead", "leap"])
      for (const lead of [0.15, 0.08, "hold"]) runs.push([atk, lead, guardRun(atk, atk === "leap" ? 6 : 2.4, lead)]);
    const all = runs.flatMap((r) => r[2].meet);
    const worstP = Math.max(...all.map((m) => m.p));
    const worstB = Math.max(...all.map((m) => m.b));
    check("spark: every deflect/block spark sits on both blades", all.length >= 20 && worstP < 0.03 && worstB < 0.03, `${all.length} guards; spark to player blade max ${(worstP * 100).toFixed(1)} cm, to general's blade max ${(worstB * 100).toFixed(1)} cm (was 7-47 cm apart, spark floating between)`);
    const minIn = Math.min(...all.map((m) => m.inP));
    check("spark: never inside the defender's body", minIn > 0.18, `closest spark to the player's spine ${(minIn * 100).toFixed(0)} cm (capsule radius 30 cm)`);
    const worst = Math.min(...runs.map((r) => r[2].worstAfter));
    const perAtk = runs.map((r) => `${r[0]}/${r[1]}:${r[2].worstAfter.toFixed(2)}`).join(" ");
    check("clip: guarded blade rebounds instead of cutting through the body", worst > -0.12, `deepest general's blade into the player within 0.25 s of a guard ${(worst * 100).toFixed(0)} cm (was -19 to -30 cm) — ${perAtk}`);
    const combos = runs.filter((r) => r[0].startsWith("combo"));
    check("combo: all three blows land and are guarded once each", combos.every((r) => r[2].d + r[2].bl === 3 && r[2].h === 0), combos.map((r) => `${r[0]}/${r[1]}: defl ${r[2].d} blk ${r[2].bl} hit ${r[2].h}`).join(", "));
    const snd = combos.every((r) => r[2].sounds.filter((s) => s === "clang" || s === "blockThud").length === 3 && r[2].sounds.filter((s) => s === "whoosh").length === 3);
    check("audio: one whoosh per blow, one clang/thud per guard", snd, combos.map((r) => `${r[0]}/${r[1]}: ${r[2].sounds.join(",")}`).join(" | "));
  }

  // ------------------------------------------------------------ 2. late deflect keeps the blades together
  {
    const late = [];
    for (const atk of ["overhead", "leap", "combo"]) {
      fresh(atk === "leap" ? 6 : 2.4);
      sparks.length = 0;
      g.forceBossAttack(atk);
      const s0 = g.stats.lateDeflects;
      let pendingSeen = false;
      for (let i = 0; i < 300 && b.state === "attack"; i++) {
        g.fixed(FD);
        if (!pendingSeen && g.pending) {
          pendingSeen = true;
          // Wait 3 steps into the late window, then press.
          g.fixed(FD);
          g.fixed(FD);
          tap("block");
        }
        if (g.stats.lateDeflects > s0) {
          g.fixed(FD);
          const s = sparks[sparks.length - 1];
          late.push({ atk, b: segPt(b.ch.rig.hiltW, b.ch.rig.tipW, s.pt), p: segPt(p.ch.rig.hiltW, p.ch.rig.tipW, s.pt) });
          break;
        }
      }
    }
    check("late deflect: pose held at contact, blades still meet", late.length === 3 && late.every((l) => l.b < 0.03 && l.p < 0.03), late.map((l) => `${l.atk}: ${(l.b * 100).toFixed(1)}/${(l.p * 100).toFixed(1)} cm`).join(", ") + " (was up to 37 cm off: blade kept moving while pending)");
  }

  // ------------------------------------------------------------ 3. sweep has no gaps
  // Geometry-only sections: hits are suppressed via hitDone, so keep avoidance from steering.
  const setAvoid = b.ch.setAvoid;
  b.ch.setAvoid = () => {};
  g.bossBody.setAvoid(false);
  {
    // Replay recorded blade motion from every attack against a grid of capsules, compare with
    // a dense ground truth (blade interpolated in 1% steps).
    const steps = [];
    for (const atk of ["combo", "comboDelay", "overhead", "thrust", "leap"]) {
      fresh(atk === "leap" ? 6 : 2.4);
      g.forceBossAttack(atk);
      for (let i = 0; i < 400 && b.state === "attack"; i++) {
        b.hitDone = b.attack.hits.map(() => true);
        g.fixed(FD);
        const r = b.ch.rig;
        if (r.tipW.distanceTo(r.prevTipW) > 0.25) steps.push({ hiltW: r.hiltW.clone(), tipW: r.tipW.clone(), prevHiltW: r.prevHiltW.clone(), prevTipW: r.prevTipW.clone() });
      }
    }
    let truth = 0, oldMiss = 0, newMiss = 0, fracErr = 0;
    const ca = new V(), cb = new V(), h = new V(), t = new V(), t2 = new V();
    for (const s of steps) {
      const mid = s.hiltW.clone().lerp(s.tipW, 0.5).lerp(s.prevHiltW.clone().lerp(s.prevTipW, 0.5), 0.5);
      for (let gx = -1; gx <= 1; gx += 0.25)
        for (let gz = -1; gz <= 1; gz += 0.25) {
          ca.set(mid.x + gx, mid.y - 0.5, mid.z + gz);
          cb.set(mid.x + gx, mid.y + 0.5, mid.z + gz);
          let hit = false;
          for (let k = 0; k <= 100 && !hit; k++) {
            h.lerpVectors(s.prevHiltW, s.hiltW, k / 100);
            t.lerpVectors(s.prevTipW, s.tipW, k / 100);
            if (segSeg(h, t, ca, cb) < 0.3 - 0.01) hit = true;
          }
          if (!hit) continue;
          truth++;
          if (!g.legacySweep(s, ca, cb, 0.3)) oldMiss++;
          const res = g.sweepTest(s, ca, cb, 0.3);
          if (!res.hit) newMiss++;
          else {
            // The reported first-touch fraction must be the true first touch (within one sub-step).
            let first = 1;
            for (let k = 0; k <= 100; k++) {
              h.lerpVectors(s.prevHiltW, s.hiltW, k / 100);
              t2.lerpVectors(s.prevTipW, s.tipW, k / 100);
              if (segSeg(h, t2, ca, cb) < 0.3) {
                first = k / 100;
                break;
              }
            }
            fracErr = Math.max(fracErr, first - res.s);
          }
        }
    }
    check("sweep: sub-stepped sweep finds every touch and its first instant", truth > 500 && newMiss === 0 && (oldMiss === 0 || g.bossBody.kind === "skinned") && fracErr < 0.15, `${steps.length} fast steps, ${truth} true touches: missed ${newMiss} (old sweep ${oldMiss}); first-touch fraction late by at most ${fracErr.toFixed(2)} of a step`);
  }

  // ------------------------------------------------------------ 4. lunges: reach, no running into the player
  {
    const rows = [];
    let reachOk = true, gapOk = true;
    for (const dist of [1.6, 2.2, 2.8, 3.4]) {
      fresh(dist);
      g.forceBossAttack("combo");
      let w = 99, minD = 99;
      for (let i = 0; i < 400 && b.state === "attack"; i++) {
        b.hitDone = [true, true, true];
        g.fixed(FD);
        if (b.attack && b.stateT >= b.attack.hits[0].t0 && b.stateT <= b.attack.hits[0].t1) w = Math.min(w, depth());
        minD = Math.min(minD, Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z));
      }
      rows.push(`${dist} m: first cut ${(w * 100).toFixed(0)} cm, closest ${minD.toFixed(2)} m`);
      if (w >= 0) reachOk = false;
      if (minD < 1.3) gapOk = false;
    }
    check("lunge: the combo's opening cut connects from 1.6-3.4 m", reachOk, rows.join("; ") + " (was 3-60 cm short from 2.2 m)");
    check("lunge: stops short of the player (no body slam)", gapOk, "closest approach >= 1.3 m for stops of 1.45-1.7 m (was 1.05 m: the lunge coasted 0.3-0.6 m past its stop)");
  }

  b.ch.setAvoid = setAvoid;

  // ------------------------------------------------------------ 5. boss lands after a deflected leap
  {
    fresh(6);
    g.bot.deflect = true;
    g.forceBossAttack("leap");
    let deflAt = -1;
    const d0 = g.stats.deflects;
    for (let i = 0; i < 300; i++) {
      frame();
      if (deflAt < 0 && g.stats.deflects > d0) deflAt = i;
      if (deflAt >= 0 && i - deflAt > 30) break;
    }
    const y = b.pos.y;
    check("leap: a deflected leap drops the general to the roof", deflAt >= 0 && y === 0, `deflected=${deflAt >= 0}, height 0.5 s later ${y.toFixed(2)} m (was stuck at 0.62 m)`);
  }

  // ------------------------------------------------------------ 6. reaction clips don't fling the blade
  {
    fresh(2.4);
    g.bot.deflect = true;
    g.forceBossAttack("overhead");
    let recoil = 0;
    for (let i = 0; i < 400; i++) {
      const prev = b.ch.rig.tipW.clone().sub(b.ch.rig.root.position);
      g.fixed(FD);
      if (b.state === "recoil" && g.timeScale > 0.5) recoil = Math.max(recoil, b.ch.rig.tipW.clone().sub(b.ch.rig.root.position).distanceTo(prev));
    }
    fresh(2.4);
    g.forceBossAttack("overhead");
    let hit = 0;
    for (let i = 0; i < 400; i++) {
      const prev = p.ch.rig.tipW.clone().sub(p.ch.rig.root.position);
      g.fixed(FD);
      if (p.state === "hit" && g.timeScale > 0.5) hit = Math.max(hit, p.ch.rig.tipW.clone().sub(p.ch.rig.root.position).distanceTo(prev));
    }
    // Right after a deflect the general's blade rebounds and returns into the combo: no flips.
    fresh(2.4);
    g.bot.deflect = true;
    g.forceBossAttack("combo");
    let after = 0;
    const d0 = g.stats.deflects;
    let since = -1;
    for (let i = 0; i < 300 && b.state === "attack"; i++) {
      const prev = b.ch.rig.tipW.clone().sub(b.ch.rig.root.position);
      g.fixed(FD);
      if (g.stats.deflects > d0 && since < 0) since = 0;
      if (since >= 0 && since++ < 40 && g.timeScale > 0.5) after = Math.max(after, b.ch.rig.tipW.clone().sub(b.ch.rig.root.position).distanceTo(prev));
    }
    check("pose: recoil, hit reaction and post-deflect rebound have no one-step pops", recoil < 0.62 && hit < 0.45 && after < 0.62, `max tip travel per 1/120 s: recoil ${(recoil * 100).toFixed(0)} cm (was 77), hit ${(hit * 100).toFixed(0)} cm (was 75), rebound ${(after * 100).toFixed(0)} cm (flips of 80-120 cm while fixing); the general's own strikes run 50-68 cm`);
  }

  // ------------------------------------------------------------ 7. posture HUD never shows a full bar without a break
  {
    fresh(2.4);
    b.posture = 98.5;
    inp.press("block");
    g.forceBossAttack("overhead");
    for (let i = 0; i < 120 && b.state === "attack"; i++) frame();
    inp.release("block");
    const fill = document.querySelector("#bossbar .posture .fill").style.width;
    check("posture: a regular block that tops 100 breaks (HUD in sync)", b.state === "stagger" && b.posture === 100 && fill === "100%", `98.5 + block -> ${b.posture.toFixed(1)} (${b.state}), HUD fill ${fill} (was 101.5 with no break: full bar, no stagger)`);
    // HUD follows posture every frame through a deflected combo.
    fresh(2.4);
    g.bot.deflect = true;
    g.forceBossAttack("combo");
    let worst = 0;
    for (let i = 0; i < 160; i++) {
      frame();
      const w = parseFloat(document.querySelector("#bossbar .posture .fill").style.width);
      const want = b.state === "stagger" ? 100 : Math.min(100, b.posture);
      worst = Math.max(worst, Math.abs(w - want));
    }
    check("posture: HUD bar tracks the general's posture every frame", worst < 0.01, `worst bar error ${worst.toFixed(3)} %`);
  }

  // ------------------------------------------------------------ 8. hitstop: what freezes, and a clean resume
  {
    fresh(2.4);
    g.bot.deflect = true;
    g.forceBossAttack("overhead");
    let trailN = -1, trailBad = false, inStop = 0, resumed = false, heldAfter = -1;
    const trail = () => g.bossBody.trail.age.length;
    for (let i = 0; i < 300; i++) {
      g.fixed(FD);
      g.frame(1 / 240, false);
      if (g.hitstop > 0) {
        inStop++;
        if (trailN < 0) trailN = trail();
        else if (trail() !== trailN) trailBad = true;
      } else if (inStop && !resumed) {
        resumed = g.timeScale === 1;
        g.fixed(FD);
        heldAfter = g.held.size;
      }
    }
    check("hitstop: trail freezes with the blade, time and holds resume", inStop > 5 && !trailBad && resumed && heldAfter === 0, `${inStop} frozen steps, trail samples constant=${!trailBad} (was: kept sampling the frozen blade in real time and collapsed), resumed ts=1 ${resumed}, holds left ${heldAfter}`);
    // Animation stays in sync with the gameplay clock after holds + rebounds (anim-driven hitboxes).
    fresh(2.4);
    g.bot.deflect = true;
    g.forceBossAttack("combo");
    let drift = 0;
    for (let i = 0; i < 260 && b.state === "attack"; i++) {
      g.fixed(FD);
      const hs = b.attack ? b.attack.hits : [];
      if (hs.some((h, j) => !b.hitDone[j] && b.stateT >= h.t0 && b.stateT <= h.t1)) drift = Math.max(drift, Math.abs(g.bossBody.active.anim.time - b.stateT));
    }
    check("sync: after holds and rebounds the clip is back on the gameplay clock for every live blow", drift < 0.005, `worst clip-time error inside a live hit window ${(drift * 1000).toFixed(1)} ms`);
  }

  // ------------------------------------------------------------ 9. finisher start doesn't smear
  {
    const rows = [];
    for (const markers of [2, 1]) {
      fresh(2);
      b.markers = markers;
      b.stagger();
      tap("attack");
      g.fixed(FD);
      g.fixed(FD);
      const st = g.state;
      g.frame(0, false, 0.5);
      rows.push({ st, p: g.interp.p.length(), b: g.interp.b.length() });
    }
    const ok = rows[0].st === "deathblow" && rows[1].st === "finisher" && rows.every((r) => r.p < 0.01 && r.b < 0.01);
    check("finisher: teleport into position doesn't interpolate from the old spot (deathblow + finisher)", ok, rows.map((r) => `${r.st}: ${(r.p * 100).toFixed(1)} / ${(r.b * 100).toFixed(1)} cm`).join(", "));
  }

  // ------------------------------------------------------------ 10. player swing sound when the blade moves
  {
    fresh(3);
    b.state = "recoil";
    sounds.length = 0;
    tap("attack");
    for (let i = 0; i < 60; i++) {
      b.state = "recoil";
      b.stateT = 0.1;
      g.fixed(FD);
    }
    const w = sounds.find((s) => s.k === "whoosh");
    const off = w ? w.pT - w.swing.t0 : 99;
    check("audio: swing whoosh starts with the cut, not the wind-up", w && Math.abs(off) <= FD + 1e-6, w ? `whoosh at ${(w.pT * 1000).toFixed(0)} ms, cut starts ${(w.swing.t0 * 1000).toFixed(0)} ms (was at 0 ms, 100-210 ms early)` : "no whoosh");
  }

  // ------------------------------------------------------------ 11. unlocked guard faces the attacker
  {
    fresh(2.4);
    g.locked = false;
    g.cam.setMode("free");
    p.yaw = 0; // back to the general
    inp.press("block");
    g.forceBossAttack("overhead");
    let face = -1;
    const bl0 = g.stats.blocks;
    for (let i = 0; i < 200 && face < 0; i++) {
      frame();
      if (g.stats.blocks > bl0) face = Math.abs(Math.atan2(Math.sin(p.yaw - Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z)), Math.cos(p.yaw - Math.atan2(b.pos.x - p.pos.x, b.pos.z - p.pos.z))));
    }
    inp.release("block");
    check("guard: without lock-on the raised guard turns to the attacker", face >= 0 && face < 0.05, `yaw error at the block ${face.toFixed(3)} rad (was ${Math.PI.toFixed(2)}: blocked facing away)`);
  }

  // ------------------------------------------------------------ 12. camera lock toggle doesn't whip
  {
    let worst = 0;
    for (const [dist, side] of [[3, 0], [1.6, 1.5], [6, -3]]) {
      fresh(dist);
      p.pos.x += side;
      for (let i = 0; i < 60; i++) frame();
      tap("lock");
      for (let i = 0; i < 60; i++) frame();
      let prev = g.camera.getWorldDirection(new V());
      tap("lock");
      for (let i = 0; i < 60; i++) {
        frame();
        const d = g.camera.getWorldDirection(new V());
        worst = Math.max(worst, d.angleTo(prev));
        prev = d;
      }
    }
    check("camera: free→lock re-frame eases in", worst < 0.06, `max ${worst.toFixed(3)} rad per 60 Hz frame (was 0.104)`);
  }

  g.resume();
  return out;
});

let fails = 0;
for (const r of results) {
  if (!r.ok) fails++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
}
await browser.close();
if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  fails++;
}
console.log(fails ? `${fails} FAILED` : `ALL PASS (${results.length})`);
process.exit(fails ? 1 : 0);
