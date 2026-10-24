// Small reconnecting WebSocket wrapper used by both pages.
import { wsUrl } from "./config.js";

// onStatus(state, failures): state is "connecting" | "open" | "closed"; failures counts
// consecutive connections that closed without ever opening (a bad code or host key).
export function connect(path, { onOpen, onMessage, onStatus }) {
  let ws = null, closed = false, attempt = 0, failures = 0, timer = null;

  function open() {
    onStatus && onStatus("connecting", failures);
    ws = new WebSocket(wsUrl(path));
    let opened = false;
    ws.onopen = () => { opened = true; attempt = 0; failures = 0; onStatus && onStatus("open", 0); onOpen && onOpen(); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMessage(m); };
    ws.onclose = () => {
      if (closed) return;
      if (!opened) failures++;
      onStatus && onStatus("closed", failures);
      const delay = Math.min(8000, 500 * 2 ** attempt++);
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  open();

  return {
    send(msg) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; } return false; },
    close() { closed = true; clearTimeout(timer); try { ws.close(); } catch (e) {} }
  };
}

export async function createRoom(workerUrl, words) {
  const res = await fetch(workerUrl + "/api/rooms", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not create the game (" + res.status + ")");
  return body;
}

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("wtbingo-" + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("wtbingo-" + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem("wtbingo-" + k); } catch (e) {} }
};
