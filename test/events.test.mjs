import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newEvent, newGame, validateGame, moveGame, duplicateGame, removeGame, nextGameAfter, recordWinner,
  prizeIdsFor, exportEvent, importEvent, cleanEvent, loadEvents, saveEvents, ageText, APP_ID, SCHEMA
} from "../shared/events.js";

const words = n => Array.from({ length: n }, (_, i) => "Word " + (i + 1));
const sample = () => {
  const ev = newEvent("WikiTree Days 2026");
  ev.games.push(newGame("Stream 1, game 1", words(30)), newGame("Stream 1, game 2", words(40)), newGame("Stream 2, game 1", words(25)));
  ev.prize = { ids: { "zurcher-160": "2026-10-05", "hartley-99": "current" }, found: 2, warnings: [], at: "2026-10-20T10:00:00.000Z" };
  return ev;
};

test("validateGame: name and 24..200 words", () => {
  assert.deepEqual(validateGame(newGame("OK", words(24))), []);
  assert.match(validateGame(newGame("OK", words(23)))[0], /at least 24/);
  assert.match(validateGame(newGame("OK", words(201)))[0], /At most 200/);
  assert.match(validateGame({ name: " ", words: words(30) })[0], /name/);
});

test("moveGame, duplicateGame, removeGame, nextGameAfter", () => {
  const ev = sample(), [a, b, c] = ev.games.map(g => g.id);
  assert.equal(nextGameAfter(ev, a).id, b);
  assert.equal(nextGameAfter(ev, c), null);
  assert.ok(moveGame(ev, c, -1));
  assert.deepEqual(ev.games.map(g => g.id), [a, c, b]);
  assert.ok(!moveGame(ev, a, -1), "can't move the first game up");
  assert.ok(!moveGame(ev, b, 1), "can't move the last game down");
  const copy = duplicateGame(ev, a);
  assert.equal(ev.games[1].id, copy.id);
  assert.match(copy.name, /\(copy\)$/);
  assert.notEqual(copy.id, a);
  assert.deepEqual(copy.words, ev.games[0].words);
  assert.ok(removeGame(ev, copy.id));
  assert.ok(!removeGame(ev, "nope"));
  assert.equal(ev.games.length, 3);
});

test("recordWinner marks the game played and logs the winner", () => {
  const ev = sample(), g = ev.games[0];
  const row = recordWinner(ev, g.id, { name: "Peasley-221", kind: "id", word: "Census", round: 1 });
  assert.equal(ev.winners.length, 1);
  assert.equal(row.game, "Stream 1, game 1");
  assert.equal(row.round, 1);
  assert.equal(recordWinner(ev, ev.games[1].id, { name: "Hart-9", kind: "id" }).round, 1, "rounds count within each game");
  assert.equal(recordWinner(ev, g.id, { name: "Lee-3", kind: "id" }).round, 2);
  ev.winners.length = 1; g.winner = "Peasley-221";
  assert.equal(g.winner, "Peasley-221");
  assert.ok(g.playedAt);
  const q = recordWinner(ev, "gone", { name: "Sam", kind: "name" });
  assert.equal(q.game, "Quick game");
  assert.equal(q.gameId, null);
});

test("prizeIdsFor: saved page data plus this event's winners as current", () => {
  const ev = sample();
  recordWinner(ev, ev.games[0].id, { name: "Peasley-221", kind: "id" });
  recordWinner(ev, ev.games[0].id, { name: "Cousin Sam", kind: "name" });     // usernames can't be checked
  const ids = prizeIdsFor(ev);
  assert.equal(ids["zurcher-160"], "2026-10-05");
  assert.equal(ids["peasley-221"], "current");
  assert.ok(!("cousin_sam" in ids) && !("cousin sam" in ids));
  assert.equal(ids["hartley-99"], "current");
  assert.deepEqual(prizeIdsFor(newEvent("x")), {}, "an event with no saved page still works");
});

test("export then import round-trips and keeps winners pointing at their games", () => {
  const ev = sample();
  recordWinner(ev, ev.games[1].id, { name: "Peasley-221", kind: "id", word: "Tax roll", round: 2 });
  const r = importEvent(exportEvent(ev), []);
  assert.ok(r.ok, r.error);
  const back = r.event;
  assert.equal(back.name, ev.name);
  assert.deepEqual(back.games.map(g => g.name), ev.games.map(g => g.name));
  assert.deepEqual(back.games[0].words, ev.games[0].words);
  assert.deepEqual(back.prize.ids, ev.prize.ids);
  assert.equal(back.winners.length, 1);
  assert.equal(back.winners[0].gameId, back.games[1].id, "the winner follows the game's new id");
  assert.notEqual(back.id, ev.id);
  assert.notEqual(back.games[0].id, ev.games[0].id);
});

test("import renames on a name clash", () => {
  const ev = sample(), file = exportEvent(ev);
  const one = importEvent(file, [ev]).event;
  assert.equal(one.name, "WikiTree Days 2026 (2)");
  assert.equal(importEvent(file, [ev, one]).event.name, "WikiTree Days 2026 (3)");
});

test("import rejects bad, foreign, too-new and oversized files", () => {
  assert.match(importEvent("", []).error, /empty/);
  assert.match(importEvent("not json", []).error, /valid JSON/);
  assert.match(importEvent(JSON.stringify({ app: "something-else", schema: 1, event: {} }), []).error, /wasn't exported/);
  assert.match(importEvent(JSON.stringify({ app: APP_ID, schema: SCHEMA + 1, event: sample() }), []).error, /newer version/);
  assert.match(importEvent("x".repeat(2_000_001), []).error, /too big/);
});

test("import and storage clean untrusted data", () => {
  const evil = { app: APP_ID, schema: 1, event: {
    name: "<b>Hi</b>\nthere", id: "../../etc",
    games: [{ name: "G<script>", words: [...words(30), 42, null, "  word 1  ", "x".repeat(500)], id: "not ok!" }, "junk", null],
    prize: { ids: { "a-1": "2026-01-02", "b-2": "<script>", "c-3": 5 }, found: "7", warnings: ["w", 3] },
    winners: [{ name: "A-1", kind: "id", round: -4, word: "w" }, { name: "" }, 7],
  } };
  const { ok, event } = importEvent(JSON.stringify(evil), []);
  assert.ok(ok);
  assert.ok(!/[<>\n]/.test(event.name));
  assert.ok(!/[<>]/.test(event.games[0].name));
  assert.equal(event.games.length, 1);
  assert.ok(event.games[0].words.length <= 31, "duplicates and non-strings dropped");
  assert.ok(event.games[0].words.every(w => w.length <= 60));
  assert.deepEqual(event.prize.ids, { "a-1": "2026-01-02" });
  assert.deepEqual(event.prize.warnings, ["w"]);
  assert.equal(event.winners.length, 1);
  assert.equal(event.winners[0].round, 1);
  assert.deepEqual(loadEvents("garbage"), []);
  assert.equal(loadEvents(saveEvents([sample()])).length, 1);
  assert.equal(cleanEvent(null).ok, false);
});

test("ageText", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  assert.equal(ageText("2026-10-30T01:00:00Z", now), "today");
  assert.equal(ageText("2026-10-29T01:00:00Z", now), "yesterday");
  assert.equal(ageText("2026-10-20T10:00:00Z", now), "10 days ago");
  assert.equal(ageText(null, now), "");
});
