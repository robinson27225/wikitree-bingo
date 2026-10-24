export const TOOL_NAME = "WikiTree Bingo";
export const VERSION = "0.2.0";
export const AUTHOR_URL = "https://www.wikitree.com/wiki/Robinson-27225";
export const AUTHOR_ID = "Robinson-27225";

// Short link shown to players on the host lobby. It opens the player page (or the landing
// page); players then type the 4-letter game code.
export const SHORT_URL = "https://wikitree.s.gy/bingo";

// Base URL of the deployed Cloudflare Worker (see README). Override without editing this
// file by opening a page with ?worker=...  e.g. ?worker=http://127.0.0.1:8787 for local dev.
const param = (() => { try { return new URLSearchParams(location.search).get("worker"); } catch (e) { return null; } })();
export const WORKER_URL = (param || "https://wikitree-bingo.wikitreebingo.workers.dev").replace(/\/+$/, "");

// WikiTree brand palette
export const PALETTE = {
  gold: "#FCB815", orange: "#f37c26", lime: "#8FC641", leaf: "#A5D167", pale: "#E1F0B4",
  forest: "#25422D", butter: "#FFEE99", yellow: "#FFE270", honey: "#FAD158"
};
export const BALL_COLORS = ["#FCB815", "#f37c26", "#FFE270", "#8FC641", "#FAD158", "#A5D167"];

export function wsUrl(path) { return WORKER_URL.replace(/^http/, "ws") + path; }

export function renderFooter(el) {
  el.innerHTML =
    `<a class="foot-logo" href="https://www.wikitree.com/" target="_blank" rel="noopener"><img src="assets/logo-full.png" alt="WikiTree: Where genealogists collaborate"></a>` +
    `<a class="foot-tool" href="${AUTHOR_URL}" target="_blank" rel="noopener">${TOOL_NAME} v${VERSION} &middot; ${AUTHOR_ID}</a>`;
}
