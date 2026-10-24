// Pure bingo logic shared by the browser pages and the Cloudflare Worker.
// No DOM or Worker APIs beyond crypto.getRandomValues, so it also runs under node:test.

export const FREE = 12;                 // index of the free centre cell in a 5x5 card
export const CARD_WORDS = 24;
export const MIN_WORDS = 24;
export const MAX_WORDS = 200;
export const MAX_WORD_LEN = 60;

export const LINES = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L;
})();

const norm = s => s.trim().toLowerCase().replace(/\s+/g, " ");

// Uniform integer in [0, n) from crypto randomness (rejection sampling, no modulo bias).
export function randInt(n, getRandomValues = c => crypto.getRandomValues(c)) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

export function shuffle(arr, rand = randInt) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Parse a CSV (or plain list). Takes the first column of each row, handles quoted
// fields with commas/newlines/escaped quotes, skips a header row, drops blanks and
// case-insensitive duplicates, and trims every word to MAX_WORD_LEN.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell); rows.push(row);

  const first = rows.map(r => (r[0] || "").trim()).filter(Boolean);
  if (first.length && /^(words?|terms?|items?|list|names?|phrases?|squares?)$/i.test(first[0])) first.shift();
  const seen = new Set(), out = [];
  for (let w of first) {
    w = w.replace(/\s+/g, " ").slice(0, MAX_WORD_LEN).trim();
    const k = norm(w);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(w);
  }
  return out;
}

export const cardSignature = card => card.join("\u0001");

// Build a card: 24 random words from the pool in random order, free space at index 12.
// Retries until the arrangement is not in `existing` (a Set of signatures).
export function makeCard(words, existing = new Set(), rand = randInt) {
  if (words.length < CARD_WORDS) throw new Error("Need at least " + CARD_WORDS + " words");
  for (let tries = 0; tries < 50; tries++) {
    const pick = shuffle(words, rand).slice(0, CARD_WORDS);
    const card = [...pick.slice(0, FREE), "", ...pick.slice(FREE)];
    if (!existing.has(cardSignature(card))) return card;
  }
  // Pool so small that every arrangement may be taken; accept a repeat rather than fail.
  const pick = shuffle(words, rand).slice(0, CARD_WORDS);
  return [...pick.slice(0, FREE), "", ...pick.slice(FREE)];
}

// Verify a BINGO claim. `called` is a Set of normalised called words; `daubed` is the
// list of card indices the player has daubed. A line wins when every cell is the free
// space or is both daubed by the player and actually called. Returns the line or null.
export function checkClaim(card, called, daubed) {
  const d = new Set(daubed);
  for (const line of LINES) {
    if (line.every(i => i === FREE || (d.has(i) && called.has(norm(card[i]))))) return line;
  }
  return null;
}

export const normWord = norm;

// "Robinson-27225", "O'Brien-12", "Smith_Jones-3" style WikiTree IDs.
export const isWikiTreeId = s => /^[A-Za-zÀ-ÿ'’.\-_ ]*[A-Za-zÀ-ÿ]-[1-9]\d*$/.test(String(s).trim());

export const cleanName = s => String(s).replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
