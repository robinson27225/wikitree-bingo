// Shrink text until it fits inside a box without breaking words.
// `el` holds the text and sits inside `box`; fw/fh are the fractions of the box's width
// and height the text may use (less than 1 for round boxes or padding).
export function fitText(el, box, { fw = 1, fh = 1, max = 200, min = 6 } = {}) {
  const w = box.clientWidth * fw, h = box.clientHeight * fh;
  if (!w || !h) return;
  el.style.width = w + "px";
  let lo = min, hi = Math.max(min, max);
  const fits = px => { el.style.fontSize = px + "px"; return el.scrollWidth <= w + 0.5 && el.scrollHeight <= h + 0.5; };
  if (fits(hi)) return;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + "px";
}
