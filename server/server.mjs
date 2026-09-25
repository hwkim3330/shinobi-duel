// Shinobi Duel online: lobby + WebRTC signaling + fallback relay, and the built game itself.
//
//   node server/server.mjs            (PORT=7860, DIST=../dist)
//
// Two players meet in a room (a code one of them made up, or a quick-match pairing). The server
// tells each one whether it is the host and when the other has arrived, passes the WebRTC offer /
// answer / ICE between them, and after that only relays game traffic for pairs whose networks
// can't open a direct DataChannel. It never looks inside the game packets: the duel runs in the
// two browsers (deterministic lockstep), so there is nothing to simulate here.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = fileURLToPath(new URL(".", import.meta.url));
const PORT = +(process.env.PORT ?? 7860);
const DIST = resolve(process.env.DIST ?? join(here, "..", "dist"));
const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const MAX_ROOMS = 2000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".hdr": "application/octet-stream",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** room code -> { peers: [ws, ws?], quick: bool, born } */
const rooms = new Map();
let quickWaiting = null; // a ws waiting for a quick match
const stats = { matches: 0, relayed: 0 };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, waiting: !!quickWaiting, ...stats }));
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  // Hashed build assets never change; the page itself always revalidates.
  const cache = path.includes("/assets/") && /-[\w-]{8,}\.\w+$/.test(path) ? "public, max-age=31536000, immutable" : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cache, "content-length": statSync(file).size });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 256 * 1024 });

function send(ws, m) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

function other(ws) {
  const r = ws.room && rooms.get(ws.room);
  if (!r) return null;
  return r.peers.find((p) => p !== ws) ?? null;
}

function pair(room) {
  const r = rooms.get(room);
  if (!r || r.peers.length !== 2) return;
  stats.matches++;
  for (const p of r.peers) send(p, { t: "peer" });
}

function seat(ws, room, quick) {
  let r = rooms.get(room);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: "error", m: "the lobby is full, try again in a minute" });
    r = { peers: [], quick, born: Date.now() };
    rooms.set(room, r);
  }
  if (r.peers.length >= 2) return send(ws, { t: "error", m: "that room already has two players" });
  if (r.peers.length === 1 && r.peers[0].v !== ws.v) return send(ws, { t: "error", m: "your opponent is on a different version of the game; both reload the page" });
  ws.room = room;
  r.peers.push(ws);
  send(ws, { t: "joined", room, host: r.peers.length === 1 });
  pair(room);
}

function quickCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let s = "Q";
    for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(s)) return s;
  }
}

wss.on("connection", (ws) => {
  ws.alive = true;
  ws.on("pong", () => (ws.alive = true));
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // Game traffic for a pair with no direct link: pass it through untouched.
      const o = other(ws);
      if (o && o.readyState === 1) {
        o.send(data, { binary: true });
        stats.relayed++;
      }
      return;
    }
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (m.t === "join" && !ws.room) {
      const room = String(m.room ?? "").toUpperCase();
      ws.v = String(m.v ?? "");
      if (!ROOM_RE.test(room)) return send(ws, { t: "error", m: "that room code isn't valid" });
      seat(ws, room, false);
    } else if (m.t === "quick" && !ws.room) {
      ws.v = String(m.v ?? "");
      const w = quickWaiting;
      if (w && w !== ws && w.readyState === 1 && w.v === ws.v && w.room) {
        quickWaiting = null;
        seat(ws, w.room, true);
      } else {
        quickWaiting = ws;
        seat(ws, quickCode(), true);
      }
    } else if (m.t === "signal" || m.t === "rel") {
      send(other(ws), m);
    }
  });
  ws.on("close", () => {
    if (quickWaiting === ws) quickWaiting = null;
    const r = ws.room && rooms.get(ws.room);
    if (!r) return;
    r.peers = r.peers.filter((p) => p !== ws);
    for (const p of r.peers) send(p, { t: "left" });
    if (!r.peers.length) rooms.delete(ws.room);
  });
});

// Drop dead sockets (a closed laptop lid never sends a close frame) and stale half-empty rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
  const old = Date.now() - 6 * 3600e3;
  for (const [code, r] of rooms) if (r.born < old) rooms.delete(code);
}, 20000);

server.listen(PORT, () => console.log(`shinobi-duel server on :${PORT}, serving ${DIST}${existsSync(DIST) ? "" : " (missing: lobby only)"}`));
