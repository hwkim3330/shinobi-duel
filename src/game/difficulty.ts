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
};
