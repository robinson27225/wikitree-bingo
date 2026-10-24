import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, makeCard, checkClaim, cardSignature, LINES, FREE, isWikiTreeId, normWord } from "../shared/bingo.js";

const words = n => Array.from({ length: n }, (_, i) => "Word " + (i + 1));

test("parseCsv: first column, header skipped, blanks and duplicates dropped", () => {
  const out = parseCsv("Words,Notes\nCensus,x\n  census ,y\n\nBirth certificate,z\n");
  assert.deepEqual(out, ["Census", "Birth certificate"]);
});

test("parseCsv: quotes, embedded commas, CRLF, BOM", () => {
  const out = parseCsv('﻿"Smith, John",1\r\n"He said ""hi""",2\r\nPlain\r\n');
  assert.deepEqual(out, ["Smith, John", 'He said "hi"', "Plain"]);
});

test("parseCsv: a plain list without a header keeps the first row", () => {
  assert.deepEqual(parseCsv("Alpha\nBeta"), ["Alpha", "Beta"]);
});

test("makeCard: 25 cells, free centre, 24 distinct pool words", () => {
  const card = makeCard(words(40));
  assert.equal(card.length, 25);
  assert.equal(card[FREE], "");
  const rest = card.filter((_, i) => i !== FREE);
  assert.equal(new Set(rest).size, 24);
  assert.ok(rest.every(w => /^Word \d+$/.test(w)));
});

test("makeCard: cards avoid existing signatures", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = makeCard(words(30), seen);
    const sig = cardSignature(c);
    assert.ok(!seen.has(sig), "duplicate card issued");
    seen.add(sig);
  }
});

test("makeCard: needs at least 24 words", () => {
  assert.throws(() => makeCard(words(23)));
});

const card = makeCard(words(30));
const calledSet = idxs => new Set(idxs.filter(i => i !== FREE).map(i => normWord(card[i])));

test("checkClaim: every row, column and diagonal wins", () => {
  assert.equal(LINES.length, 12);
  for (const line of LINES) {
    assert.deepEqual(checkClaim(card, calledSet(line), line), line);
  }
});

test("checkClaim: four of five, or daubed but not called, does not win", () => {
  const line = LINES[0];
  assert.equal(checkClaim(card, calledSet(line.slice(1)), line), null);
  assert.equal(checkClaim(card, calledSet(line.slice(1)), line.slice(1)), null);
  assert.equal(checkClaim(card, calledSet(line), line.slice(1)), null);   // called but never daubed
  assert.equal(checkClaim(card, new Set(), []), null);
});

test("checkClaim: free space counts without being daubed or called", () => {
  const line = LINES.find(l => l.includes(FREE));
  const others = line.filter(i => i !== FREE);
  assert.ok(checkClaim(card, calledSet(others), others));
});

test("isWikiTreeId", () => {
  for (const ok of ["Robinson-27225", "O'Brien-12", "Smith_Jones-3", "de la Cruz-9"]) assert.ok(isWikiTreeId(ok), ok);
  for (const bad of ["Robinson", "Robinson-", "-27225", "Robinson-0", "27225", "Robin son 27225"]) assert.ok(!isWikiTreeId(bad), bad);
});
