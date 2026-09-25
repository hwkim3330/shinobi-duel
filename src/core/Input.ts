/**
 * Keyboard + mouse. Edge-triggered actions are stamped with the time they were pressed (in
 * gameplay seconds) so the combat code can measure the deflect window exactly, independent
 * of frame rate. An action is held while any of its sources (keys, mouse buttons, the test bot)
 * is down, so a second binding pressed while the first is held is a fresh press.
 *
 * Menus (title, resurrection, defeat, victory) never read gameplay actions: they arm a one-shot
 * prompt that fires once, on a fresh key / button press made after an arming delay; anything
 * already held when the prompt was armed is ignored until released.
 */
import { DIFFICULTY } from "../game/difficulty";

export type Action = "attack" | "block" | "dodge" | "jump" | "lock" | "heal" | "heavy" | "thrust" | "sweep" | "grab" | "leap" | "feint" | "flurry";
/** Every action, in the bit order of a netplay input frame. */
export const ACTIONS: readonly Action[] = ["attack", "block", "dodge", "jump", "lock", "heal", "heavy", "thrust", "sweep", "grab", "leap", "feint", "flurry"];
/** Whose key map the keyboard follows: the kunoichi's, or the general's (a human at his controls). */
export type KeyMap = "shinobi" | "general";
export type PromptKey = "confirm" | "back";

/**
 * Keys that never count as "any key": mute (M), the title's difficulty keys (A / D, arrows,
 * 1-3), modifiers, OS / lock keys, function keys.
 */
const NOT_ANY = /^(KeyM|Key[AD]|Arrow(Left|Right)|(Digit|Numpad)[1-3]|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|OS(Left|Right)|CapsLock|NumLock|ScrollLock|ContextMenu|Tab|PrintScreen|F\d+)$/;
const MOUSE_ACTION: Record<number, Action | undefined> = { 0: "attack", 1: "lock", 2: "block" };

export class Input {
  readonly keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  private pressed = new Map<Action, number>();
  private held = new Map<Action, Set<string>>();
  private heldSince = new Map<Action, number>();
  /** Current gameplay clock, set by the game each step; presses are stamped with it. */
  clock = 0;
  /** Real-time clock (seconds), set by the game each frame; prompts are debounced with it. */
  realClock = 0;
  locked = false;
  /** Clicks may take pointer lock (the fight only; menus keep a free cursor). */
  lockable = false;
  private prompt: { keys: "any" | "menu"; at: number; stale: Set<string> } | null = null;
  private promptOut: PromptKey | null = null;
  /** Every fresh key press (menus that need more than a prompt: the title's difficulty choice). */
  onKeyDown: ((code: string) => void) | null = null;

  /** Key map for the keyboard (the mouse buttons are the same for both). */
  map: KeyMap = "shinobi";
  /** Actions pressed since the last `sample()` (netplay: a tap between two ticks still counts). */
  private taps = 0;

  /**
   * `canvas` null: a virtual controller with no DOM listeners, driven by press() / release() and
   * `botAxis` (the AI kunoichi, and both fighters in a netplay match, where the inputs come from
   * the lockstep frames).
   */
  constructor(private readonly canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKeyDown?.(e.code);
      this.promptPress(e.code);
      const a = this.keyAction(e.code);
      if (a) this.press(a, e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      this.prompt?.stale.delete(e.code);
      const a = this.keyAction(e.code);
      if (a) this.release(a, e.code);
    });
    window.addEventListener("blur", () => this.releaseAll());
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousedown", (e) => {
      if (this.lockable && !this.locked) this.requestLock();
      const src = `Mouse${e.button}`;
      this.keys.add(src);
      this.promptPress(src);
      const a = MOUSE_ACTION[e.button];
      if (a) {
        e.preventDefault();
        this.press(a, src);
      }
    });
    window.addEventListener("mouseup", (e) => {
      const src = `Mouse${e.button}`;
      this.keys.delete(src);
      this.prompt?.stale.delete(src);
      const a = MOUSE_ACTION[e.button];
      if (a) this.release(a, src);
    });
    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  private keyAction(code: string): Action | null {
    if (this.map === "general") return this.generalAction(code);
    switch (code) {
      case "KeyJ":
        return "attack";
      case "KeyK":
      case "KeyL":
        return "block";
      case "ShiftLeft":
      case "ShiftRight":
        return "dodge";
      case "Space":
        return "jump";
      case "KeyQ":
      case "Tab":
        return "lock";
      case "KeyR":
        return "heal";
    }
    return null;
  }

  /**
   * The general's keys. J / K / Shift / Space / Tab mean what they mean for her (attack, guard,
   * step or sprint, leap, lock); the rest of his moveset sits around WASD.
   */
  private generalAction(code: string): Action | null {
    switch (code) {
      case "KeyJ":
        return "attack";
      case "KeyK":
      case "KeyL":
        return "block";
      case "ShiftLeft":
      case "ShiftRight":
        return "dodge";
      case "Space":
        return "leap";
      case "KeyF":
        return "heavy";
      case "KeyQ":
        return "thrust";
      case "KeyE":
        return "sweep";
      case "KeyR":
        return "grab";
      case "KeyC":
        return "feint";
      case "KeyX":
        return "flurry";
      case "Tab":
        return "lock";
    }
    return null;
  }

  // ------------------------------------------------------------------ prompts

  /**
   * Arm a one-shot prompt. "any": every key / button confirms. "menu": Enter, E, Space or a left
   * click confirm, Escape / Backspace go back; other keys are ignored. Replaces any armed prompt.
   */
  armPrompt(keys: "any" | "menu", delay = 0.5): void {
    this.prompt = { keys, at: this.realClock + delay, stale: new Set(this.keys) };
    this.promptOut = null;
  }

  disarmPrompt(): void {
    this.prompt = null;
    this.promptOut = null;
  }

  get promptArmed(): boolean {
    return !!this.prompt;
  }

  /** The prompt's answer, once (the prompt disarms itself when it fires). */
  takePrompt(): PromptKey | null {
    const r = this.promptOut;
    this.promptOut = null;
    return r;
  }

  /** A press from a key / button (or a test); returns what the prompt made of it. */
  promptPress(code: string): PromptKey | null {
    const p = this.prompt;
    if (!p || this.realClock < p.at || p.stale.has(code)) return null;
    let k: PromptKey | null = null;
    if (code === "Escape" || code === "Backspace") k = "back";
    else if ((p.keys === "any" && !NOT_ANY.test(code)) || code === "Enter" || code === "NumpadEnter" || code === "KeyE" || code === "Space" || code === "Mouse0") k = "confirm";
    if (!k) return null;
    this.prompt = null;
    this.promptOut = k;
    return k;
  }

  // ------------------------------------------------------------------ actions

  /**
   * Anti-mash (the wiki's rule, made forgiving): a guard press soon after the guard was released
   * shrinks the deflect window, one step per such press (DIFFICULTY.deflectSteps: 0.25 → 0.25 →
   * 0.22 → 0.19 → 0.16 s, never below 0.16). The penalty clears once guard has been released for
   * MASH_RESET, and after a successful deflect. Two presses per incoming blow keep the full window.
   */
  static readonly MASH_RESET = 0.5;
  static readonly DEFLECT_STEPS = DIFFICULTY.deflectSteps;
  private mash = 0;
  private guardUp = -1;
  private lastGuardPress = -1;
  /** Deflect window granted to the most recent guard press. */
  deflectWindow = Input.DEFLECT_STEPS[0];

  press(a: Action, src = "bot"): void {
    let set = this.held.get(a);
    if (!set) this.held.set(a, (set = new Set()));
    if (!set.size) {
      if (a === "block") {
        const recent = this.guardUp >= 0 && this.clock - this.guardUp < Input.MASH_RESET;
        this.mash = recent ? Math.min(this.mash + 1, Input.DEFLECT_STEPS.length - 1) : 0;
        this.deflectWindow = Input.DEFLECT_STEPS[this.mash];
      }
      this.heldSince.set(a, this.clock);
    } else if (a === "block") {
      // Another binding tapped while guard is held: one re-tap is a fresh window, but tapping
      // it repeatedly is mashing like any other.
      const recent = this.lastGuardPress >= 0 && this.clock - this.lastGuardPress < Input.MASH_RESET;
      this.mash = recent ? Math.min(this.mash + 1, Input.DEFLECT_STEPS.length - 1) : 0;
      this.deflectWindow = Input.DEFLECT_STEPS[this.mash];
    }
    if (a === "block") this.lastGuardPress = this.clock;
    set.add(src);
    this.pressed.set(a, this.clock);
    this.taps |= 1 << ACTIONS.indexOf(a);
  }

  release(a: Action, src = "bot"): void {
    const set = this.held.get(a);
    if (!set || !set.has(src)) return;
    set.delete(src);
    if (!set.size && a === "block") this.guardUp = this.clock;
  }

  releaseAll(): void {
    this.keys.clear();
    if (this.isHeld("block")) this.guardUp = this.clock;
    this.held.clear();
  }

  /** Drop every buffered press (a prompt answer or a restart must not leak into the fight). */
  flush(): void {
    this.pressed.clear();
  }

  resetMash(): void {
    this.mash = 0;
    this.guardUp = -1;
    this.lastGuardPress = -1;
    this.deflectWindow = Input.DEFLECT_STEPS[0];
  }

  /** Consume a buffered press if it happened within `buffer` seconds. */
  consume(a: Action, buffer = 0.25): boolean {
    const t = this.pressed.get(a);
    if (t === undefined) return false;
    this.pressed.delete(a);
    return this.clock - t <= buffer;
  }

  peekPressTime(a: Action): number | undefined {
    return this.pressed.get(a);
  }

  isHeld(a: Action): boolean {
    return (this.held.get(a)?.size ?? 0) > 0;
  }

  /** Seconds the action has been held continuously (0 when up). */
  heldFor(a: Action): number {
    return this.isHeld(a) ? this.clock - (this.heldSince.get(a) ?? this.clock) : 0;
  }

  /**
   * Netplay: what the local player is doing right now, as bit masks over ACTIONS: held actions,
   * and actions pressed since the previous sample (so a quick tap between two ticks is not lost).
   */
  sample(): { held: number; taps: number } {
    let held = 0;
    for (let i = 0; i < ACTIONS.length; i++) if (this.isHeld(ACTIONS[i])) held |= 1 << i;
    const taps = this.taps;
    this.taps = 0;
    return { held, taps };
  }

  /** Netplay: replay a remote (or delayed local) frame's buttons on this virtual controller. */
  applyFrame(held: number, taps: number): void {
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      const bit = 1 << i;
      const was = this.isHeld(a);
      if (taps & bit) {
        if (was) this.release(a, "net");
        this.press(a, "net");
        if (!(held & bit)) this.release(a, "net");
      } else if (held & bit && !was) this.press(a, "net");
      else if (!(held & bit) && was) this.release(a, "net");
    }
  }

  /** Netplay resync: everything that decides what the next press does. */
  saveState(): unknown {
    return {
      pressed: [...this.pressed],
      held: [...this.held].map(([a, s]) => [a, [...s]]),
      heldSince: [...this.heldSince],
      mash: this.mash,
      guardUp: this.guardUp,
      lastGuardPress: this.lastGuardPress,
      deflectWindow: this.deflectWindow,
      botAxis: this.botAxis,
    };
  }

  loadState(o: unknown): void {
    const s = o as { pressed: [Action, number][]; held: [Action, string[]][]; heldSince: [Action, number][]; mash: number; guardUp: number; lastGuardPress: number; deflectWindow: number; botAxis: { x: number; y: number } | null };
    this.pressed = new Map(s.pressed);
    this.held = new Map(s.held.map(([a, l]) => [a, new Set(l)]));
    this.heldSince = new Map(s.heldSince);
    this.mash = s.mash;
    this.guardUp = s.guardUp;
    this.lastGuardPress = s.lastGuardPress;
    this.deflectWindow = s.deflectWindow;
    this.botAxis = s.botAxis;
  }

  /** Test bot: overrides the movement keys when set. */
  botAxis: { x: number; y: number } | null = null;

  requestLock(): void {
    if (!this.canvas || document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable (headless, iframe) */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  axis(): { x: number; y: number } {
    if (this.botAxis) return this.botAxis;
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }
}
