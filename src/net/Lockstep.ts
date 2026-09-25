/**
 * Deterministic lockstep over the 120 Hz combat step. The duel is a pure function of the two
 * players' inputs (fixed step, seeded randomness, no wall-clock reads in the simulation), so the
 * two browsers exchange nothing but input frames and each runs the whole fight itself. Tick t
 * only runs once both frames for t are in; a local frame sampled at tick t is scheduled for tick
 * t + delay, which hides the round trip as long as delay covers half of it.
 *
 * Every packet carries all the frames the other side hasn't acknowledged yet, so the unordered,
 * no-retransmit channel loses nothing. Every HASH_EVERY ticks both sides hash the fight state and
 * compare; a mismatch (a browser whose Math differs, say) triggers a resync: the host names a
 * tick far enough ahead that the guest can't have passed it, and the guest waits there for the
 * host's gameplay state.
 */
import type { CtlMsg, Wire } from "./Transport";

export type Role = "shinobi" | "general";

export interface Frame {
  held: number;
  taps: number;
  ax: number;
  ay: number;
  /** Camera heading of that player (movement is camera-relative). */
  yaw: number;
  flags: number;
}

export const FLAG = { confirm: 1, back: 2, rematch: 4 } as const;
export const NEUTRAL: Frame = { held: 0, taps: 0, ax: 0, ay: 0, yaw: 0, flags: 0 };
const FRAME_BYTES = 9;
const MAX_FRAMES = 60;
const HASH_EVERY = 120;
const PKT_INPUT = 1;
const PKT_PING = 2;
const PKT_PONG = 3;

export function quantize(f: Frame): Frame {
  const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));
  return { held: f.held & 0xffff, taps: f.taps & 0xffff, ax: q(f.ax) / 127, ay: q(f.ay) / 127, yaw: Math.round(wrap(f.yaw) * 10000) / 10000, flags: f.flags & 0xff };
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Lockstep {
  /** Next tick to simulate. */
  tick = 0;
  private readonly local = new Map<number, Frame>();
  private readonly remote = new Map<number, Frame>();
  /** Highest remote tick with every earlier one present. */
  private remoteHave = -1;
  /** Highest local tick the other side has confirmed. */
  private remoteAck = -1;
  private lastLocal = -1;
  private lastSend = 0;
  private readonly hashes = new Map<number, number>();
  private readonly peerHashes = new Map<number, number>();
  /** Resync barrier: the guest stops after this tick until the host's state for it is in. */
  private barrier = -1;
  private snap: { tick: number; state: unknown } | null = null;
  rtt = 0;
  /** Seconds spent waiting on the other player (for the HUD). */
  stalledFor = 0;
  desyncs = 0;
  resyncs = 0;
  onResync: ((state: unknown) => void) | null = null;
  getState: (() => unknown) | null = null;

  constructor(
    readonly t: Wire,
    readonly role: Role,
    readonly delay: number,
  ) {
    for (let i = 0; i < delay; i++) {
      this.local.set(i, NEUTRAL);
      this.remote.set(i, NEUTRAL);
    }
    this.lastLocal = delay - 1;
    this.remoteHave = delay - 1;
  }

  get host(): boolean {
    return this.t.host;
  }

  /** Both frames for the next tick are in (and no resync is holding us). */
  canStep(): boolean {
    if (this.barrier >= 0 && this.tick === this.barrier + 1 && !this.host) {
      if (!this.snap || this.snap.tick !== this.barrier) return false;
      this.onResync?.(this.snap.state);
      this.snap = null;
      this.barrier = -1;
      this.resyncs++;
    }
    return this.remote.has(this.tick) && this.local.has(this.tick);
  }

  /** Schedule this player's input for tick + delay and send what the other side still lacks. */
  produce(f: Frame): void {
    const at = this.tick + this.delay;
    if (at > this.lastLocal) {
      this.local.set(at, quantize(f));
      this.lastLocal = at;
    }
    this.send();
  }

  /** The frames for the tick about to run, by fighter. */
  frames(): { shinobi: Frame; general: Frame } {
    const mine = this.local.get(this.tick)!;
    const theirs = this.remote.get(this.tick)!;
    return this.role === "shinobi" ? { shinobi: mine, general: theirs } : { shinobi: theirs, general: mine };
  }

  /** After the tick ran: drop old frames, hash, and (host) serve a pending resync. */
  advance(hash: () => number): void {
    const t = this.tick;
    if (t % HASH_EVERY === 0) {
      const h = hash();
      this.hashes.set(t, h);
      this.t.sendCtl({ t: "hash", tick: t, h });
      this.check(t);
    }
    if (this.host && this.barrier === t && this.getState) {
      this.t.sendCtl({ t: "snap", tick: t, state: this.getState() });
      this.barrier = -1;
      this.resyncs++;
    }
    this.local.delete(t - 240);
    this.remote.delete(t - 240);
    this.tick = t + 1;
  }

  private check(t: number): void {
    const a = this.hashes.get(t);
    const b = this.peerHashes.get(t);
    if (a === undefined || b === undefined) return;
    this.hashes.delete(t);
    this.peerHashes.delete(t);
    if (a === b) return;
    this.desyncs++;
    console.warn(`[net] desync at tick ${t}`);
    // The host picks a tick the guest can't have reached yet (it runs at most `delay` ahead).
    if (this.host && this.barrier < 0) {
      this.barrier = this.tick + 2 * this.delay + 60;
      this.t.sendCtl({ t: "resyncAt", tick: this.barrier });
    }
  }

  /** Control messages meant for the lockstep (the rest is the lobby's). */
  ctl(m: CtlMsg): boolean {
    if (m.t === "hash") {
      this.peerHashes.set(m.tick as number, m.h as number);
      this.check(m.tick as number);
    } else if (m.t === "resyncAt") {
      const at = m.tick as number;
      if (!this.host && at >= this.tick) this.barrier = at;
    } else if (m.t === "snap") {
      if (!this.host) this.snap = { tick: m.tick as number, state: m.state };
    } else return false;
    return true;
  }

  // ------------------------------------------------------------------ packets

  /** Resend on a timer too: a lost last packet must not leave both sides waiting forever. */
  pump(dt: number, stepped: boolean): void {
    const now = performance.now() / 1000;
    this.stalledFor = stepped ? 0 : this.stalledFor + dt;
    if (now - this.lastSend > 0.03) this.send();
    if (now - (this.pingAt ?? 0) > 0.5) {
      this.pingAt = now;
      const b = new DataView(new ArrayBuffer(9));
      b.setUint8(0, PKT_PING);
      b.setFloat64(1, performance.now());
      this.t.sendInp(b.buffer);
    }
  }
  private pingAt = 0;

  private send(): void {
    this.lastSend = performance.now() / 1000;
    const first = Math.max(this.remoteAck + 1, this.lastLocal - MAX_FRAMES + 1);
    const n = Math.max(0, this.lastLocal - first + 1);
    const b = new DataView(new ArrayBuffer(10 + n * FRAME_BYTES));
    b.setUint8(0, PKT_INPUT);
    b.setInt32(1, this.remoteHave);
    b.setInt32(5, first);
    b.setUint8(9, n);
    for (let i = 0; i < n; i++) {
      const f = this.local.get(first + i) ?? NEUTRAL;
      const o = 10 + i * FRAME_BYTES;
      b.setUint16(o, f.held);
      b.setUint16(o + 2, f.taps);
      b.setInt8(o + 4, Math.round(f.ax * 127));
      b.setInt8(o + 5, Math.round(f.ay * 127));
      b.setInt16(o + 6, Math.round(f.yaw * 10000));
      b.setUint8(o + 8, f.flags);
    }
    this.t.sendInp(b.buffer);
  }

  onPacket(buf: ArrayBuffer): void {
    const b = new DataView(buf);
    const type = b.getUint8(0);
    if (type === PKT_PING) {
      const r = new DataView(new ArrayBuffer(9));
      r.setUint8(0, PKT_PONG);
      r.setFloat64(1, b.getFloat64(1));
      this.t.sendInp(r.buffer);
      return;
    }
    if (type === PKT_PONG) {
      const ms = performance.now() - b.getFloat64(1);
      this.rtt = this.rtt ? this.rtt * 0.8 + ms * 0.2 : ms;
      return;
    }
    if (type !== PKT_INPUT) return;
    this.remoteAck = Math.max(this.remoteAck, b.getInt32(1));
    const first = b.getInt32(5);
    const n = b.getUint8(9);
    for (let i = 0; i < n; i++) {
      const t = first + i;
      if (t <= this.remoteHave || this.remote.has(t)) continue;
      const o = 10 + i * FRAME_BYTES;
      this.remote.set(t, {
        held: b.getUint16(o),
        taps: b.getUint16(o + 2),
        ax: b.getInt8(o + 4) / 127,
        ay: b.getInt8(o + 5) / 127,
        yaw: b.getInt16(o + 6) / 10000,
        flags: b.getUint8(o + 8),
      });
    }
    while (this.remote.has(this.remoteHave + 1)) this.remoteHave++;
  }
}

/** FNV-1a over the float64 bytes of the numbers and the chars of the strings. */
export function hashValues(vals: (number | string | boolean)[]): number {
  let h = 0x811c9dc5;
  const dv = new DataView(new ArrayBuffer(8));
  const mix = (byte: number) => {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  };
  for (const v of vals) {
    if (typeof v === "number") {
      dv.setFloat64(0, v);
      for (let i = 0; i < 8; i++) mix(dv.getUint8(i));
    } else {
      const s = String(v);
      for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i) & 0xff);
    }
  }
  return h >>> 0;
}
