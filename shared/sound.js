// Drum roll while the cage spins and applause for a win. Adapted from the Sound module in
// the WikiTree Marathon Drawing tool (robinson27225/wikitree-prize-draw).
import { ASSETS, ROLL_LOOP } from "./audio-assets.js";

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("wtbingo-" + k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("wtbingo-" + k, JSON.stringify(v)); } catch (e) {} }
};

export const Sound = (() => {
  const prefs = { on: store.get("soundOn") !== false };
  let ctx = null, bus = null, buffers = {}, roll = null, applause = null;
  const b64ToBuf = b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

  function unlock() {                                    // must run inside a click
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const lim = ctx.createDynamicsCompressor();      // limiter so loud moments never distort
        lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
        bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(lim); lim.connect(ctx.destination);
        for (const [k, b64] of Object.entries(ASSETS)) ctx.decodeAudioData(b64ToBuf(b64)).then(b => buffers[k] = b).catch(() => {});
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) {}
  }
  function play(buf, vol, o = {}) {
    const src = ctx.createBufferSource(); src.buffer = buf;
    if (o.loop) { src.loop = true; src.loopStart = o.loop[0]; src.loopEnd = Math.min(o.loop[1], buf.duration); }
    const gain = ctx.createGain(); gain.gain.value = vol;
    src.connect(gain); gain.connect(bus); src.start();
    return { src, gain };
  }
  function fadeOut(h, secs) {
    if (!h || !ctx) return;
    try { const now = ctx.currentTime; h.gain.gain.cancelScheduledValues(now); h.gain.gain.setValueAtTime(h.gain.gain.value, now); h.gain.gain.linearRampToValueAtTime(0, now + secs); h.src.stop(now + secs + 0.05); } catch (e) {}
  }
  const ready = () => prefs.on && ctx && ctx.state !== "closed";

  return {
    prefs, unlock,
    save() { store.set("soundOn", prefs.on); },
    startSpin() { this.stopAll(0.05); if (ready() && buffers.roll) roll = play(buffers.roll, 0.95, { loop: ROLL_LOOP }); },
    landed() { fadeOut(roll, 0.15); roll = null; },
    cheer() { if (ready() && buffers.applause) applause = play(buffers.applause, 0.85); },
    stopAll(secs = 0.3) { fadeOut(roll, secs); fadeOut(applause, secs); roll = null; applause = null; }
  };
})();
