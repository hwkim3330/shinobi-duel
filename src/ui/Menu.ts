/**
 * Everything around the duel that the original single fight didn't need: the mode choice on the
 * title (the kunoichi against the AI general, the general against the AI kunoichi, or an online
 * duel), the online lobby (room code, share link, quick match, role), the connection line during
 * a netplay match, and the general's move panel (which perilous attacks are ready).
 *
 * Choices are brush lettering like the rest of the title; the lobby card is washi paper and ink.
 * Every press inside these panels is swallowed so the title's "any key" prompt never sees it.
 */
import type { Role } from "../net/Lockstep";
import { brushStroke, brushText, KANJI_FONT, LATIN_FONT } from "./brush";

export type TitleMode = "solo" | "general";

const CSS = /* css */ `
#menu { position: fixed; inset: 0; pointer-events: none; font-family: ${LATIN_FONT}; color: #efe7da; user-select: none; z-index: 5; }
#menu .modes { position: absolute; right: 4.5vw; top: 7vh; display: flex; flex-direction: column; align-items: flex-end; gap: 1.2vh; transition: opacity 0.4s; }
#menu .modes.hidden { opacity: 0; }
#menu .modes:not(.hidden) .opt { pointer-events: auto; }
#menu .opt { position: relative; display: flex; align-items: center; gap: 10px; padding: 4px 8px 12px; opacity: 0.5; cursor: pointer; transition: opacity 0.25s; filter: drop-shadow(0 1px 4px rgba(0,0,0,0.9)); }
#menu .opt:hover { opacity: 0.82; }
#menu .opt.on { opacity: 0.97; }
#menu .opt .k { height: min(5vh, 44px); width: auto; }
#menu .opt .l { height: min(2.4vh, 20px); width: auto; }
#menu .opt .u { position: absolute; right: -2%; bottom: 0; width: 104%; height: 10px; opacity: 0; transform: scaleX(0.4); transform-origin: right center; transition: opacity 0.2s, transform 0.3s cubic-bezier(.5,.05,.3,1); }
#menu .opt.on .u { opacity: 0.9; transform: scaleX(1); }
#menu .card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(92vw, 460px); padding: 26px 28px 22px; pointer-events: auto;
  background: linear-gradient(180deg, rgba(236,226,208,0.97), rgba(222,209,186,0.97)); color: #1d1512; border-radius: 3px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.6), inset 0 0 60px rgba(120,80,40,0.18); font-family: Georgia, "Times New Roman", serif; }
#menu .card.hidden { display: none; }
#menu .card h2 { margin: 0 0 4px; font-weight: 400; font-size: 26px; letter-spacing: 0.08em; }
#menu .card h2 b { font-family: ${KANJI_FONT}; color: #8a1a12; font-weight: 700; margin-right: 10px; }
#menu .card p { margin: 6px 0 12px; font-size: 14px; line-height: 1.5; color: #4a3a30; }
#menu .row { display: flex; gap: 8px; align-items: center; margin: 10px 0; flex-wrap: wrap; }
#menu .card button { font: 15px Georgia, serif; letter-spacing: 0.06em; padding: 9px 14px; border: 1px solid #2a1c16; background: #1d1512; color: #efe3d0; cursor: pointer; border-radius: 2px; }
#menu .card button.alt { background: transparent; color: #1d1512; }
#menu .card button:hover { background: #8a1a12; border-color: #8a1a12; color: #fff3e4; }
#menu .card button.sel { background: #8a1a12; border-color: #8a1a12; color: #fff3e4; }
#menu .card input { font: 18px ui-monospace, Menlo, monospace; letter-spacing: 0.3em; text-transform: uppercase; width: 8.5em; padding: 7px 8px; border: 1px solid #2a1c16; background: #f6efe2; color: #1d1512; }
#menu .card .small { font-size: 12px; color: #6a5646; }
#menu .card .code { font: 34px ui-monospace, Menlo, monospace; letter-spacing: 0.35em; color: #8a1a12; margin: 6px 0; }
#menu .card .link { font: 12px ui-monospace, Menlo, monospace; word-break: break-all; background: #f6efe2; padding: 6px 8px; border: 1px dashed #8d7a66; }
#menu .card .status { font-style: italic; color: #5a1a12; min-height: 1.4em; }
#menu .card .x { position: absolute; right: 12px; top: 8px; background: none; border: none; color: #1d1512; font-size: 22px; padding: 2px 6px; }
#menu .card .x:hover { background: none; color: #8a1a12; }
#menu .net { position: absolute; right: 18px; top: 14px; font: 12px ui-monospace, Menlo, monospace; letter-spacing: 0.05em; color: rgba(236,226,214,0.7); text-shadow: 0 1px 3px #000; }
#menu .net.hidden { display: none; }
#menu .wait { position: absolute; left: 0; right: 0; top: 18%; text-align: center; font: italic 18px Georgia, serif; letter-spacing: 0.12em; color: rgba(236,226,214,0.85); text-shadow: 0 2px 6px #000; transition: opacity 0.3s; }
#menu .wait.hidden { opacity: 0; }
#menu .pilot { position: absolute; right: 3vw; bottom: 5vh; display: flex; gap: 10px; transition: opacity 0.4s; }
#menu .pilot.hidden { opacity: 0; }
#menu .pilot .mv { display: flex; flex-direction: column; align-items: center; min-width: 40px; opacity: 0.9; transition: opacity 0.2s, filter 0.2s; }
#menu .pilot .mv img { height: 34px; width: auto; filter: drop-shadow(0 1px 4px rgba(0,0,0,0.9)); }
#menu .pilot .mv span { font: 11px ui-monospace, Menlo, monospace; color: rgba(236,226,214,0.75); text-shadow: 0 1px 2px #000; }
#menu .pilot .mv.off { opacity: 0.22; filter: grayscale(1); }
#menu .pilot .mv.locked { display: none; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

/** Keep a press inside a panel away from the game's key / mouse handlers. */
function swallow(e: HTMLElement): void {
  for (const t of ["mousedown", "mouseup", "keydown", "keyup", "click", "pointerdown"]) e.addEventListener(t, (ev) => ev.stopPropagation());
}

const MODES: { id: TitleMode | "online"; kanji: string; latin: string }[] = [
  { id: "solo", kanji: "忍", latin: "Kunoichi  vs  AI" },
  { id: "general", kanji: "将", latin: "General  vs  AI" },
  { id: "online", kanji: "対", latin: "Online duel" },
];

const PILOT_MOVES = [
  { id: "thrust", kanji: "突", key: "Q" },
  { id: "sweep", kanji: "払", key: "E" },
  { id: "grab", kanji: "掴", key: "R" },
  { id: "leap", kanji: "跳", key: "Space" },
  { id: "flurry", kanji: "乱", key: "X" },
] as const;

export class Menu {
  readonly root: HTMLElement;
  private readonly modes: HTMLElement;
  private readonly optEls = new Map<string, HTMLElement>();
  private readonly card: HTMLElement;
  private readonly lobby: HTMLElement;
  private readonly netEl: HTMLElement;
  private readonly waitEl: HTMLElement;
  private readonly pilotEl: HTMLElement;
  private readonly moveEls = new Map<string, HTMLElement>();
  private role: Role = "shinobi";
  onMode: ((m: TitleMode) => void) | null = null;
  /** Create (code null = quick match) / join a room: the page reloads into it. */
  onOnline: ((room: string | null, as: Role) => void) | null = null;
  onLeave: (() => void) | null = null;

  constructor() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = el("div", "", document.body);
    this.root.id = "menu";

    this.modes = el("div", "modes", this.root);
    MODES.forEach((m, i) => {
      const opt = el("div", "opt", this.modes);
      const l = new Image();
      l.className = "l";
      l.src = brushText(m.latin, { size: 30, font: LATIN_FONT, weight: 600, color: "#ece3d4", seed: 80 + i, dry: 0.3, splatter: 0, letterSpacing: 0.12, pad: 4 }).toDataURL();
      const k = new Image();
      k.className = "k";
      k.src = brushText(m.kanji, { size: 70, color: "#f1ebe0", seed: 85 + i, dry: 0.6, splatter: 0.15, pad: 6 }).toDataURL();
      const u = new Image();
      u.className = "u";
      u.src = brushStroke(260, 18, "#a8231a", 90 + i).toDataURL();
      opt.append(l, k, u);
      opt.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.button !== 0) return;
        if (m.id === "online") this.openOnline();
        else this.onMode?.(m.id);
      });
      this.optEls.set(m.id, opt);
    });

    this.card = el("div", "card hidden", this.root);
    swallow(this.card);
    this.lobby = el("div", "card hidden", this.root);
    swallow(this.lobby);
    this.buildOnline();

    this.netEl = el("div", "net hidden", this.root);
    this.waitEl = el("div", "wait hidden", this.root, "waiting for your opponent…");
    this.pilotEl = el("div", "pilot hidden", this.root);
    PILOT_MOVES.forEach((m, i) => {
      const mv = el("div", "mv", this.pilotEl);
      const k = new Image();
      k.src = brushText(m.kanji, { size: 64, color: "#f1ebe0", seed: 120 + i, dry: 0.5, splatter: 0.1, pad: 4 }).toDataURL();
      mv.appendChild(k);
      el("span", "", mv, m.key);
      this.moveEls.set(m.id, mv);
    });
  }

  /** The title's mode highlight; hidden once the fight starts. */
  setMode(m: TitleMode): void {
    for (const [id, e] of this.optEls) e.classList.toggle("on", id === m);
  }

  showModes(on: boolean): void {
    this.modes.classList.toggle("hidden", !on);
    if (!on) this.card.classList.add("hidden");
  }

  // ------------------------------------------------------------------ online card

  private buildOnline(): void {
    const c = this.card;
    c.innerHTML = "";
    const x = el("button", "x", c, "×");
    x.onclick = () => c.classList.add("hidden");
    el("h2", "", c, "<b>対</b>Online duel");
    el("p", "", c, "One of you is the kunoichi, the other the general. Make a room and send the link, or take the next player waiting.");
    el("div", "small", c, "you play");
    const roles = el("div", "row", c);
    const pickRole = (r: Role) => {
      this.role = r;
      for (const b of roles.children) b.classList.toggle("sel", (b as HTMLElement).dataset.role === r);
    };
    for (const [r, label] of [
      ["shinobi", "忍 Kunoichi"],
      ["general", "将 General"],
    ] as const) {
      const b = el("button", "alt", roles, label);
      b.dataset.role = r;
      b.onclick = () => pickRole(r);
    }
    pickRole("shinobi");
    const row1 = el("div", "row", c);
    const create = el("button", "", row1, "Create room");
    create.onclick = () => this.onOnline?.(randomCode(), this.role);
    const quick = el("button", "alt", row1, "Quick match");
    quick.onclick = () => this.onOnline?.(null, this.role);
    el("div", "small", c, "or join a friend's room");
    const row2 = el("div", "row", c);
    const code = el("input", "", row2);
    code.maxLength = 5;
    code.placeholder = "CODE";
    code.autocomplete = "off";
    const join = el("button", "", row2, "Join");
    const go = () => {
      const v = code.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (v.length >= 4) this.onOnline?.(v, this.role);
      else code.focus();
    };
    join.onclick = go;
    code.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
      if (e.key === "Escape") c.classList.add("hidden");
    });
    el("p", "small", c, "Chrome or Edge on both ends. The duel runs peer to peer, straight between your two browsers; a matchmaking broker only introduces you.");
  }

  private openOnline(): void {
    this.card.classList.remove("hidden");
    (this.card.querySelector("input") as HTMLInputElement | null)?.focus();
  }

  // ------------------------------------------------------------------ lobby

  /** The room screen before the duel starts. */
  showLobby(room: string | null, host: boolean | null, status: string): void {
    const c = this.lobby;
    c.classList.remove("hidden");
    c.innerHTML = "";
    el("h2", "", c, "<b>対</b>" + (room ? "Room" : "Quick match"));
    if (room) {
      el("div", "code", c, room);
      if (host) {
        const url = shareURL(room);
        el("p", "", c, "Send this link to your opponent:");
        const l = el("div", "link", c, url);
        l.title = "click to copy";
        l.style.cursor = "pointer";
        l.onclick = () => void navigator.clipboard?.writeText(url).then(() => this.lobbyStatus("link copied"));
      }
    }
    el("div", "status", c, status).id = "lobby-status";
    const row = el("div", "row", c);
    const leave = el("button", "alt", row, "Leave");
    leave.onclick = () => this.onLeave?.();
  }

  lobbyStatus(s: string): void {
    const e = this.lobby.querySelector("#lobby-status");
    if (e) e.textContent = s;
  }

  hideLobby(): void {
    this.lobby.classList.add("hidden");
  }

  /** A match that can't go on (opponent gone, versions differ): a card with the way back. */
  showError(msg: string): void {
    const c = this.lobby;
    c.classList.remove("hidden");
    c.innerHTML = "";
    el("h2", "", c, "<b>断</b>Duel interrupted");
    el("p", "", c, msg);
    const row = el("div", "row", c);
    const back = el("button", "", row, "Back to the title");
    back.onclick = () => this.onLeave?.();
  }

  // ------------------------------------------------------------------ in the fight

  netLine(text: string | null): void {
    this.netEl.classList.toggle("hidden", !text);
    if (text) this.netEl.textContent = text;
  }

  waiting(on: boolean): void {
    this.waitEl.classList.toggle("hidden", !on);
  }

  /** The general's perilous moves: lit when ready, dim on cooldown, hidden until his second life. */
  pilot(show: boolean, s?: { perilCD: number; leapCD: number; phase: number; dist: number }): void {
    this.pilotEl.classList.toggle("hidden", !show);
    if (!show || !s) return;
    for (const [id, e] of this.moveEls) {
      const p2only = id === "grab" || id === "flurry";
      e.classList.toggle("locked", p2only && s.phase < 2);
      const off = id === "leap" ? s.leapCD > 0 || s.dist < 2.8 : id === "flurry" ? false : s.perilCD > 0;
      e.classList.toggle("off", off);
    }
  }
}

function randomCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(5));
  for (const b of r) s += A[b % A.length];
  return s;
}

export function shareURL(room: string): string {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("room", room);
  return u.toString();
}
