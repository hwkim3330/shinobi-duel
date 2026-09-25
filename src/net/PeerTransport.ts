/**
 * The same wire as Transport, with no server of our own: the public PeerJS broker introduces the
 * two browsers (a peer id made of the build and the room code), and the duel runs over two
 * DataConnections straight between them. There is no relay: two networks that can't open a
 * direct link can't duel this way (the WebSocket lobby in server/ can relay them).
 *
 * Quick match: whoever finds the shared quick-match id free takes it and waits; the next player
 * connects to it. Once paired, the host leaves the broker so the id (or the room) frees up.
 */
import Peer, { type DataConnection } from "peerjs";
import type { CtlMsg, NetPath, TransportEvents } from "./Transport";

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];
const PEER_OPTS = { config: { iceServers: ICE }, debug: 0 };

export class PeerTransport {
  host = false;
  room = "";
  path: NetPath = "connecting";
  private peer: Peer | null = null;
  private inp: DataConnection | null = null;
  private ctl: DataConnection | null = null;
  private closed = false;
  private paired = false;

  constructor(private readonly ev: TransportEvents) {}

  open(room: string | null, version: string): void {
    const base = `shinobi-duel-${version}-`.replace(/[^A-Za-z0-9-]/g, "");
    if (room) {
      this.room = room;
      // The link carries host=1 for the one who made the room; anyone else joins it.
      const hosting = new URLSearchParams(location.search).get("host") === "1";
      if (hosting) this.hostAs(base + room, () => this.fail("that room code is already taken, make a new room"));
      else this.joinTo(base + room, () => this.fail("no such room (it may have closed, or your opponent is on another version: both reload)"));
    } else {
      this.room = "";
      this.quick(base + "quick", 0);
    }
  }

  private quick(id: string, tries: number): void {
    if (tries > 6) return this.fail("the quick-match queue is busy, try again");
    // Someone waiting? Join them. Nobody? Wait there ourselves (and retry if we raced someone).
    this.joinTo(id, () => this.hostAs(id, () => this.quick(id, tries + 1)));
  }

  private hostAs(id: string, taken: () => void): void {
    this.reset();
    const p = new Peer(id, PEER_OPTS);
    this.peer = p;
    p.on("open", () => {
      this.host = true;
      this.ev.onJoined?.(this.room, true);
    });
    p.on("connection", (c) => {
      // One opponent: a third player's connections are turned away.
      if (this.paired || (c.label === "inp" && this.inp) || (c.label === "ctl" && this.ctl)) return void c.close();
      this.adopt(c);
    });
    p.on("error", (e: { type?: string }) => {
      if (e.type === "unavailable-id") taken();
      else if (!this.paired) this.fail(`the matchmaking broker failed (${e.type ?? "error"})`);
    });
  }

  private joinTo(id: string, missing: () => void): void {
    this.reset();
    const p = new Peer(PEER_OPTS);
    this.peer = p;
    let gone = false;
    p.on("open", () => {
      this.host = false;
      this.ev.onJoined?.(this.room, false);
      this.adopt(p.connect(id, { label: "inp", reliable: false, serialization: "raw" }));
      this.adopt(p.connect(id, { label: "ctl", reliable: true, serialization: "raw" }));
    });
    p.on("error", (e: { type?: string }) => {
      if (e.type === "peer-unavailable" && !gone) {
        gone = true;
        missing();
      } else if (!this.paired && e.type !== "peer-unavailable") this.fail(`the matchmaking broker failed (${e.type ?? "error"})`);
    });
  }

  private reset(): void {
    this.inp = this.ctl = null;
    const p = this.peer;
    this.peer = null;
    p?.destroy();
  }

  private adopt(c: DataConnection): void {
    if (c.label === "inp") this.inp = c;
    else this.ctl = c;
    c.on("open", () => {
      if (this.inp?.open && this.ctl?.open && !this.paired) {
        this.paired = true;
        this.path = "p2p";
        this.ev.onPeer?.();
        this.ev.onPath?.("p2p");
        // Free the room / quick-match id; the open connections stay up.
        if (this.host) this.peer?.disconnect();
      }
    });
    c.on("data", (d) => {
      if (c.label === "inp") {
        if (d instanceof ArrayBuffer) this.ev.onInp?.(d);
        else if (ArrayBuffer.isView(d)) this.ev.onInp?.(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
      } else if (typeof d === "string") {
        try {
          this.ev.onCtl?.(JSON.parse(d) as CtlMsg);
        } catch {
          /* not ours */
        }
      }
    });
    c.on("close", () => {
      if (this.paired) this.fail("the other player left");
    });
    c.on("error", () => {
      if (this.paired) this.fail("the direct link broke");
    });
    // No relay here: a pair that can't link directly is told so instead of waiting forever.
    setTimeout(() => {
      if (!this.paired && !this.closed && c.label === "ctl" && !c.open && !this.host) this.fail("couldn't open a direct link between your networks");
    }, 20000);
  }

  private fail(why: string): void {
    if (this.closed) return;
    this.closed = true;
    this.ev.onClosed?.(why);
    this.close();
  }

  close(): void {
    this.closed = true;
    this.reset();
  }

  sendInp(b: ArrayBuffer): void {
    if (this.inp?.open) void this.inp.send(b);
  }

  sendCtl(m: CtlMsg): void {
    if (this.ctl?.open) void this.ctl.send(JSON.stringify(m));
  }
}
