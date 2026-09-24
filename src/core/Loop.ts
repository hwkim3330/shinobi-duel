/**
 * Fixed-step simulation, variable-rate render (pattern from parapet).
 *
 * Combat runs at 120 Hz so a fast slash (tip speed ~25 m/s) advances ~20 cm per step and the
 * blade-vs-capsule sweep never skips a body. Frame delta is clamped so a tab switch does not
 * spiral into hundreds of steps.
 */
export const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.1;

export class Loop {
  private last = 0;
  private acc = 0;
  private running = false;
  private handle = 0;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly frameUpdate: (dt: number, alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      // rAF timestamps can precede the performance.now() taken in start().
      if (!(dt > 0)) dt = 0;
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 16) {
        this.fixedUpdate(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
      this.frameUpdate(dt, this.acc / FIXED_DT);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  /** Advance the simulation manually (test harness, headless capture). */
  step(seconds: number, frame = true): void {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) this.fixedUpdate(FIXED_DT);
    if (frame) this.frameUpdate(FIXED_DT, 0);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }
}
