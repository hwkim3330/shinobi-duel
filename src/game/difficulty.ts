/**
 * Every difficulty knob in one place (the "easier general" pass). Deflects stay the core: they
 * are what builds his posture fastest and what opens him up; mashing still loses because his
 * guard turns strings aside, a broken posture is punished, and the mash penalty still narrows the
 * window (it just never gets as tight as before).
 *
 * Values in brackets are the previous (harder) tuning.
 */
export const DIFFICULTY = {
  // ------------------------------------------------------------------ player survivability
  /** × every blow's vitality damage to the player, the throw included [1]. */
  playerDamage: 0.7,
  /** Share of a blow's posture a regular (held) block costs the player [0.9]. */
  blockPosture: 0.6,
  /** Player posture regen per second after the delay [13]. */
  playerPostureRegen: 18,

  // ------------------------------------------------------------------ deflect generosity
  /** Perfect-deflect window before the blow [0.2] and the late grace after it [0.05] (s). */
  deflectEarly: 0.25,
  deflectLate: 0.06,
  /** Deflect window per step of the anti-mash rule [0.2, 0.2, 0.167, 0.133, 0.1]. */
  deflectSteps: [0.25, 0.25, 0.22, 0.19, 0.16],

  // ------------------------------------------------------------------ progress on his posture
  /** Base posture a deflect deals (+12 % per chained deflect, ×1.15 heavy) [5]. */
  deflectPosture: 12,
  /** Share of a cut's posture that lands in an opening [0.5] / through his armoured swing [0.25]. */
  cutPostureOpen: 0.6,
  cutPostureArmoured: 0.3,
  /** His posture regen per second at full vitality [13]. */
  bossRegen: 9,

  // ------------------------------------------------------------------ openings
  /** After an attack (string, perilous move) he stands open this long, phase 1 / phase 2 [0, 0]. */
  recoverAfterAttack: [0.85, 0.65] as [number, number],
  /** Chance a cut into his idle guard lands anyway: first cut of a string / second [0, 0]. */
  guardSlip: [0.35, 0.2] as [number, number],
  /** Chance he turns the n-th cut of a string aside (deflects it) [0, 0, 0.3, 0.65, 1]. */
  bossDeflect: [0, 0, 0.15, 0.4, 0.7],
  /** His answer to a deflected cut comes after this beat [0], and is the flurry this often [1]. */
  counterDelay: 0.45,
  counterFlurry: 0.5,
  /** Cuts he takes in one opening before breaking out of it [2]. */
  openHits: 3,
  /** Deflected: recoil length (s) before he is back on guard [0.9]. */
  recoilT: 0.95,

  // ------------------------------------------------------------------ pressure
  /** Idle gap after an attack: base + random, phase 1 / phase 2 [0.35 + 0.6, 0.15 + 0.35]. */
  gap: { p1: [0.6, 0.8], p2: [0.35, 0.55] } as { p1: [number, number]; p2: [number, number] },
  /**
   * Attack tempo (wind-ups, swings), phase 1 / phase 2 [1, 1.12]. Phase 1 stays at 1: the combo's
   * eased lunges are tuned to stop 1.45 m short at that tempo (slower, they coast into the player).
   */
  tempo: [1, 1.02] as [number, number],
  /** Pick weights at mid range (normalized), phase 1 / phase 2. */
  picks: {
    p1: { combo: 0.3, comboDelay: 0.1, overhead: 0.22, thrust: 0.16, sweep: 0.1, grab: 0.06, idle: 0.06 },
    p2: { flurry: 0.1, combo: 0.22, comboDelay: 0.08, overhead: 0.16, thrust: 0.16, sweep: 0.14, grab: 0.1, idle: 0.04 },
  } as Record<"p1" | "p2", Record<string, number>>,
  /** Gourd punish: reaction beat from range [0.22] (s); point blank he starts the combo from its top [0.18 in]. */
  healReact: 0.4,
  healCloseStart: 0,

  // ------------------------------------------------------------------ gourd
  /** Healing gourd charges per fight [3]. */
  gourdCharges: 3,
};

// ==================================================================== presets
// The title's choice. Every preset has the same knobs (same keys, same array lengths); starting a
// fight copies the chosen one into DIFFICULTY in place, so nothing else in the game changes.

export type DifficultyName = "easy" | "medium" | "hard";
export type DifficultyValues = typeof DIFFICULTY;
export const DIFFICULTY_NAMES: readonly DifficultyName[] = ["easy", "medium", "hard"];

/** Medium: the tuning above, unchanged. */
const MEDIUM: DifficultyValues = structuredClone(DIFFICULTY);

/** Easy: wider deflects, softer blows, longer openings, fewer counters and perilous moves. */
const EASY: DifficultyValues = {
  playerDamage: 0.5,
  blockPosture: 0.45,
  playerPostureRegen: 22,
  deflectEarly: 0.3,
  deflectLate: 0.07,
  deflectSteps: [0.3, 0.3, 0.27, 0.24, 0.2],
  deflectPosture: 13,
  cutPostureOpen: 0.65,
  cutPostureArmoured: 0.3,
  bossRegen: 8,
  recoverAfterAttack: [1.05, 0.85],
  guardSlip: [0.4, 0.25],
  bossDeflect: [0, 0, 0.08, 0.25, 0.5],
  counterDelay: 0.6,
  counterFlurry: 0.35,
  openHits: 3,
  recoilT: 1.05,
  gap: { p1: [0.8, 1.0], p2: [0.5, 0.7] },
  tempo: [1, 1],
  picks: {
    p1: { combo: 0.32, comboDelay: 0.1, overhead: 0.26, thrust: 0.13, sweep: 0.08, grab: 0.04, idle: 0.07 },
    p2: { flurry: 0.07, combo: 0.26, comboDelay: 0.08, overhead: 0.2, thrust: 0.13, sweep: 0.12, grab: 0.06, idle: 0.08 },
  },
  healReact: 0.5,
  healCloseStart: 0,
  gourdCharges: 4,
};

/** Hard: the original tuning from before the easier pass (the bracketed values above). */
const HARD: DifficultyValues = {
  playerDamage: 1,
  blockPosture: 0.9,
  playerPostureRegen: 13,
  deflectEarly: 0.2,
  deflectLate: 0.05,
  deflectSteps: [0.2, 0.2, 0.167, 0.133, 0.1],
  deflectPosture: 5,
  cutPostureOpen: 0.5,
  cutPostureArmoured: 0.25,
  bossRegen: 13,
  recoverAfterAttack: [0, 0],
  guardSlip: [0, 0],
  bossDeflect: [0, 0, 0.3, 0.65, 1],
  counterDelay: 0,
  counterFlurry: 1,
  openHits: 2,
  recoilT: 0.9,
  gap: { p1: [0.35, 0.6], p2: [0.15, 0.35] },
  tempo: [1, 1.12],
  picks: {
    p1: { combo: 0.3, comboDelay: 0.14, overhead: 0.2, thrust: 0.14, sweep: 0.1, grab: 0.06, idle: 0.06 },
    p2: { flurry: 0.22, combo: 0.18, comboDelay: 0.14, overhead: 0.12, thrust: 0.14, sweep: 0.1, grab: 0.08, idle: 0.02 },
  },
  healReact: 0.22,
  healCloseStart: 0.18,
  gourdCharges: 3,
};

export const DIFFICULTY_PRESETS: Readonly<Record<DifficultyName, DifficultyValues>> = { easy: EASY, medium: MEDIUM, hard: HARD };

/** Deep copy `src` into `dst` keeping every array / object reference (Input holds deflectSteps). */
function assignInPlace(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const k of Object.keys(src)) {
    const s = src[k];
    const d = dst[k];
    if (Array.isArray(s) && Array.isArray(d)) {
      d.length = 0;
      d.push(...s);
    } else if (s && typeof s === "object" && d && typeof d === "object") {
      for (const dk of Object.keys(d)) if (!(dk in (s as object))) delete (d as Record<string, unknown>)[dk];
      assignInPlace(d as Record<string, unknown>, s as Record<string, unknown>);
    } else dst[k] = s;
  }
}

let active: DifficultyName = "medium";

/** Load a preset into DIFFICULTY (called when a fight starts). */
export function applyDifficulty(name: DifficultyName): void {
  assignInPlace(DIFFICULTY as unknown as Record<string, unknown>, DIFFICULTY_PRESETS[name] as unknown as Record<string, unknown>);
  active = name;
}

/** The preset currently loaded into DIFFICULTY. */
export function activeDifficulty(): DifficultyName {
  return active;
}

export function isDifficulty(v: unknown): v is DifficultyName {
  return typeof v === "string" && (DIFFICULTY_NAMES as readonly string[]).includes(v);
}

const STORE_KEY = "shinobi-duel.difficulty";

/** The title's starting choice: `?difficulty=` wins, then the remembered choice, then medium. */
export function initialDifficulty(): DifficultyName {
  const q = new URLSearchParams(location.search).get("difficulty");
  if (isDifficulty(q)) return q;
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (isDifficulty(s)) return s;
  } catch {
    /* storage unavailable */
  }
  return "medium";
}

export function rememberDifficulty(name: DifficultyName): void {
  try {
    localStorage.setItem(STORE_KEY, name);
  } catch {
    /* storage unavailable */
  }
}
