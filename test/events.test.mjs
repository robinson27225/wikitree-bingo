import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newEvent, validateWords, recordWinner, prizeIdsFor, exportEvent, importEvent, cleanEvent, splitLegacy,
  loadEvents, saveEvents, ageText, APP_ID, SCHEMA
} from "../shared/events.js";

const words = n => Array.from({ length: n }, (_, i) => "Word " + (i + 1));
const sample = () => {
  const ev = newEvent("WikiTree Days 2026, stream 1");
  ev.words = words(40);
  ev.prize = { ids: { "zurcher-160": "2026-10-05", "hartley-99": "current" }, found: 2, warnings: [], at: "2026-10-20T10:00:00.000Z" };
  return ev;
};

test("an event has one word list", () => {
  const ev = newEvent("  Stream   1 ");
  assert.equal(ev.name, "Stream 1");
  assert.deepEqual(ev.words, []);
  assert.ok(!("games" in ev));
});

test("validateWords: 24 to 200", () => {
  assert.deepEqual(validateWords(words(24)), []);
  assert.deepEqual(validateWords(words(200)), []);
  assert.match(validateWords(words(23))[0], /at least 24/);
  assert.match(validateWords(words(201))[0], /At most 200/);
  assert.match(validateWords(null)[0], /at least 24/);
});

test("recordWinner numbers the games in the order they were won", () => {
  const ev = sample();
  const a = recordWinner(ev, { name: "Peasley-221", kind: "id", word: "Census" });
  const b = recordWinner(ev, { name: "Cousin Sam", kind: "name", word: "Obituary" });
  assert.deepEqual([a.round, a.game, b.round, b.game], [1, "Game 1", 2, "Game 2"]);
  assert.equal(ev.winners.length, 2);
  assert.equal(a.copied, false);
  assert.equal(b.kind, "name");
});

test("prizeIdsFor: saved page data plus this event's winners as current", () => {
  const ev = sample();
  recordWinner(ev, { name: "Peasley-221", kind: "id" });
  recordWinner(ev, { name: "Cousin Sam", kind: "name" });                     // usernames can't be checked
  const ids = prizeIdsFor(ev);
  assert.equal(ids["zurcher-160"], "2026-10-05");
  assert.equal(ids["peasley-221"], "current");
  assert.equal(ids["hartley-99"], "current");
  assert.ok(!Object.keys(ids).some(k => k.includes("sam")));
  assert.deepEqual(prizeIdsFor(newEvent("x")), {}, "an event with no saved page still works");
});

test("export then import round-trips", () => {
  const ev = sample();
  recordWinner(ev, { name: "Peasley-221", kind: "id", word: "Tax roll" });
  const r = importEvent(exportEvent(ev), []);
  assert.ok(r.ok, r.error);
  assert.equal(r.events.length, 1);
  const back = r.event;
  assert.equal(back.name, ev.name);
  assert.deepEqual(back.words, ev.words);
  assert.deepEqual(back.prize.ids, ev.prize.ids);
  assert.equal(back.winners.length, 1);
  assert.equal(back.winners[0].game, "Game 1");
  assert.notEqual(back.id, ev.id);
});

test("import renames on a name clash", () => {
  const ev = sample(), file = exportEvent(ev);
  const one = importEvent(file, [ev]).event;
  assert.equal(one.name, "WikiTree Days 2026, stream 1 (2)");
  assert.equal(importEvent(file, [ev, one]).event.name, "WikiTree Days 2026, stream 1 (3)");
});

test("import rejects bad, foreign, too-new and oversized files", () => {
  assert.match(importEvent("", []).error, /empty/);
  assert.match(importEvent("not json", []).error, /valid JSON/);
  assert.match(importEvent(JSON.stringify({ app: "something-else", schema: 1, event: {} }), []).error, /wasn't exported/);
  assert.match(importEvent(JSON.stringify({ app: APP_ID, schema: SCHEMA + 1, event: sample() }), []).error, /newer version/);
  assert.match(importEvent(JSON.stringify({ app: APP_ID, schema: 2 }), []).error, /isn't an event/);
  assert.match(importEvent("x".repeat(2_000_001), []).error, /too big/);
});

test("import and storage clean untrusted data", () => {
  const evil = { app: APP_ID, schema: 2, event: {
    name: "<b>Hi</b>\nthere", id: "../../etc",
    words: [...words(30), 42, null, "  word 1  ", "x".repeat(500)],
    prize: { ids: { "a-1": "2026-01-02", "b-2": "<script>", "c-3": 5 }, found: "7", warnings: ["w", 3] },
    winners: [{ name: "A-1", kind: "id", round: -4, word: "w" }, { name: "" }, 7],
  } };
  const { ok, event } = importEvent(JSON.stringify(evil), []);
  assert.ok(ok);
  assert.ok(!/[<>\n]/.test(event.name));
  assert.ok(event.words.length <= 31, "duplicates and non-strings dropped");
  assert.ok(event.words.every(w => w.length <= 60));
  assert.deepEqual(event.prize.ids, { "a-1": "2026-01-02" });
  assert.deepEqual(event.prize.warnings, ["w"]);
  assert.equal(event.winners.length, 1);
  assert.equal(event.winners[0].round, 1);
  assert.deepEqual(loadEvents("garbage"), []);
  assert.equal(loadEvents(saveEvents([sample()])).length, 1);
  assert.equal(cleanEvent(null).ok, false);
});

// ---- events saved by v0.4.0 / v0.4.1 had several games, each with its own words ----
const legacy = () => ({
  name: "WikiTree Days", id: "abc123def", created: "2026-10-01T00:00:00Z",
  games: [
    { id: "g1aaaa", name: "Stream 1, game 1", words: words(30), playedAt: "x", winner: "Peasley-221" },
    { id: "g2bbbb", name: "Stream 1, game 2", words: words(40) },
    { id: "g3cccc", name: "Stream 2, game 1", words: words(25) },
  ],
  prize: { ids: { "zurcher-160": "2026-10-05" }, found: 1, warnings: [], at: "2026-10-20T10:00:00.000Z" },
  winners: [
    { id: "w1", gameId: "g1aaaa", game: "Stream 1, game 1", round: 1, name: "Peasley-221", kind: "id", word: "Census", at: "2026-10-02T00:00:00Z" },
    { id: "w2", gameId: "g3cccc", game: "Stream 2, game 1", round: 1, name: "Cousin Sam", kind: "name", word: "Tax roll", at: "2026-10-03T00:00:00Z" },
  ],
});

test("an older multi-game event becomes one event per game, keeping words, prize data and winners", () => {
  const parts = splitLegacy(legacy());
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(p => p.name), ["WikiTree Days: Stream 1, game 1", "WikiTree Days: Stream 1, game 2", "WikiTree Days: Stream 2, game 1"]);
  const evs = parts.map(p => cleanEvent(p).event);
  assert.deepEqual(evs.map(e => e.words.length), [30, 40, 25]);
  assert.ok(evs.every(e => e.prize && e.prize.ids["zurcher-160"]), "each keeps the saved Prize Winners data");
  assert.deepEqual(evs.map(e => e.winners.map(w => w.name)), [["Peasley-221"], [], ["Cousin Sam"]]);
  assert.equal(new Set(evs.map(e => e.id)).size, 3, "fresh ids");
});

test("an older single-game event keeps its name and takes the game's words", () => {
  const one = { ...legacy(), games: [legacy().games[0]], winners: [legacy().winners[0]] };
  const [only] = splitLegacy(one);
  const ev = cleanEvent(only).event;
  assert.equal(ev.name, "WikiTree Days");
  assert.equal(ev.words.length, 30);
  assert.equal(ev.winners.length, 1);
});

test("loadEvents and importEvent migrate the older format", () => {
  const stored = loadEvents(JSON.stringify([legacy(), sample()]));
  assert.equal(stored.length, 4, "three from the old event plus the new one");
  const r = importEvent(JSON.stringify({ app: APP_ID, schema: 1, event: legacy() }), [stored[0]]);
  assert.ok(r.ok, r.error);
  assert.equal(r.events.length, 3);
  assert.equal(r.events[0].name, "WikiTree Days: Stream 1, game 1 (2)", "unique against what is already saved");
  assert.equal(new Set(r.events.map(e => e.name)).size, 3);
});

test("ageText", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  assert.equal(ageText("2026-10-30T01:00:00Z", now), "today");
  assert.equal(ageText("2026-10-29T01:00:00Z", now), "yesterday");
  assert.equal(ageText("2026-10-20T10:00:00Z", now), "10 days ago");
  assert.equal(ageText(null, now), "");
});
