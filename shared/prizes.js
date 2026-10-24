// Reads WikiTree's Space:Prize_Winners page and works out who won a prize recently.
// Pure functions (no network, no DOM) so the Worker and node:test can both use them.
//
// The page has a "Current Event Winners" table, then "Previous Event Winners" with one
// table per event under a date heading such as "2-5 October 2026". Rows look like
//   |Zurcher-160||Randi||Zurcher||Source-a-Thon
// (the layout the Marathon Drawing tool writes). The same is understood from the
// rendered HTML page, which is converted to that shape first.

export const WINDOW_MONTHS = 6;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = s => MONTHS.findIndex(m => m.startsWith(s.toLowerCase().slice(0, 3)));

const iso = d => d.toISOString().slice(0, 10);
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// "Robinson-27225" in any case, with spaces or underscores treated alike.
export const idKey = id => String(id).trim().toLowerCase().replace(/\s+/g, "_");
// A WikiTree ID: a name containing at least one letter, then -digits ("Zurcher-160", "De_La_Cruz-9"). The letter rule
// keeps a date range like "2-5" from being read as an ID.
const ID_RE = /^(?=[^-]*\p{L})[^\s\[\]|{}<>=!]+-[1-9]\d*$/u;

// The last day of an event from its heading, as a UTC Date, or null if there is no date.
// Understands "2-5 October 2026", "30 Nov - 3 Dec 2025", "October 2-5, 2026", "24 April 2026",
// "April 2026" (taken as the end of the month).
export function parseEventEnd(text) {
  const t = String(text).replace(/[‒-―−]/g, "-").replace(/&ndash;|&mdash;/g, "-").replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1");
  const years = [...t.matchAll(/\b(19\d\d|20\d\d)\b/g)];
  if (!years.length) return null;
  const year = +years[years.length - 1][1];
  const months = [...t.matchAll(new RegExp("\\b" + MONTH_RE + "\\b\\.?", "gi"))];
  if (!months.length) return null;
  const last = months[months.length - 1];
  const m = monthIndex(last[1]);
  const after = t.slice(last.index + last[0].length).match(/^\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?(?!\d)/);   // "October 2-5"
  const before = t.slice(0, last.index).match(/(\d{1,2})\s*$/);                                           // "5 October"
  let day;
  if (after) day = +(after[2] || after[1]);
  else if (before) day = +before[1];
  else day = daysIn(year, m);                                   // month and year only
  if (day < 1 || day > daysIn(year, m)) return null;
  return new Date(Date.UTC(year, m, day));
}

// Six calendar months before `now` (UTC midnight), clamping to the end of a short month.
export function windowStart(now, months = WINDOW_MONTHS) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() - months, d = now.getUTCDate();
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return new Date(Date.UTC(yy, mm, Math.min(d, daysIn(yy, mm))));
}

// A rendered page, as opposed to wikitext. Pages are full of script/style lines that start with
// "{" or "!", so look for document tags rather than for the absence of wiki markup.
export function looksLikeHtml(source) {
  const s = String(source);
  if (/^\s*\{\|/m.test(s) && !/<\s*(html|body|table)\b/i.test(s.slice(0, 4000))) return false;
  return /<\s*(!doctype|html|head|body)\b/i.test(s.slice(0, 4000)) || /<\s*(table|h[1-6])\b/i.test(s);
}

// What a string is: "html" (a rendered page), "wikitext" (the page's markup) or "text" (what you
// get from selecting a rendered page in a browser and copying it).
export function detectKind(source) {
  const s = String(source);
  if (looksLikeHtml(s)) return "html";
  if (/^\s*(\{\||\|-|={2,6}[^=\n]+={2,6}\s*$)/m.test(s)) return "wikitext";
  return "text";
}

// Text copied from the rendered page: headings are lines of their own, table rows are tab-separated
// (or space-separated). Only lines that are clearly a row or an event heading are kept, so stray
// sentences and the table's header row can't disturb which event a row belongs to.
export function plainTextToWikitext(text) {
  const out = [];
  const clean = c => c.replace(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/, "$1").trim();
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    let cells = t.split(/\t+| {2,}/).map(c => c.trim()).filter(Boolean);
    if (!cells.slice(0, 2).some(c => ID_RE.test(clean(c)))) {
      const parts = t.split(/\s+/);                                // "Zurcher-160 Randi Zurcher Source-a-Thon"
      cells = ID_RE.test(clean(parts[0])) ? [parts[0], parts.slice(1).join(" ")] : [];
    }
    if (cells.length && cells.slice(0, 2).some(c => ID_RE.test(clean(c)))) { out.push("|-", "|" + cells.join("||")); continue; }
    if (/^(current|previous)\b/i.test(t) || parseEventEnd(t)) out.push("=== " + t + " ===");
  }
  return out.join("\n");
}

// Every string inside a JSON value, one per line (the WikiTree API wraps the page text in JSON).
export function stringsFromJson(value) {
  const out = [];
  (function walk(v) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  })(value);
  return out.join("\n");
}

// The rendered page as wikitext-shaped lines, so one parser handles both.
export function htmlToWikitext(html) {
  const decode = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  const text = s => decode(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const out = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) out.push("=".repeat(+m[1]) + " " + text(m[2]).replace(/\s*\[?edit\]?$/i, "") + " " + "=".repeat(+m[1]));
    else {
      const cells = [...m[3].matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi)];
      if (!cells.length) continue;
      out.push("|-");
      out.push((cells[0][1].toLowerCase() === "h" ? "!" : "|") + cells.map(c => text(c[2])).join("||"));
    }
  }
  return out.join("\n");
}

// Returns { ids, warnings, found, sections }
//   ids       { idKey: "YYYY-MM-DD" | "current" } for everyone inside the window
//   found     how many distinct WikiTree IDs the page listed in total
//   warnings  things the host should know (a heading whose date could not be read, ...)
export function parsePrizeWinners(source, now = new Date()) {
  const kind = detectKind(source);
  const text = kind === "html" ? htmlToWikitext(source) : kind === "text" ? plainTextToWikitext(source) : String(source);
  const start = windowStart(now), ids = {}, all = new Set(), warnings = [], seenWarn = new Set();
  let heading = "", section = null, sections = 0;

  const enter = h => {
    heading = h; sections++;
    if (/^\s*current\b/i.test(h)) section = { current: true };
    else section = { end: parseEventEnd(h), label: h };
  };
  const record = (id, cells) => {
    const k = idKey(id);
    all.add(k);
    let when = section && section.current ? "current" : section && section.end ? section.end : null;
    if (!when) {                                                // no usable heading: try the Event column
      const end = cells.map(c => parseEventEnd(c)).find(Boolean);
      if (end) when = end;
    }
    if (!when) {
      const label = (section && section.label) || heading || "(top of the page)";
      const w = `Couldn't read a date for "${label}", so its winners were not excluded`;
      if (!seenWarn.has(w)) { seenWarn.add(w); warnings.push(w); }
      return;
    }
    if (when === "current") { ids[k] = "current"; return; }
    if (when >= start && when <= now) {
      const d = iso(when);
      if (ids[k] !== "current" && (!ids[k] || d > ids[k])) ids[k] = d;
    }
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^(={1,6})\s*(.*?)\s*\1\s*$/);
    if (h) { enter(h[2]); continue; }
    if (!/^\|[^-}+]/.test(line)) continue;                      // only table data rows
    const cells = line.slice(1).split("||").map(c => c.trim());
    const clean = c => c.replace(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/, "$1").trim();   // [[Smith-1]] or [[Smith-1|Smith-1]]
    const at = cells.slice(0, 2).findIndex(c => ID_RE.test(clean(c)));                  // the ID is the first column (or the second, after an icon)
    if (at < 0) continue;
    record(clean(cells[at]), cells.filter((_, i) => i !== at));
  }
  return { ids, warnings, found: all.size, sections };
}
