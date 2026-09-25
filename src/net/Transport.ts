/**
 * The wire between two browsers. A WebSocket to the lobby server finds the other player (a room
 * code or quick match) and carries the WebRTC handshake; the duel itself then runs over two
 * DataChannels straight between the players: "inp" (unordered, no retransmits: input frames,
 * which are sent redundantly) and "ctl" (reliable: start, hashes, resyncs). When no direct path
 * can be opened (strict NATs, no TURN server) everything falls back to the server relay, which
 * is slower but always works. The game never needs to know which path a packet took.
 */

export type NetPath = "connecting" | "relay" | "p2p";
export type CtlMsg = { t: string; [k: string]: unknown };

/** What the lockstep and the lobby need of a wire (the WebSocket lobby, or the PeerJS broker). */
export interface Wire {
  readonly host: boolean;
  readonly path: NetPath;
  open(room: string | null, version: string): void;
  close(): void;
  sendInp(b: ArrayBuffer): void;
  sendCtl(m: CtlMsg): void;
}

export interface TransportEvents {
  /** The lobby answered: our seat in the room. */
  onJoined?: (room: string, host: boolean) => void;
  /** Both players are in the room (the handshake starts). */
  onPeer?: () => void;
  onCtl?: (m: CtlMsg) => void;
  onInp?: (b: ArrayBuffer) => void;
  onPath?: (p: NetPath) => void;
  /** The other player left, the server closed, or the room was refused. */
  onClosed?: (why: string) => void;
}

/** Test knobs: `?p2p=0` forces the relay, `?lag=ms` delays everything this side sends. */
const Q = new URLSearchParams(location.search);
const NO_P2P = Q.get("p2p") === "0";
const LAG = Math.max(0, +(Q.get("lag") ?? 0) || 0);
const later = (f: () => void) => (LAG ? setTimeout(f, LAG) : f());

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];

export class Transport implements Wire {
  host = false;
  room = "";
  path: NetPath = "connecting";
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private inp: RTCDataChannel | null = null;
  private ctl: RTCDataChannel | null = null;
  private closed = false;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    readonly url: string,
    private readonly ev: TransportEvents,
  ) {}

  /** `room` null: quick match (the server pairs the next two players who ask). */
  open(room: string | null, version: string): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(room ? { t: "join", room, v: version } : { t: "quick", v: version }));
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return this.ev.onInp?.(e.data as ArrayBuffer);
      let m: CtlMsg;
      try {
        m = JSON.parse(e.data) as CtlMsg;
      } catch {
        return;
      }
      if (m.t === "joined") {
        this.host = !!m.host;
        this.room = String(m.room);
        this.ev.onJoined?.(this.room, this.host);
      } else if (m.t === "peer") {
        this.setPath("relay");
        this.ev.onPeer?.();
        if (this.host && !NO_P2P) void this.offer();
      } else if (m.t === "signal") void this.signal(m.d as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit });
      else if (m.t === "rel") this.ev.onCtl?.(m.d as CtlMsg);
      else if (m.t === "left") this.fail("the other player left");
      else if (m.t === "error") this.fail(String(m.m ?? "refused"));
    };
    ws.onclose = () => this.fail("lost the lobby server");
    ws.onerror = () => this.fail("can't reach the lobby server");
  }

  private setPath(p: NetPath): void {
    if (this.path === p) return;
    this.path = p;
    this.ev.onPath?.(p);
  }

  private fail(why: string): void {
    if (this.closed) return;
    this.closed = true;
    this.ev.onClosed?.(why);
    this.close();
  }

  close(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.pc?.close();
    this.pc = null;
  }

  // ------------------------------------------------------------------ WebRTC

  private peer(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ ice: e.candidate.toJSON() });
    };
    pc.ondatachannel = (e) => this.adopt(e.channel);
    pc.onconnectionstatechange = () => {
      // A direct path that dies mid-duel drops back to the relay (the server link is still up).
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        this.inp = this.ctl = null;
        if (!this.closed) this.setPath("relay");
      }
    };
    return pc;
  }

  private adopt(dc: RTCDataChannel): void {
    dc.binaryType = "arraybuffer";
    if (dc.label === "inp") this.inp = dc;
    else this.ctl = dc;
    dc.onopen = () => {
      if (this.inp?.readyState === "open" && this.ctl?.readyState === "open") this.setPath("p2p");
    };
    dc.onmessage = (e) => {
      if (dc.label === "inp") this.ev.onInp?.(e.data as ArrayBuffer);
      else {
        try {
          this.ev.onCtl?.(JSON.parse(e.data as string) as CtlMsg);
        } catch {
          /* not ours */
        }
      }
    };
  }

  private async offer(): Promise<void> {
    const pc = this.peer();
    this.adopt(pc.createDataChannel("inp", { ordered: false, maxRetransmits: 0 }));
    this.adopt(pc.createDataChannel("ctl", { ordered: true }));
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    this.sendSignal({ sdp: pc.localDescription!.toJSON() });
  }

  private async signal(d: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }): Promise<void> {
    try {
      const pc = this.peer();
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c);
        if (d.sdp.type === "offer") {
          const a = await pc.createAnswer();
          await pc.setLocalDescription(a);
          this.sendSignal({ sdp: pc.localDescription!.toJSON() });
        }
      } else if (d.ice) {
        if (pc.remoteDescription) await pc.addIceCandidate(d.ice);
        else this.pendingIce.push(d.ice);
      }
    } catch (e) {
      // No direct path: the relay carries on.
      console.warn("[net] webrtc", e);
    }
  }

  private sendSignal(d: unknown): void {
    this.wsSend(JSON.stringify({ t: "signal", d }));
  }

  private wsSend(data: string | ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  // ------------------------------------------------------------------ game traffic

  sendInp(b: ArrayBuffer): void {
    if (LAG) return void later(() => this.sendInpNow(b));
    this.sendInpNow(b);
  }

  private sendInpNow(b: ArrayBuffer): void {
    if (this.inp?.readyState === "open") {
      try {
        this.inp.send(b);
        return;
      } catch {
        /* fall through to the relay */
      }
    }
    this.wsSend(b);
  }

  sendCtl(m: CtlMsg): void {
    const s = JSON.stringify(m);
    if (LAG) return void later(() => this.sendCtlNow(s, m));
    this.sendCtlNow(s, m);
  }

  private sendCtlNow(s: string, m: CtlMsg): void {
    if (this.ctl?.readyState === "open") {
      try {
        this.ctl.send(s);
        return;
      } catch {
        /* fall through to the relay */
      }
    }
    this.wsSend(JSON.stringify({ t: "rel", d: m }));
  }
}

/** Where the lobby server lives: `?signal=` wins, then the page's own host when it is the server. */
export function signalURL(): string {
  const q = new URLSearchParams(location.search).get("signal");
  if (q) return q;
  const { protocol, host, hostname } = location;
  const ws = protocol === "https:" ? "wss:" : "ws:";
  if (hostname.endsWith(".hf.space") || import.meta.env.VITE_SAME_ORIGIN_SIGNAL) return `${ws}//${host}/ws`;
  if (hostname === "localhost" || hostname === "127.0.0.1") return `ws://${hostname}:7860/ws`;
  return import.meta.env.VITE_SIGNAL_URL ?? "peerjs";
}
