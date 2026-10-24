# WikiTree Bingo

A live bingo game for WikiTree events. The host runs a livecast screen: a spinning bingo cage draws one word at a time, and everyone plays on their own card from a phone, tablet or desktop.

- **Host** (`host.html`): upload a CSV of words, open a lobby, press the START logo, then click **Next word** for each draw. Every word drawn stays across the top, the player count is always visible, and a verified BINGO takes over the screen with the winner's WikiTree ID or username and a **Start new game** button.
- **Player** (`player.html`): join with a 4-letter code using a WikiTree ID or just a username. Each player gets a different random card, with the WikiTree logo as the free space. Tap a word that has been drawn to daub it, tap again to undo. Press **BINGO!** when you have a line.

The pages are static files. A small Cloudflare Worker with a Durable Object relays the draws and checks every BINGO claim against the words actually drawn.

## Running a game
Short link: https://wikitree.s.gy/bingo

1. Make a CSV with one word or phrase per row (the first column is used, a header row is fine). You need at least 24 words. Use 40 or more so players get genuinely different cards.
2. Open the host page, drop in the CSV, and choose **Open lobby**. Share the join link or the 4-letter code on your stream.
3. When players have joined, press the **START** logo, then **Next word** for each draw.
4. When someone wins, the host screen celebrates. Choose **Start new game** to deal everyone fresh cards.

## Deploying
1. **Worker.** You need a free Cloudflare account.
   ```
   npm install
   npx wrangler login
   npm run deploy:worker
   ```
   Edit `ALLOWED_ORIGINS` in `worker/wrangler.toml` to match the site that serves the pages (for GitHub Pages, `https://<user>.github.io`).
2. **Point the pages at it.** The deployed Worker URL is the default in `shared/config.js` (`WORKER_URL`); change it there if you redeploy under another name. Any page also accepts `?worker=https://…` to override it.
3. **Pages.** Publish the repo root with GitHub Pages (Settings, Pages, branch `main`, folder `/`).

## Prize eligibility
Anyone who won a prize in the last 6 months can play but can't win. The list comes from WikiTree's [Prize Winners](https://www.wikitree.com/wiki/Space:Prize_Winners) page. WikiTree's bot protection stops servers from reading its pages automatically, so the host pastes the page in once per game:

1. In the lobby, choose **Add the Prize Winners list**.
2. Open the Prize Winners page in your own browser, press Ctrl+A (Cmd+A on a Mac), then Ctrl+C.
3. Paste into the box and choose **Use this list**. Anything that isn't a winner is ignored, and the lobby shows how many WikiTree IDs can't win.

How it counts: the date heading above each event's table (for example "2-5 October 2026") is the event's date, and 6 calendar months are counted back from its last day. Everyone in the Current Event Winners table counts too. If a heading has a date that can't be read, those winners are not excluded and the host is told which heading was skipped.

- A player who joined with a **WikiTree ID** on the list can play but cannot win. They see a note on their card, their real BINGO is skipped with an explanation, the host screen shows a short notice, and the game carries on.
- Players who joined with just a **username** are not checked.
- Someone who wins during a session can't win again later in that same session.
- If no list is added, the game still runs, and the lobby warns that eligibility is not being checked.
- The list lasts for the whole game room, across new rounds. Update it any time from the lobby.

## Local development and tests
```
npm run dev:worker      # Worker on http://127.0.0.1:8787
npm run serve           # static pages on http://127.0.0.1:8000, open them with ?worker=http://127.0.0.1:8787
npm test                # unit tests for shared/bingo.js
node test/e2e.cjs       # one host + three players, full game (needs Playwright)
```
`host.html?fast` shortens the cage spin; the end-to-end test uses it.

## How it works
- `shared/bingo.js` holds the pure logic used by both the browser and the Worker: CSV parsing, card dealing, and claim checking.
- A claim wins when a row, column or diagonal is made up of the free space and words that are both **drawn** and **daubed** by that player.
- A drawn word is only sent to players after the host's spin finishes, so nobody sees it before the stream does.
- Cards are dealt with crypto randomness, and the Worker avoids issuing the same card twice. A refresh or dropped connection restores the same card and daubs.
- Rooms are deleted after 24 hours of inactivity.

## Credits
Look, feel and the drum roll and applause sounds follow the WikiTree Marathon Drawing tool. Made by [Robinson-27225](https://www.wikitree.com/wiki/Robinson-27225) on WikiTree.
