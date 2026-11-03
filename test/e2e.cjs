// End-to-end check: one host and three players against a local Worker and static server.
//   npm run dev:worker   (port 8787)      npm run serve   (port 8000)      node test/e2e.cjs
// The host pastes a Prize Winners page through the real dialog; Smith-1 won recently so may not win.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

const SITE = process.env.SITE || "http://127.0.0.1:8000";
const WORKER = process.env.WORKER || "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS || "";           // directory for screenshots, optional
const q = `worker=${encodeURIComponent(WORKER)}`;
const words24 = Array.from({ length: 24 }, (_, i) => "Word " + String.fromCharCode(65 + i)).join("\n");

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const norm = s => s.trim().toLowerCase();

const ago = days => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
const dmy = iso => { const d = new Date(iso + "T12:00:00Z"); return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`; };
// What selecting the rendered Prize Winners page and copying it gives (tab-separated table rows).
// Smith-1 won a prize 10 days ago, so Smith-1 may not win; Robinson-27225 won 300 days ago, so may.
const prizePage = [
  "Prize Winners", "Participants may not win more than once in six months.",
  "Current Event Winners", "WikiTree ID\tFirst\tLast\tEvent", "Hartley-99\tAnn\tHartley\tNow",
  "Previous Event Winners", dmy(ago(10)), "WikiTree ID\tFirst\tLast\tEvent", "Smith-1\tSam\tSmith\tRecent event",
  dmy(ago(300)), "WikiTree ID\tFirst\tLast\tEvent", "Robinson-27225\tRob\tRobinson\tLong ago",
].join("\n");

(async () => {
  const browser = await chromium.launch();
  const ctxH = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await ctxH.newPage();
  host.on("pageerror", e => { throw e; });

  // ---- host: words -> lobby ----
  await host.goto(`${SITE}/host.html?${q}&fast`);
  await host.click("#quickGame");
  await host.fill("#paste", "Words\n" + words24 + "\nWord A");           // header and a duplicate
  assert.match(await host.textContent("#count"), /^24 words found/);
  await host.click("#openLobby");
  await host.waitForSelector("#lobby.active");
  const code = (await host.textContent("#bigCode")).trim();
  assert.equal((await host.textContent("#joinUrl")).trim(), `Go to wikitree.s.gy/bingo?g=${code}`, "lobby shows the short link with the code");
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.match(await host.textContent("#prizeLine"), /isn't being checked/, "without a list the host is warned");
  await host.click("#prizeLine button");                         // the paste dialog
  await host.fill("#prizeText", "hello, this is not the page");
  await host.click("#prizeUse");
  await host.waitForFunction(() => /couldn't find any WikiTree IDs/.test(document.getElementById("prizeErr").textContent));
  await host.fill("#prizeText", prizePage);
  await host.click("#prizeUse");
  await host.waitForFunction(() => /2 WikiTree IDs can't win/.test(document.getElementById("prizeLine").textContent));
  assert.ok(!(await host.$eval("#prizeDlg", d => d.open)), "the dialog closes once the list is accepted");

  // the lobby shows a QR code that carries the direct join link
  const qrBox = await host.$eval("#qrSvg svg", s => { const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, paths: s.querySelectorAll("path").length }; });
  assert.ok(qrBox.w > 100 && Math.abs(qrBox.w - qrBox.h) < 1 && qrBox.paths > 0, "QR code is drawn and square");
  assert.equal(await host.$eval("#lobbyResults", e => e.classList.contains("hidden")), true, "no Results button before there is a winner");

  // the landing page passes ?g= on to the join link
  const land = await host.context().newPage();
  await land.goto(`${SITE}/index.html?g=${code}`);
  assert.match(await land.getAttribute("#join", "href"), new RegExp("g=" + code));
  await land.close();

  // ---- players join ----
  const players = [];
  const names = [["id", "Robinson-27225"], ["name", "Cousin Sam"], ["id", "Smith-1"]];
  for (const [kind, who] of names) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const p = await ctx.newPage();
    p.on("pageerror", e => { throw e; });
    await p.goto(`${SITE}/player.html?g=${code}&${q}`);
    if (kind === "name") await p.click("#modeName");
    await p.fill("#who", who);
    await p.click("#joinBtn");
    await p.waitForSelector("#game:not(.hidden)");
    players.push({ p, who });
  }
  await host.waitForFunction(() => document.getElementById("lobbyCount").textContent === "3");
  assert.match(await players[2].p.textContent("#eligNote"), /won a prize on/, "a recent winner is told up front");
  assert.ok(await players[0].p.$eval("#eligNote", e => e.classList.contains("hidden")), "an older winner is not restricted");
  await host.waitForTimeout(500);
  await shot(host, "host-lobby");
  await shot(players[0].p, "player-card");

  // bad id is rejected client-side
  const ctxBad = await browser.newContext(); const bad = await ctxBad.newPage();
  await bad.goto(`${SITE}/player.html?g=${code}&${q}`);
  await bad.fill("#who", "notanid"); await bad.click("#joinBtn");
  assert.match(await bad.textContent("#joinErr"), /WikiTree ID/);
  // duplicate name is rejected by the server
  await bad.click("#modeName"); await bad.fill("#who", "cousin sam"); await bad.click("#joinBtn");
  await bad.waitForFunction(() => document.getElementById("joinErr").textContent.includes("already playing"));
  await ctxBad.close();

  const cardOf = async p => p.$$eval("#grid .cell", cs => cs.map(c => c.classList.contains("free") ? "" : c.textContent));
  const cards = await Promise.all(players.map(x => cardOf(x.p)));
  for (const c of cards) { assert.equal(c.length, 25); assert.equal(c[12], ""); assert.equal(new Set(c).size, 25); }
  assert.notEqual(cards[0].join("|"), cards[1].join("|"), "cards must differ");

  // a refresh restores the same card
  await players[0].p.reload();
  await players[0].p.fill("#who", players[0].who); await players[0].p.click("#joinBtn");
  await players[0].p.waitForSelector("#game:not(.hidden)");
  assert.deepEqual(await cardOf(players[0].p), cards[0], "rejoin keeps the card");

  // ---- play ----
  await host.click("#startBtn", { force: true });   // it pulses, so Playwright never sees it as stable
  await host.waitForSelector("#stage.active");
  const called = [];
  const waitCalled = async n => host.waitForFunction(k => document.querySelectorAll("#ribbon .chip").length === k, n, { timeout: 15000 });
  await waitCalled(1);
  assert.equal((await host.textContent("#stageJoin")).trim(), `Join at wikitree.s.gy/bingo?g=${code}`, "the stage shows how to join");
  assert.ok(await host.$eval("#stageJoin", e => !e.classList.contains("hidden")));
  called.push(norm(await host.textContent("#ribbon .chip:last-child")).replace(/^\d+/, ""));
  await shot(host, "host-stage");

  // tapping an undrawn word does not daub; tapping a drawn one does, and again removes it
  const p0 = players[0].p;
  await p0.waitForFunction(() => document.getElementById("status").textContent.includes("Current word"));
  assert.ok(await p0.$eval("#earlier", e => e.classList.contains("hidden")), "no earlier words until a second word is drawn");
  const idxOf = async (p, word) => (await cardOf(p)).findIndex(w => norm(w) === word);
  let cell = await p0.$$("#grid .cell");
  const firstWord = called[0];
  const drawnIdx = await idxOf(p0, firstWord.replace(/^\s*/, ""));
  const other = (await cardOf(p0)).findIndex((w, i) => i !== 12 && i !== drawnIdx);
  await cell[other].click();
  assert.equal(await p0.$$eval("#grid .daub", d => d.length), 1, "only the free space is daubed");
  await cell[drawnIdx].click();
  assert.equal(await p0.$$eval("#grid .daub", d => d.length), 2);
  await cell[drawnIdx].click();
  assert.equal(await p0.$$eval("#grid .daub", d => d.length), 1, "second tap un-daubs");

  // the player's small-print list holds the earlier words, in order, without the current one
  const ribbon = async () => (await host.$$eval("#ribbon .chip", cs => cs.map(c => c.textContent.replace(/^\d+/, "").trim())));
  {
    await host.click("#nextBtn"); await waitCalled(2);
    const all = await ribbon();
    await p0.waitForFunction(w => document.getElementById("status").textContent.includes(w), all[1]);
    assert.deepEqual(await p0.$$eval("#earlier span", s => s.map(x => x.textContent)), all.slice(0, -1));
    assert.match(await p0.textContent("#status"), /^Current word: /);
    assert.ok(!/Last word/.test(await p0.textContent("#status")));
    await shot(p0, "player-earlier");
  }

  // a premature claim is refused
  await p0.click("#bingoBtn");
  await p0.waitForSelector(".banner.warn");

  // draw until somebody has a complete line, daubing as we go
  const LINES = []; for (let r = 0; r < 5; r++) LINES.push([0,1,2,3,4].map(c => r*5+c));
  for (let c = 0; c < 5; c++) LINES.push([0,1,2,3,4].map(r => r*5+c));
  LINES.push([0,6,12,18,24],[4,8,12,16,20]);
  let winner = null, shotWin = false;
  const barredPl = players[2];                                  // Smith-1, a recent prize winner
  for (let n = 1; n <= 24 && !(winner && barredPl.hasLine); n++) {
    if ((await ribbon()).length < n) { await host.click("#nextBtn"); await waitCalled(n); }
    const word = norm((await ribbon())[n - 1]);
    for (const pl of players) {
      await pl.p.waitForFunction(k => +(/(\d+) drawn/.exec(document.getElementById("status").textContent) || [0, 0])[1] >= k, n);
      const card = await cardOf(pl.p);
      const i = card.findIndex(w => norm(w) === word);
      const daubed = await pl.p.$$eval("#grid .cell", cs => cs.map(c => !!c.querySelector(".daub")));
      if (i >= 0 && !daubed[i]) { await (await pl.p.$$("#grid .cell"))[i].click(); daubed[i] = true; }
      pl.daubed = daubed; pl.card = card;
      const has = LINES.some(l => l.every(k => k === 12 || daubed[k]));
      if (pl === barredPl) barredPl.hasLine = has;
      else if (has && !winner) winner = pl;
    }
    if (n === 6 && !shotWin) { shotWin = true; await shot(players[0].p, "player-daubed"); await shot(host, "host-stage-6"); }
  }
  assert.ok(winner, "someone should complete a line by the time all 24 words are drawn");

  // the recent winner has a real line but is not allowed to win: the game carries on
  await barredPl.p.click("#bingoBtn");
  await barredPl.p.waitForFunction(() => /You have a line, but you can't win this round/.test(document.querySelector(".banner.warn")?.textContent || ""));
  await host.waitForFunction(() => /Smith-1 has a line, but won a prize on/.test(document.getElementById("toast").textContent) && !document.getElementById("toast").classList.contains("hidden"));
  assert.ok(!(await host.$eval("#win", e => e.classList.contains("show"))), "an ineligible claim must not end the game");
  await shot(host, "host-toast");
  await shot(barredPl.p, "player-barred");

  await winner.p.click("#bingoBtn");
  await host.waitForSelector("#win.show");
  await host.waitForFunction(() => document.querySelectorAll(".bingos div.go").length === 3, null, { timeout: 8000 });
  assert.equal((await host.textContent("#winnerName")).trim(), winner.who);
  await host.waitForTimeout(2200);
  await shot(host, "host-winner");
  await winner.p.waitForSelector(".banner.win");
  for (const pl of players) if (pl !== winner) await pl.p.waitForSelector(".banner.lose");

  // ---- results page: the winner as WikiTree table rows ----
  await host.click("#winResults");
  await host.waitForSelector("#results.active");
  assert.ok(!(await host.$eval("#win", e => e.classList.contains("show"))), "the celebration steps aside for the results page");
  assert.match(await host.textContent("#winList"), new RegExp("Round 1: " + winner.who.replace(/[-]/g, "\\-")));
  const ev = await host.inputValue("#evName");
  assert.match(ev, /^WikiTree Bingo \w+ \d{4}$/, "default event name");
  let markup = await host.inputValue("#markup");
  const row = winner.who === "Cousin Sam" ? `| ||Cousin Sam||||${ev}` : `|${winner.who}||`;
  assert.ok(markup.includes("|-\n" + row), "rows markup has the winner: " + markup);
  await host.fill("#evName", "Bingo Night");
  assert.ok((await host.inputValue("#markup")).includes("Bingo Night"), "changing the event name rebuilds the markup");
  await host.click("#fmtTable");
  markup = await host.inputValue("#markup");
  assert.ok(markup.startsWith("=== Current Event Winners ===") && markup.endsWith("|}") && markup.includes("!WikiTree ID!!First!!Last!!Event"), "whole-table markup");
  await shot(host, "host-results");
  await host.click("#resBack");
  await host.waitForSelector("#win.show");                       // back to the celebration, quietly

  // ---- new game: fresh cards, back to lobby ----
  await host.click("#newGame");
  await host.waitForSelector("#lobby.active");
  await host.waitForFunction(() => /Results \(1\)/.test(document.getElementById("lobbyResults").textContent), null, { timeout: 5000 });
  await winner.p.waitForFunction(() => !document.querySelector(".banner"));
  assert.notDeepEqual(await cardOf(winner.p), winner.card, "new game deals a new card");
  // ============ a prepared livestream: one set of words, two games on the same code ============
  const evp = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })).newPage();
  evp.on("pageerror", e => { throw e; });
  evp.on("dialog", d => d.accept());                              // confirm() on delete / back to event
  await evp.goto(`${SITE}/host.html?${q}&fast`);
  assert.ok(await evp.$eval("#home", e => e.classList.contains("active")), "the host starts on the events screen");
  await evp.click("#newEvent"); await evp.fill("#nameInput", "WikiTree Days 2026"); await evp.click("#nameOk");
  await evp.waitForSelector("#event.active");
  assert.equal(await evp.textContent("#evTitle"), "WikiTree Days 2026");
  assert.match(await evp.textContent("#evPrize"), /No Prize Winners list saved/, "a missing list is flagged");
  assert.equal(await evp.$eval("#goLive", b => b.disabled), true, "can't go live without words");
  assert.ok(!(await evp.$("#gameList")), "there is no list of games: one livestream has one set of words");
  await evp.click("#editWords"); await evp.fill("#gPaste", "only three\nwords\nhere");
  assert.equal(await evp.$eval("#gSave", b => b.disabled), true, "fewer than 24 words can't be saved");
  await evp.fill("#gPaste", Array.from({ length: 24 }, (_, i) => `Alpha ${i + 1}`).join("\n"));
  await evp.click("#gSave");
  assert.equal(await evp.textContent("#wordsMeta"), "24 words");
  assert.equal(await evp.$eval("#goLive", b => b.disabled), false);
  await evp.click("#evPrize button"); await evp.fill("#prizeText", prizePage); await evp.click("#prizeUse");
  await evp.waitForFunction(() => /Prize Winners list saved today: 2 WikiTree IDs/.test(document.getElementById("evPrize").textContent));
  await evp.reload();                                             // everything was saved in the browser
  await evp.waitForTimeout(500); await shot(evp, "events-home");
  await evp.click("#eventList .row button.primary");
  await evp.waitForSelector("#event.active");
  assert.equal(await evp.textContent("#wordsMeta"), "24 words", "the words survive a reload");
  await evp.waitForTimeout(500); await shot(evp, "event-prep");

  await evp.click("#goLive");
  await evp.waitForSelector("#lobby.active");
  const code2 = (await evp.textContent("#bigCode")).trim();
  await evp.waitForTimeout(500); await shot(evp, "event-lobby");
  await evp.waitForFunction(() => /2 WikiTree IDs can't win/.test(document.getElementById("prizeLine").textContent), null, { timeout: 8000 });
  assert.equal((await evp.textContent("#gameLabel")).trim(), "Game 1");
  const mkPlayer = async (kind, who) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    p.on("pageerror", e => { throw e; });
    await p.goto(`${SITE}/player.html?g=${code2}&${q}`);
    if (kind === "name") await p.click("#modeName");
    await p.fill("#who", who); await p.click("#joinBtn"); await p.waitForSelector("#game:not(.hidden)");
    return { p, who };
  };
  const pls = [await mkPlayer("id", "Robinson-27225"), await mkPlayer("id", "Smith-1"), await mkPlayer("name", "Cousin Sam")];
  assert.ok((await cardOf(pls[0].p)).every((w, i) => i === 12 || /^Alpha \d+$/.test(w)), "cards use the livestream's words");
  await evp.waitForFunction(() => document.getElementById("lobbyCount").textContent === "3");
  const ribbonOf = async h => h.$$eval("#ribbon .chip", cs => cs.map(c => c.textContent.replace(/^\d+/, "").trim()));
  const playUntilWin = async targetWho => {
    const target = pls.find(x => x.who === targetWho);
    for (let n = 1; n <= 24; n++) {
      if (n === 1) await evp.waitForFunction(() => document.querySelectorAll("#ribbon .chip").length === 1, null, { timeout: 15000 });
      else if ((await ribbonOf(evp)).length < n) { await evp.click("#nextBtn"); await evp.waitForFunction(k => document.querySelectorAll("#ribbon .chip").length === k, n, { timeout: 15000 }); }
      const word = norm((await ribbonOf(evp))[n - 1]);
      for (const pl of pls) {
        await pl.p.waitForFunction(k => +(/(\d+) drawn/.exec(document.getElementById("status").textContent) || [0, 0])[1] >= k, n);
        const card = await cardOf(pl.p), i = card.findIndex(w => norm(w) === word);
        const daubed = await pl.p.$$eval("#grid .cell", cs => cs.map(c => !!c.querySelector(".daub")));
        if (i >= 0 && !daubed[i]) { await (await pl.p.$$("#grid .cell"))[i].click(); daubed[i] = true; }
        if (pl === target && LINES.some(l => l.every(k => k === 12 || daubed[k]))) { await pl.p.click("#bingoBtn"); return; }
      }
    }
    throw new Error("no line was completed");
  };
  await evp.click("#startBtn", { force: true });
  await playUntilWin("Robinson-27225");
  await evp.waitForSelector("#win.show");
  assert.equal((await evp.textContent("#winnerName")).trim(), "Robinson-27225");
  assert.ok(!(await evp.$("#nextGame")), "there is no 'next game' step: the same words are reused");
  await evp.waitForTimeout(2200); await shot(evp, "host-new-game");
  const before = await cardOf(pls[0].p);

  await evp.click("#newGame");                                    // same code, same words, new cards
  await evp.waitForSelector("#lobby.active");
  assert.equal((await evp.textContent("#bigCode")).trim(), code2, "the code stays the same");
  assert.equal((await evp.textContent("#gameLabel")).trim(), "Game 2");
  await pls[0].p.waitForFunction(() => document.querySelectorAll("#grid .cell").length === 25 && !document.querySelector(".banner"));
  for (const pl of pls) assert.ok((await cardOf(pl.p)).every((w, i) => i === 12 || /^Alpha \d+$/.test(w)), pl.who + " still has the livestream's words");
  assert.notDeepEqual(await cardOf(pls[0].p), before, "but a fresh card");
  assert.match(await pls[0].p.textContent("#eligNote"), /play for fun/, "last game's winner may play on but not win again");
  await evp.click("#startBtn", { force: true });
  await playUntilWin("Cousin Sam");                              // a username player can win
  await evp.waitForSelector("#win.show");
  assert.equal((await evp.textContent("#winnerName")).trim(), "Cousin Sam");

  // results across both games
  await evp.click("#winResults");
  await evp.waitForSelector("#results.active");
  assert.equal((await evp.$$("#winList li")).length, 2);
  let t = await evp.textContent("#winList");
  assert.ok(t.includes("Game 1: Robinson-27225") && t.includes("Game 2: Cousin Sam"), t);
  let mk = await evp.inputValue("#markup");
  assert.ok(mk.includes("|Robinson-27225||") && mk.includes("| ||Cousin Sam||||"), "both games' winners are in the rows");
  await evp.waitForTimeout(400); await shot(evp, "event-results");
  await evp.click("#winList li:first-child input");                // leave the first one out
  assert.ok(!(await evp.inputValue("#markup")).includes("Robinson-27225"));
  await evp.click("#winList li:first-child input");
  await evp.click("#copyMarkup");
  await evp.waitForFunction(() => document.querySelectorAll("#winList li.copied").length === 2);
  assert.equal(await evp.inputValue("#markup"), "", "copied rows are not offered again");
  await evp.click("#resBack"); await evp.waitForSelector("#win.show");
  await evp.click("#newGame"); await evp.waitForSelector("#lobby.active");

  // back to the event: both games show their winners; export and import round trip
  await evp.click("#backToEvent"); await evp.waitForSelector("#event.active");
  assert.match(await evp.textContent("#evPlayed"), /Game 1 won by Robinson-27225/);
  assert.match(await evp.textContent("#evPlayed"), /Game 2 won by Cousin Sam/);
  assert.equal(await evp.textContent("#evResults"), "Results (2)");
  const [dl] = await Promise.all([evp.waitForEvent("download"), evp.click("#evExport")]);
  assert.match(dl.suggestedFilename(), /^wikitree-days-2026\.wikitree-bingo\.json$/);
  const file = path.join(require("node:os").tmpdir(), "e2e-event.json"); await dl.saveAs(file);
  await evp.click("#evBack");
  await evp.setInputFiles("#importFile", file);
  await evp.waitForSelector("#event.active");
  assert.equal(await evp.textContent("#evTitle"), "WikiTree Days 2026 (2)");
  assert.equal(await evp.textContent("#wordsMeta"), "24 words");
  assert.equal(await evp.textContent("#evResults"), "Results (2)");
  await evp.setInputFiles("#importFile", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from("nope") }).catch(() => {});
  // ============ an event saved by v0.4.0 / v0.4.1 (several games) is split into one event per game ============
  const mig = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  mig.on("pageerror", e => { throw e; });
  const w30 = n => Array.from({ length: 30 }, (_, i) => `${n} ${i + 1}`);
  await mig.addInitScript(old => { if (!localStorage.getItem("wtbingo-events")) localStorage.setItem("wtbingo-events", JSON.stringify(old)); }, [{
    id: "abc123def", name: "Old event", created: "2026-10-01T00:00:00Z", prize: null,
    games: [{ id: "g1aaaa", name: "Game one", words: w30("Old A") }, { id: "g2bbbb", name: "Game two", words: w30("Old B") }],
    winners: [{ id: "w1", gameId: "g2bbbb", game: "Game two", round: 1, name: "Peasley-221", kind: "id", word: "x", at: "2026-10-02T00:00:00Z" }],
  }]);
  await mig.goto(`${SITE}/host.html?${q}`);
  assert.deepEqual(await mig.$$eval("#eventList .row .name", n => n.map(x => x.textContent).sort()), ["Old event: Game one", "Old event: Game two"]);
  assert.deepEqual(await mig.$$eval("#eventList .row .meta", n => n.map(x => x.textContent).sort()), ["30 words · 0 winners", "30 words · 1 winner"]);
  await mig.reload();                                             // saved in the new shape: nothing doubles up
  assert.equal((await mig.$$("#eventList .row")).length, 2);

  // ============ ending a game ============
  const h3 = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  h3.on("pageerror", e => { throw e; }); h3.on("dialog", d => d.accept());
  const quickLobby = async () => {
    await h3.goto(`${SITE}/host.html?${q}&fast`); await h3.click("#quickGame");
    await h3.fill("#paste", words24); await h3.click("#openLobby"); await h3.waitForSelector("#lobby.active");
    const c = (await h3.textContent("#bigCode")).trim();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    p.on("pageerror", e => { throw e; });
    await p.goto(`${SITE}/player.html?g=${c}&${q}`); await p.fill("#who", "Quitter-1"); await p.click("#joinBtn"); await p.waitForSelector("#game:not(.hidden)");
    await h3.waitForFunction(() => document.getElementById("lobbyCount").textContent === "1");
    return { c, p };
  };
  const endedFor = async p => { await p.waitForSelector("#ended:not(.hidden)", { timeout: 8000 }); assert.match(await p.textContent("#ended"), /host ended this game/); };
  const gone = c => new Promise((resolve, reject) => {          // a closed room refuses new connections
    const ws = new WebSocket(WORKER.replace(/^http/, "ws") + "/ws/" + c);
    const t = setTimeout(() => reject(new Error("room " + c + " is still reachable")), 8000);
    ws.onopen = () => { clearTimeout(t); ws.close(); reject(new Error("room " + c + " is still open")); };
    ws.onerror = ws.onclose = () => { clearTimeout(t); resolve(); };
  });

  // 1. from the lobby of a quick game
  let g1 = await quickLobby();
  await h3.click("#endQuick");
  await h3.waitForSelector("#home.active");
  await endedFor(g1.p);
  assert.ok(await h3.$eval("#resumeBox", e => e.classList.contains("hidden")), "nothing left to resume");
  assert.equal(await h3.evaluate(() => localStorage.getItem("wtbingo-room")), null);
  await gone(g1.c);

  // 2. from the stage, mid-game
  g1 = await quickLobby();
  await h3.click("#startBtn", { force: true }); await h3.waitForSelector("#stage.active");
  await h3.waitForFunction(() => document.querySelectorAll("#ribbon .chip").length === 1, null, { timeout: 15000 });
  await shot(h3, "host-end-game");
  await h3.click("#endGame");
  await h3.waitForSelector("#home.active");
  await endedFor(g1.p);
  await gone(g1.c);

  // 3. a game left open in the browser: the resume box can close it for good
  g1 = await quickLobby();
  await h3.reload();
  await h3.waitForSelector("#resumeBox:not(.hidden)");
  assert.match(await h3.textContent("#resume"), new RegExp("Resume game " + g1.c));
  await shot(h3, "host-resume-box");
  await h3.click("#discardSaved");
  await h3.waitForSelector("#resumeBox.hidden", { state: "attached" });
  await endedFor(g1.p);
  await h3.reload();
  assert.ok(await h3.$eval("#resumeBox", e => e.classList.contains("hidden")), "the closed game stays closed after a reload");
  await gone(g1.c);

  // 4. a prepared game: End game returns to its event
  await h3.click("#newEvent"); await h3.fill("#nameInput", "Cancel test"); await h3.click("#nameOk"); await h3.waitForSelector("#event.active");
  await h3.click("#editWords"); await h3.fill("#gPaste", words24); await h3.click("#gSave");
  await h3.click("#goLive"); await h3.waitForSelector("#lobby.active");
  await h3.click("#backToEvent"); await h3.waitForSelector("#event.active");
  assert.equal(await h3.textContent("#evTitle"), "Cancel test");

  console.log("E2E OK  code=%s winner=%s", code, winner.who);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
