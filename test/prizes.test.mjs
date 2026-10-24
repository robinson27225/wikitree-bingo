import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEventEnd, windowStart, parsePrizeWinners, htmlToWikitext, idKey } from "../shared/prizes.js";

const NOW = new Date(Date.UTC(2026, 9, 24, 12));     // 24 Oct 2026
const day = s => new Date(s + "T00:00:00Z");
const fixture = readFileSync(new URL("./fixtures/prize-winners.wiki", import.meta.url), "utf8");

test("parseEventEnd: ranges, single days, month-crossing and US order", () => {
  const cases = {
    "2-5 October 2026": "2026-10-05",
    "2–5 October 2026": "2026-10-05",
    "24 April 2026": "2026-04-24",
    "30 Nov - 3 Dec 2025": "2025-12-03",
    "28 August - 1 September 2026": "2026-09-01",
    "29 Dec 2025 - 2 Jan 2026": "2026-01-02",
    "October 2-5, 2026": "2026-10-05",
    "Oct 30 - Nov 2, 2025": "2025-11-02",
    "March 3rd 2026": "2026-03-03",
    "April 2026": "2026-04-30",
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(parseEventEnd(text)?.toISOString().slice(0, 10), want, text);
  for (const bad of ["Spring Bash", "Previous Event Winners", "2026", "31 February 2026", "October"]) assert.equal(parseEventEnd(bad), null, bad);
});

test("windowStart: six calendar months, clamped for short months", () => {
  assert.equal(windowStart(NOW).toISOString().slice(0, 10), "2026-04-24");
  assert.equal(windowStart(day("2026-08-31")).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(windowStart(day("2026-03-15")).toISOString().slice(0, 10), "2025-09-15");
});

test("parsePrizeWinners: wikitext fixture", () => {
  const r = parsePrizeWinners(fixture, NOW);
  assert.deepEqual(Object.keys(r.ids).sort(), ["cross-1", "edge-24", "hartley-99", "link-1", "white-34498", "zurcher-160"]);
  assert.equal(r.ids["hartley-99"], "current");
  assert.equal(r.ids["zurcher-160"], "2026-10-05");
  assert.equal(r.ids["cross-1"], "2026-09-01");
  assert.equal(r.ids["edge-24"], "2026-04-24", "the boundary day is still inside the window");
  assert.ok(!("edge-23" in r.ids), "one day earlier is outside it");
  assert.ok(!("old-1" in r.ids));
  assert.ok(!("mystery-5" in r.ids), "an unreadable heading never excludes anyone");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Spring Bash/);
  assert.equal(r.found, 9);
});

test("parsePrizeWinners: the latest win is kept when someone appears twice", () => {
  const text = "==== 2 March 2026 ====\n|-\n|Twice-1||A||B||x\n==== 9 June 2026 ====\n|-\n|twice-1||A||B||x\n";
  assert.equal(parsePrizeWinners(text, NOW).ids["twice-1"], "2026-06-09");
});

test("parsePrizeWinners: a row with no heading date falls back to the Event column", () => {
  const text = "=== Previous Event Winners ===\n|-\n|Col-1||A||B||Source-a-Thon 2-5 October 2026\n|-\n|Col-2||A||B||Source-a-Thon 3 Jan 2025\n";
  const r = parsePrizeWinners(text, NOW);
  assert.deepEqual(Object.keys(r.ids), ["col-1"]);
  assert.equal(r.warnings.length, 0);
});

test("parsePrizeWinners: the rendered HTML page gives the same answer", () => {
  const html = `<html><body><h2>Prize Winners <a>edit</a></h2><h3>Current Event Winners</h3>
    <table><tr><th>WikiTree ID</th><th>First</th></tr><tr><td><a href="/wiki/Hartley-99">Hartley-99</a></td><td>Ann</td></tr></table>
    <h3>Previous Event Winners</h3><h4>2-5 October 2026</h4>
    <table><tr><td><a href="/wiki/Zurcher-160">Zurcher-160</a></td><td>Randi</td></tr></table>
    <h4>30 Nov - 3 Dec 2025</h4><table><tr><td>Old-1</td><td>Olga</td></tr></table></body></html>`;
  const r = parsePrizeWinners(html, NOW);
  assert.deepEqual(r.ids, { "hartley-99": "current", "zurcher-160": "2026-10-05" });
  assert.match(htmlToWikitext(html), /=== Current Event Winners ===/);
});

test("idKey: case and spacing do not matter", () => {
  assert.equal(idKey(" Robinson-27225 "), idKey("robinson-27225"));
  assert.equal(idKey("De La Cruz-9"), idKey("de_la_cruz-9"));
});
