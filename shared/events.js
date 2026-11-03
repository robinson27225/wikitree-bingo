// Prepared events for the host. One event is one livestream: it has ONE set of words, which every
// game of that livestream reuses, plus the saved Prize Winners data and the winners so far.
// Everything here is pure so it can be unit-tested; host.html keeps the result in localStorage.
import { MAX_WORDS, MAX_WORD_LEN, MIN_WORDS } from "./bingo.js";
import { idKey } from "./prizes.js";

export const SCHEMA = 2;                                  // 1 = several games per event (v0.4.0 to v0.4.1)
export const MAX_FILE_BYTES = 2_000_000;
export const APP_ID = "wikitree-bingo-event";

export const uid = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export const newEvent = name => ({ id: uid(), name: clip(name, 80) || "New event", created: new Date().toISOString(), label: "", words: [], prize: null, winners: [] });

export function validateWords(words) {
  if (!Array.isArray(words) || words.length < MIN_WORDS) return [`Needs at least ${MIN_WORDS} words (this has ${Array.isArray(words) ? words.length : 0}).`];
  if (words.length > MAX_WORDS) return [`At most ${MAX_WORDS} words.`];
  return [];
}

// A winner was confirmed by the server. The games of one livestream are numbered in the order they
// were won: Game 1, Game 2, ...
export function recordWinner(ev, w) {
  const round = ev.winners.length + 1;
  const row = { id: uid(), round, game: `Game ${round}`, name: w.name, kind: w.kind === "id" ? "id" : "name", word: w.word || "", at: w.at || new Date().toISOString(), copied: false };
  ev.winners.push(row);
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

// Events saved by v0.4.0/0.4.1 had a list of games, each with its own words. One livestream now has one
// set of words, so such an event becomes one event per game (named "Event: Game"), each keeping its
// own words, a copy of the saved Prize Winners data, and the winners of that game.
export function splitLegacy(raw) {
  if (!raw || typeof raw !== "object" || raw.words !== undefined || !Array.isArray(raw.games) || raw.games.length < 2) {
    if (raw && typeof raw === "object" && raw.words === undefined && Array.isArray(raw.games) && raw.games.length === 1 && raw.games[0] && typeof raw.games[0] === "object")
      return [{ ...raw, words: raw.games[0].words, games: undefined }];
    return [raw];
  }
  const games = raw.games.filter(g => g && typeof g === "object");
  return games.map((g, i) => ({
    ...raw,
    id: undefined,
    name: `${clip(raw.name, 60) || "Event"}: ${clip(g.name, 40) || "Game " + (i + 1)}`,
    words: g.words,
    games: undefined,
    winners: (Array.isArray(raw.winners) ? raw.winners : []).filter(w => w && (w.gameId === g.id || (i === 0 && !games.some(x => x.id === w.gameId))))
  }));
}

// Rebuild an event from untrusted data (an imported file, or what was in storage), keeping only
// what is understood. Returns { ok, event } or { ok: false, error }.
export function cleanEvent(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "That isn't an event." };
  const ev = newEvent(raw.name);
  if (typeof raw.id === "string" && /^[a-z0-9]{6,24}$/i.test(raw.id)) ev.id = raw.id;
  if (typeof raw.created === "string") ev.created = raw.created.slice(0, 40);
  ev.label = clip(raw.label, 80);
  ev.words = cleanWords(raw.words);
  ev.prize = cleanPrize(raw.prize);
  for (const w of (Array.isArray(raw.winners) ? raw.winners : []).slice(0, 1000)) {
    if (!w || typeof w !== "object" || !clip(w.name, 40)) continue;
    const round = Math.max(1, +w.round || 1);
    ev.winners.push({ id: typeof w.id === "string" ? w.id.slice(0, 24) : uid(), round, game: clip(w.game, 80) || `Game ${round}`, name: clip(w.name, 40), kind: w.kind === "id" ? "id" : "name", word: clip(w.word, MAX_WORD_LEN), at: typeof w.at === "string" ? w.at.slice(0, 40) : ev.created, copied: !!w.copied });
  }
  return { ok: true, event: ev };
}

// `existing` is the list of events already saved; imported events get fresh ids and unique names.
// Returns { ok, events, event } (event is the first one), or { ok: false, error }.
export function importEvent(text, existing = []) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "That file is empty." };
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: "That file is too big to be a bingo event." };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "That isn't a bingo event file (it isn't valid JSON)." }; }
  if (!data || data.app !== APP_ID) return { ok: false, error: "That file wasn't exported from WikiTree Bingo." };
  if (!(data.schema >= 1 && data.schema <= SCHEMA)) return { ok: false, error: "That file is from a newer version of WikiTree Bingo. Update the pages and try again." };
  if (!data.event || typeof data.event !== "object") return { ok: false, error: "That isn't an event." };
  const names = new Set(existing.map(e => e.name.toLowerCase())), events = [];
  for (const raw of splitLegacy(data.event)) {
    const r = cleanEvent(raw);
    if (!r.ok) return r;
    const ev = r.event; ev.id = uid();
    const base = ev.name;
    for (let n = 2; names.has(ev.name.toLowerCase()); n++) ev.name = `${base} (${n})`;
    names.add(ev.name.toLowerCase()); events.push(ev);
  }
  return { ok: true, events, event: events[0] };
}

// What was in localStorage -> a clean list of events (older multi-game events are split up).
export function loadEvents(text) {
  try {
    const data = JSON.parse(text);
    return (Array.isArray(data) ? data : []).flatMap(splitLegacy).map(cleanEvent).filter(r => r.ok).map(r => r.event);
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
