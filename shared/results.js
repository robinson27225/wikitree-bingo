// Turns the session's winners into the rows of WikiTree's Prize Winners table, in the same
// layout the Marathon Drawing tool writes:
//   |WikiTree ID||First||Last||Event
// Pure functions, unit-tested.

// A table cell can't contain "|" or a line break.
const cell = s => String(s == null ? "" : s).replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export const idKey = id => String(id).trim().toLowerCase().replace(/\s+/g, "_");

// One row. `names` maps idKey -> { first, last } (from WikiTree). Winners who joined with a
// username have no WikiTree ID: the ID cell is blank and the username goes in First.
export function winnerRow(w, names, event) {
  const ev = cell(event);
  if (w.kind === "id") {
    const n = (names && names[idKey(w.name)]) || {};
    return `|-\n|${cell(w.name)}||${cell(n.first)}||${cell(n.last)}||${ev}`;
  }
  return `|-\n| ||${cell(w.name)}||||${ev}`;
}

export const rowsMarkup = (winners, names, event) => winners.map(w => winnerRow(w, names, event)).join("\n");

export function tableMarkup(winners, names, event) {
  return `=== Current Event Winners ===\n\n{| border="1" class="wikitable sortable"\n!WikiTree ID!!First!!Last!!Event\n${rowsMarkup(winners, names, event)}\n|-\n|}`;
}

// Default event name, for example "WikiTree Bingo October 2026".
export function defaultEventName(date = new Date()) {
  return `WikiTree Bingo ${date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;
}

// WikiTree's getPeople reply -> { idKey: { first, last } }. Takes the name the person goes by (RealName)
// and their current surname, falling back to the birth surname.
export function parsePeople(json) {
  const top = Array.isArray(json) ? json[0] : json;
  const people = (top && top.people) || {};
  const out = {};
  for (const p of Object.values(people)) {
    if (!p || !p.Name) continue;
    out[idKey(p.Name)] = { first: p.RealName || p.FirstName || "", last: p.LastNameCurrent || p.LastNameAtBirth || "" };
  }
  return out;
}
