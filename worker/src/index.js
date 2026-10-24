// WikiTree Bingo realtime server: a Worker that creates rooms and a Durable Object
// (one per game code) that relays draws, deals cards and verifies BINGO claims.
import {
  CARD_WORDS, FREE, MAX_WORDS, MAX_WORD_LEN, MIN_WORDS,
  checkClaim, cleanName, isWikiTreeId, makeCard, cardSignature, normWord, randInt
} from "../../shared/bingo.js";
import { parsePrizeWinners, looksLikeHtml, idKey } from "../../shared/prizes.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no I, L, O, 0, 1
const MAX_PLAYERS = 500;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_COOLDOWN_MS = 2000;
const PRIZE_TTL_MS = 10 * 60 * 1000;
const PRIZE_PAGE = "https://www.wikitree.com/index.php?title=Space:Prize_Winners&action=raw";
const PRIZE_PAGE_HTML = "https://www.wikitree.com/wiki/Space:Prize_Winners";

// ---- who won a prize in the last 6 months (read from WikiTree's Space:Prize_Winners page) ----
let prizeMemo = null;                                        // { at, data }
async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "WikiTreeBingo/0.2 (+https://www.wikitree.com/wiki/Robinson-27225)" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`WikiTree answered ${res.status}`);
  return res.text();
}
// Returns { ok, ids, warnings, found, fetchedAt, source } or { ok: false, error }. Never throws.
async function getPrizeList(env, force = false) {
  if (!force && prizeMemo && Date.now() - prizeMemo.at < PRIZE_TTL_MS) return prizeMemo.data;
  const urls = env.PRIZE_PAGE_URL ? [env.PRIZE_PAGE_URL] : [PRIZE_PAGE, PRIZE_PAGE_HTML];
  let lastError = "no data";
  const tried = [];                                          // what each address returned, to make a failure diagnosable
  for (const url of urls) {
    try {
      const text = await fetchPage(url);
      const r = parsePrizeWinners(text, new Date());
      tried.push({ url, bytes: text.length, kind: looksLikeHtml(text) ? "html" : "wikitext", sections: r.sections, found: r.found, start: text.replace(/\s+/g, " ").slice(0, 200) });
      if (!r.found) { lastError = "the page had no winners table I could read"; continue; }
      const data = { ok: true, ids: r.ids, warnings: r.warnings, found: r.found, fetchedAt: new Date().toISOString(), source: url };
      prizeMemo = { at: Date.now(), data };
      return data;
    } catch (e) { lastError = String(e.message || e); tried.push({ url, error: lastError }); }
  }
  if (prizeMemo && prizeMemo.data.ok) return { ...prizeMemo.data, stale: true };   // better an old list than none
  return { ok: false, error: lastError, tried, fetchedAt: new Date().toISOString() };
}

const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
  .map(b => b.toString(16).padStart(2, "0")).join("");
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
const newCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randInt(CODE_ALPHABET.length)]).join("");

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;                                   // non-browser clients (tests, curl)
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean).includes(origin);
}
const cors = request => ({
  "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
});
const json = (request, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(request) } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request) });
    if (!originAllowed(request, env)) return new Response("Origin not allowed", { status: 403 });

    if (url.pathname === "/api/ineligible" && request.method === "GET") {
      const p = await getPrizeList(env, url.searchParams.has("fresh"));
      return json(request, p.ok ? { ...p, count: Object.keys(p.ids).length } : p, p.ok ? 200 : 502);
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch (e) { /* empty body is fine */ }
      const words = sanitizeWords(body.words);
      if (words.length < MIN_WORDS) return json(request, { error: `Need at least ${MIN_WORDS} words` }, 400);
      const hostKey = randomHex(16), hostHash = await sha256(hostKey);
      const prize = await getPrizeList(env);
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ code, hostHash, words, prize }) });
        if (res.status === 200) return json(request, { code, hostKey });
      }
      return json(request, { error: "Could not allocate a game code, try again" }, 503);
    }

    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]{4})$/);
    if (m && request.headers.get("Upgrade") === "websocket") {
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
      return stub.fetch(request);
    }
    return new Response("WikiTree Bingo server", { status: 200 });
  }
};

function sanitizeWords(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set(), out = [];
  for (const w of input) {
    if (typeof w !== "string") continue;
    const t = w.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_WORD_LEN).trim();
    const k = normWord(t);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

export class BingoRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    this.lastClaim = new Map();
    state.blockConcurrencyWhile(async () => { this.room = (await state.storage.get("room")) || null; });
  }

  async save() {
    await this.state.storage.put("room", this.room);
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async alarm() {
    for (const ws of this.state.getWebSockets()) { try { ws.close(1001, "Game expired"); } catch (e) {} }
    await this.state.storage.deleteAll();
    this.room = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init") {
      if (this.room) return new Response("exists", { status: 409 });
      const { code, hostHash, words, prize } = await request.json();
      this.room = { code, hostHash, words, status: "lobby", called: [], pending: null, players: {}, winner: null, gameNo: 1, prize: prize || null, sessionWinners: {} };
      await this.save();
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    if (!this.room) return new Response("No such game", { status: 404 });
    const role = url.searchParams.get("role") === "host" ? "host" : "player";
    if (role === "host" && (await sha256(url.searchParams.get("key") || "")) !== this.room.hostHash)
      return new Response("Bad host key", { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ role, pid: null });
    if (role === "host") this.send(server, this.hostState());
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- helpers ----
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) {} }
  sockets(role) { return this.state.getWebSockets().filter(ws => (ws.deserializeAttachment() || {}).role === role); }
  toHosts(msg) { for (const ws of this.sockets("host")) this.send(ws, msg); }
  toPlayers(msg) { for (const ws of this.sockets("player")) this.send(ws, msg); }
  toAll(msg) { this.toHosts(msg); this.toPlayers(msg); }

  playerCount(excludeWs = null) {
    const pids = new Set();
    for (const ws of this.sockets("player")) {
      if (ws === excludeWs) continue;
      const a = ws.deserializeAttachment();
      if (a && a.pid) pids.add(a.pid);
    }
    return pids.size;
  }
  broadcastCount(excludeWs = null) { this.toAll({ t: "players", n: this.playerCount(excludeWs) }); }

  hostState() {
    const r = this.room;
    return {
      t: "hostState", code: r.code, status: r.status, words: r.words, called: r.called, pending: r.pending,
      players: this.playerCount(), winner: r.winner, gameNo: r.gameNo, prize: this.prizeSummary()
    };
  }

  // ---- prize eligibility ----
  prizeSummary() {
    const p = this.room.prize;
    if (!p) return { ok: false, error: "not checked yet" };
    return { ok: !!p.ok, count: p.ok ? Object.keys(p.ids).length : 0, warnings: (p.warnings || []).slice(0, 5), fetchedAt: p.fetchedAt, stale: !!p.stale, error: p.error };
  }
  // Why this player may not win right now, or null. Username players are never checked.
  barred(p) {
    if (p.kind !== "id") return null;
    const key = idKey(p.name), r = this.room;
    if (r.sessionWinners && r.sessionWinners[key]) return { reason: "session", date: r.sessionWinners[key] };
    const d = r.prize && r.prize.ok && r.prize.ids[key];
    return d ? { reason: "recent", date: d } : null;
  }
  async refreshPrize(force = false) {
    this.room.prize = await getPrizeList(this.env, force);
    await this.save();
    this.toHosts({ t: "prize", prize: this.prizeSummary() });
    for (const pws of this.sockets("player")) {
      const a = pws.deserializeAttachment(), p = a && a.pid && this.room.players[a.pid];
      if (p) this.send(pws, { t: "eligibility", barred: this.barred(p) });
    }
  }
  playerState(pid) {
    const r = this.room, p = r.players[pid];
    return {
      t: "welcome", pid, name: p.name, kind: p.kind, card: p.card, daubed: p.daubed, status: r.status, barred: this.barred(p),
      called: r.called, winner: r.winner, gameNo: r.gameNo
    };
  }
  existingSignatures() { return new Set(Object.values(this.room.players).map(p => cardSignature(p.card))); }
  dealCards() {
    const sigs = new Set();
    for (const p of Object.values(this.room.players)) {
      p.card = makeCard(this.room.words, sigs);
      sigs.add(cardSignature(p.card));
      p.daubed = [];
    }
  }

  // ---- websocket handlers ----
  async webSocketMessage(ws, raw) {
    if (!this.room) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const att = ws.deserializeAttachment() || {};
    if (att.role === "host") await this.onHost(ws, msg);
    else await this.onPlayer(ws, msg, att);
  }

  async webSocketClose(ws) { this.broadcastCount(ws); }
  async webSocketError(ws) { this.broadcastCount(ws); }

  async onHost(ws, msg) {
    const r = this.room;
    switch (msg.t) {
      case "setWords": {
        if (r.status === "playing") return this.send(ws, { t: "error", reason: "A game is in progress" });
        const words = sanitizeWords(msg.words);
        if (words.length < MIN_WORDS) return this.send(ws, { t: "error", reason: `Need at least ${MIN_WORDS} words` });
        r.words = words;
        r.called = []; r.pending = null; r.winner = null; r.status = "lobby";
        this.dealCards();
        await this.save();
        this.toHosts(this.hostState());
        for (const pws of this.sockets("player")) {
          const a = pws.deserializeAttachment();
          if (a && a.pid && r.players[a.pid]) this.send(pws, this.playerState(a.pid));
        }
        break;
      }
      case "recheck": await this.refreshPrize(true); break;
      case "start":
        if (r.status !== "lobby") return;
        await this.refreshPrize();
        r.status = "playing"; r.called = []; r.pending = null; r.winner = null;
        await this.save();
        this.toAll({ t: "started", gameNo: r.gameNo });
        this.toHosts(this.hostState());
        break;
      case "draw": {
        if (r.status !== "playing") return;
        if (!r.pending) {
          const calledSet = new Set(r.called.map(normWord));
          const left = r.words.filter(w => !calledSet.has(normWord(w)));
          if (!left.length) return this.send(ws, { t: "exhausted" });
          r.pending = left[randInt(left.length)];
          await this.save();
        }
        this.send(ws, { t: "drawn", word: r.pending, n: r.called.length + 1, remaining: r.words.length - r.called.length - 1 });
        break;
      }
      case "reveal":
        if (r.status !== "playing" || !r.pending) return;
        r.called.push(r.pending);
        r.pending = null;
        await this.save();
        this.toAll({ t: "called", word: r.called[r.called.length - 1], n: r.called.length });
        break;
      case "newGame":
        r.status = "lobby"; r.called = []; r.pending = null; r.winner = null; r.gameNo++;
        this.dealCards();
        await this.save();
        await this.refreshPrize();
        this.toHosts(this.hostState());
        for (const pws of this.sockets("player")) {
          const a = pws.deserializeAttachment();
          if (a && a.pid && r.players[a.pid]) this.send(pws, this.playerState(a.pid));
        }
        break;
    }
  }

  async onPlayer(ws, msg, att) {
    const r = this.room;
    if (msg.t === "join") {
      const pid = typeof msg.pid === "string" && /^[A-Za-z0-9-]{8,64}$/.test(msg.pid) ? msg.pid : null;
      const kind = msg.kind === "id" ? "id" : "name";
      const name = cleanName(msg.name || "");
      if (!pid || !name) return this.send(ws, { t: "error", reason: "Please enter a name" });
      if (kind === "id" && !isWikiTreeId(name)) return this.send(ws, { t: "error", reason: "That doesn't look like a WikiTree ID (for example Robinson-27225)" });
      const clash = Object.entries(r.players).find(([id, p]) => id !== pid && p.name.toLowerCase() === name.toLowerCase());
      if (clash) return this.send(ws, { t: "error", reason: "Someone with that name is already playing" });
      if (!r.players[pid]) {
        if (Object.keys(r.players).length >= MAX_PLAYERS) return this.send(ws, { t: "error", reason: "This game is full" });
        r.players[pid] = { name, kind, card: makeCard(r.words, this.existingSignatures()), daubed: [] };
      } else { r.players[pid].name = name; r.players[pid].kind = kind; }
      ws.serializeAttachment({ role: "player", pid });
      await this.save();
      this.send(ws, this.playerState(pid));
      this.broadcastCount();
      return;
    }

    const pid = att.pid, p = pid && r.players[pid];
    if (!p) return;
    const clean = arr => [...new Set((Array.isArray(arr) ? arr : []).filter(i => Number.isInteger(i) && i >= 0 && i < 25 && i !== FREE))];

    if (msg.t === "daub") {
      p.daubed = clean(msg.daubed);
      await this.save();
    } else if (msg.t === "claim") {
      const now = Date.now();
      if (now - (this.lastClaim.get(pid) || 0) < CLAIM_COOLDOWN_MS) return this.send(ws, { t: "claimResult", ok: false, reason: "wait" });
      this.lastClaim.set(pid, now);
      if (r.status !== "playing") return this.send(ws, { t: "claimResult", ok: false, reason: "over" });
      p.daubed = clean(msg.daubed);
      const line = checkClaim(p.card, new Set(r.called.map(normWord)), p.daubed);
      if (!line) { await this.save(); return this.send(ws, { t: "claimResult", ok: false, reason: "notyet" }); }
      const bar = this.barred(p);
      if (bar) {                                              // a real line, but they may not win: the game carries on
        this.send(ws, { t: "claimResult", ok: false, reason: "ineligible", barred: bar });
        this.toHosts({ t: "ineligibleClaim", name: p.name, barred: bar });
        return;
      }
      r.status = "won";
      if (p.kind === "id") { r.sessionWinners = r.sessionWinners || {}; r.sessionWinners[idKey(p.name)] = new Date().toISOString().slice(0, 10); }
      r.winner = { pid, name: p.name, kind: p.kind, line, word: r.called[r.called.length - 1] || "" };
      await this.save();
      this.toAll({ t: "winner", winner: { name: p.name, kind: p.kind, line, word: r.winner.word, pid } });
    }
  }
}
