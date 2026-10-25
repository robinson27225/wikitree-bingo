import { test } from "node:test";
import assert from "node:assert/strict";
import { winnerRow, rowsMarkup, tableMarkup, defaultEventName, idKey, parsePeople } from "../shared/results.js";

const names = { "peasley-221": { first: "Frances", last: "Robinson" } };
const winners = [
  { round: 1, name: "Peasley-221", kind: "id", word: "Census" },
  { round: 2, name: "Cousin Sam", kind: "name", word: "Obituary" },
  { round: 3, name: "Unknown-9", kind: "id", word: "Tax roll" },
];

test("an ID winner gets first and last name from the lookup", () => {
  assert.equal(winnerRow(winners[0], names, "WikiTree Bingo October 2026"), "|-\n|Peasley-221||Frances||Robinson||WikiTree Bingo October 2026");
});

test("a username winner has a blank ID cell and the username in First", () => {
  assert.equal(winnerRow(winners[1], names, "Ev"), "|-\n| ||Cousin Sam||||Ev");
});

test("an ID with no name found still gets a row, with blank names to fill in", () => {
  assert.equal(winnerRow(winners[2], names, "Ev"), "|-\n|Unknown-9||||||Ev");
});

test("cells can't contain pipes or line breaks", () => {
  const row = winnerRow({ name: "A|B\nC", kind: "name" }, {}, "x || y");
  assert.equal(row, "|-\n| ||A B C||||x y");
});

test("rows and the whole table use the Marathon Drawing layout", () => {
  assert.equal(rowsMarkup(winners.slice(0, 2), names, "Ev").split("\n").length, 4);
  const t = tableMarkup(winners.slice(0, 1), names, "Ev");
  assert.ok(t.startsWith('=== Current Event Winners ===\n\n{| border="1" class="wikitable sortable"\n!WikiTree ID!!First!!Last!!Event\n|-\n|Peasley-221||Frances||Robinson||Ev'));
  assert.ok(t.endsWith("\n|-\n|}"));
});

test("defaultEventName and idKey", () => {
  assert.equal(defaultEventName(new Date(Date.UTC(2026, 9, 25))), "WikiTree Bingo October 2026");
  assert.equal(idKey(" Peasley-221 "), "peasley-221");
});

test("parsePeople reads a real WikiTree getPeople reply", () => {
  // trimmed from api.wikitree.com for Robinson-27225, Zurcher-160 and Peasley-221
  const reply = [{ status: "", resultByKey: { "Robinson-27225": { Id: 19606899 } }, people: {
    19606899: { Name: "Robinson-27225", RealName: "Azure", LastNameAtBirth: "Robinson", LastNameCurrent: "Robinson", Privacy: 40 },
    19617690: { Name: "Peasley-221", RealName: "Frances", LastNameAtBirth: "Peasley", LastNameCurrent: "Robinson", Privacy: 40 },
    30472942: { Name: "Zurcher-160", RealName: "Randi", LastNameAtBirth: "Zurcher", LastNameCurrent: "Zurcher" },
    5: { Id: 5 },                                       // a profile that is not visible has no Name
  } }];
  assert.deepEqual(parsePeople(reply), {
    "robinson-27225": { first: "Azure", last: "Robinson" },
    "peasley-221": { first: "Frances", last: "Robinson" },
    "zurcher-160": { first: "Randi", last: "Zurcher" },
  });
  assert.deepEqual(parsePeople([]), {});
  assert.deepEqual(parsePeople(null), {});
});
