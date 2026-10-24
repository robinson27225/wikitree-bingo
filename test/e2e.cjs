// End-to-end check: one host and three players against a local Worker and static server.
//   npm run dev:worker   (port 8787)      npm run serve   (port 8000)      node test/e2e.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const SITE = process.env.SITE || "http://127.0.0.1:8000";
const WORKER = process.env.WORKER || "http://127.0.0.1:8787";
const SHOTS = process.env.SHOTS || "";           // directory for screenshots, optional
const q = `worker=${encodeURIComponent(WORKER)}`;
const words24 = Array.from({ length: 24 }, (_, i) => "Word " + String.fromCharCode(65 + i)).join("\n");

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const norm = s => s.trim().toLowerCase();

(async () => {
  const browser = await chromium.launch();
  const ctxH = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await ctxH.newPage();
  host.on("pageerror", e => { throw e; });

  // ---- host: words -> lobby ----
  await host.goto(`${SITE}/host.html?${q}&fast`);
  await host.fill("#paste", "Words\n" + words24 + "\nWord A");           // header and a duplicate
  assert.match(await host.textContent("#count"), /^24 words found/);
  await host.click("#openLobby");
  await host.waitForSelector("#lobby.active");
  assert.match(await host.textContent("#joinUrl"), /wikitree\.s\.gy\/bingo/, "lobby shows the short link");
  const code = (await host.textContent("#bigCode")).trim();
  assert.match(code, /^[A-Z2-9]{4}$/);

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
  called.push(norm(await host.textContent("#ribbon .chip:last-child")).replace(/^\d+/, ""));
  await shot(host, "host-stage");

  // tapping an undrawn word does not daub; tapping a drawn one does, and again removes it
  const p0 = players[0].p;
  await p0.waitForFunction(() => document.getElementById("status").textContent.includes("Last word"));
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

  // a premature claim is refused
  await p0.click("#bingoBtn");
  await p0.waitForSelector(".banner.warn");

  // draw until somebody has a complete line, daubing as we go
  const LINES = []; for (let r = 0; r < 5; r++) LINES.push([0,1,2,3,4].map(c => r*5+c));
  for (let c = 0; c < 5; c++) LINES.push([0,1,2,3,4].map(r => r*5+c));
  LINES.push([0,6,12,18,24],[4,8,12,16,20]);
  let winner = null, shotWin = false;
  for (let n = 1; n <= 24 && !winner; n++) {
    if (n > 1) { await host.click("#nextBtn"); await waitCalled(n); }
    const word = norm((await host.textContent("#ribbon .chip:last-child")).replace(/^\d+/, ""));
    for (const pl of players) {
      await pl.p.waitForFunction(w => document.getElementById("status").textContent.toLowerCase().includes(w), word);
      const card = await cardOf(pl.p);
      const i = card.findIndex(w => norm(w) === word);
      const daubed = await pl.p.$$eval("#grid .cell", cs => cs.map(c => !!c.querySelector(".daub")));
      if (i >= 0 && !daubed[i]) { await (await pl.p.$$("#grid .cell"))[i].click(); daubed[i] = true; }
      pl.daubed = daubed; pl.card = card;
      if (!winner && LINES.some(l => l.every(k => k === 12 || daubed[k]))) winner = pl;
    }
    if (n === 6 && !shotWin) { shotWin = true; await shot(players[0].p, "player-daubed"); await shot(host, "host-stage-6"); }
  }
  assert.ok(winner, "someone should complete a line by the time all 24 words are drawn");

  await winner.p.click("#bingoBtn");
  await host.waitForSelector("#win.show");
  await host.waitForFunction(() => document.querySelectorAll(".bingos div.go").length === 3, null, { timeout: 8000 });
  assert.equal((await host.textContent("#winnerName")).trim(), winner.who);
  await host.waitForTimeout(2200);
  await shot(host, "host-winner");
  await winner.p.waitForSelector(".banner.win");
  for (const pl of players) if (pl !== winner) await pl.p.waitForSelector(".banner.lose");

  // ---- new game: fresh cards, back to lobby ----
  await host.click("#newGame");
  await host.waitForSelector("#lobby.active");
  await winner.p.waitForFunction(() => !document.querySelector(".banner"));
  assert.notDeepEqual(await cardOf(winner.p), winner.card, "new game deals a new card");
  console.log("E2E OK  code=%s winner=%s", code, winner.who);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
