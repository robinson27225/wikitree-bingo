// Prepared events for the host: an event holds several games (a name and a word list each), the
// saved Prize Winners data and the winners so far. Everything here is pure so it can be
// unit-tested; host.html keeps the result in localStorage.
import { MAX_WORDS, MAX_WORD_LEN, MIN_WORDS } from "./bingo.js";
import { idKey } from "./prizes.js";

export const SCHEMA = 1;
export const MAX_GAMES = 50;
export const MAX_FILE_BYTES = 2_000_000;
export const APP_ID = "wikitree-bingo-event";

export const uid = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export const newEvent = name => ({ id: uid(), name: clip(name, 80) || "New event", created: new Date().toISOString(), label: "", games: [], prize: null, winners: [] });
export const newGame = (name, words) => ({ id: uid(), name: clip(name, 80) || "Game", words: words.slice(), playedAt: null, winner: null });

export function validateGame(g) {
  const errors = [];
  if (!g || typeof g !== "object") return ["That game is missing."];
  if (!clip(g.name, 80)) errors.push("Give the game a name.");
  if (!Array.isArray(g.words) || g.words.length < MIN_WORDS) errors.push(`Needs at least ${MIN_WORDS} words (this has ${Array.isArray(g.words) ? g.words.length : 0}).`);
  else if (g.words.length > MAX_WORDS) errors.push(`At most ${MAX_WORDS} words.`);
  return errors;
}

const indexOfGame = (ev, id) => ev.games.findIndex(g => g.id === id);
export function moveGame(ev, id, delta) {
  const i = indexOfGame(ev, id), j = i + delta;
  if (i < 0 || j < 0 || j >= ev.games.length) return false;
  [ev.games[i], ev.games[j]] = [ev.games[j], ev.games[i]];
  return true;
}
export function duplicateGame(ev, id) {
  const i = indexOfGame(ev, id);
  if (i < 0 || ev.games.length >= MAX_GAMES) return null;
  const copy = newGame(ev.games[i].name + " (copy)", ev.games[i].words);
  ev.games.splice(i + 1, 0, copy);
  return copy;
}
export function removeGame(ev, id) {
  const i = indexOfGame(ev, id);
  if (i < 0) return false;
  ev.games.splice(i, 1);
  return true;
}
export const nextGameAfter = (ev, id) => { const i = indexOfGame(ev, id); return i >= 0 ? ev.games[i + 1] || null : null; };

// A winner was confirmed by the server while this prepared game was live.
export function recordWinner(ev, gameId, w) {
  const g = ev.games.find(x => x.id === gameId);
  const round = ev.winners.filter(x => x.gameId === (g ? g.id : null)).length + 1;       // wins within this game
  const row = { id: uid(), gameId: g ? g.id : null, game: g ? g.name : "Quick game", round, name: w.name, kind: w.kind === "id" ? "id" : "name", word: w.word || "", at: w.at || new Date().toISOString(), copied: false };
  ev.winners.push(row);
  if (g) { g.playedAt = row.at; g.winner = row.name; }
  return row;
}

// The Prize Winners data to give a room that is about to go live: the saved page data, plus everyone
// who has already won in this event (they count as current-event winners, so they can't win again).
export function prizeIdsFor(ev) {
  const ids = Object.assign({}, ev.prize ? ev.prize.ids : {});
  for (const w of ev.winners) if (w.kind === "id") ids[idKey(w.name)] = "current";
  return ids;
}

// ---- export / import ----
export const exportEvent = ev => JSON.stringify({ app: APP_ID, schema: SCHEMA, exportedAt: new Date().toISOString(), event: ev }, null, 1);

const cleanWords = words => {
  const seen = new Set(), out = [];
  for (const w of Array.isArray(words) ? words : []) {
    if (typeof w !== "string") continue;
    const t = clip(w, MAX_WORD_LEN), k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
};

function cleanPrize(p) {
  if (!p || typeof p !== "object" || !p.ids || typeof p.ids !== "object") return null;
  const ids = {};
  for (const [k, v] of Object.entries(p.ids).slice(0, 5000)) if (typeof v === "string" && (v === "current" || /^\d{4}-\d{2}-\d{2}$/.test(v))) ids[String(k).toLowerCase().slice(0, 80)] = v;
  return { ids, found: Math.max(0, +p.found || Object.keys(ids).length), warnings: (Array.isArray(p.warnings) ? p.warnings : []).filter(w => typeof w === "string").slice(0, 5).map(w => w.slice(0, 200)), at: typeof p.at === "string" ? p.at.slice(0, 40) : null };
}

// Rebuild an event from untrusted data (an imported file, or what was in storage), keeping only
// what is understood. Returns { ok, event } or { ok: false, error }.
export function cleanEvent(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "That isn't an event." };
  const ev = newEvent(raw.name);
  if (typeof raw.id === "string" && /^[a-z0-9]{6,24}$/i.test(raw.id)) ev.id = raw.id;
  if (typeof raw.created === "string") ev.created = raw.created.slice(0, 40);
  ev.label = clip(raw.label, 80);
  for (const g of (Array.isArray(raw.games) ? raw.games : []).slice(0, MAX_GAMES)) {
    if (!g || typeof g !== "object") continue;
    const game = newGame(g.name, cleanWords(g.words));
    if (typeof g.id === "string" && /^[a-z0-9]{6,24}$/i.test(g.id)) game.id = g.id;
    if (typeof g.playedAt === "string") { game.playedAt = g.playedAt.slice(0, 40); game.winner = clip(g.winner, 60) || null; }
    ev.games.push(game);
  }
  ev.prize = cleanPrize(raw.prize);
  for (const w of (Array.isArray(raw.winners) ? raw.winners : []).slice(0, 1000)) {
    if (!w || typeof w !== "object" || !clip(w.name, 40)) continue;
    ev.winners.push({ id: typeof w.id === "string" ? w.id.slice(0, 24) : uid(), gameId: typeof w.gameId === "string" ? w.gameId.slice(0, 24) : null, game: clip(w.game, 80) || "Game", round: Math.max(1, +w.round || 1), name: clip(w.name, 40), kind: w.kind === "id" ? "id" : "name", word: clip(w.word, MAX_WORD_LEN), at: typeof w.at === "string" ? w.at.slice(0, 40) : ev.created, copied: !!w.copied });
  }
  return { ok: true, event: ev };
}

// `existing` is the list of events already saved; an imported event gets a fresh id and a unique name.
export function importEvent(text, existing = []) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "That file is empty." };
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: "That file is too big to be a bingo event." };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "That isn't a bingo event file (it isn't valid JSON)." }; }
  if (!data || data.app !== APP_ID) return { ok: false, error: "That file wasn't exported from WikiTree Bingo." };
  if (!(data.schema >= 1 && data.schema <= SCHEMA)) return { ok: false, error: "That file is from a newer version of WikiTree Bingo. Update the pages and try again." };
  const r = cleanEvent(data.event);
  if (!r.ok) return r;
  const ev = r.event, oldIds = ev.games.map(g => g.id);
  ev.id = uid();
  ev.games.forEach(g => { g.id = uid(); });
  const idMap = new Map(oldIds.map((o, i) => [o, ev.games[i].id]));     // winners keep pointing at the right game
  for (const w of ev.winners) w.gameId = idMap.get(w.gameId) || null;
  const names = new Set(existing.map(e => e.name.toLowerCase())), base = ev.name;
  for (let n = 2; names.has(ev.name.toLowerCase()); n++) ev.name = `${base} (${n})`;
  return { ok: true, event: ev };
}

// What was in localStorage -> a clean list of events.
export function loadEvents(text) {
  try {
    const data = JSON.parse(text);
    return (Array.isArray(data) ? data : []).map(cleanEvent).filter(r => r.ok).map(r => r.event);
  } catch (e) { return []; }
}
export const saveEvents = events => JSON.stringify(events);

// "pasted 4 days ago" for the saved Prize Winners data.
export function ageText(iso, now = new Date()) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const days = Math.floor((now.getTime() - t) / 864e5);
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}
