'use strict';
/*
 * Where the app window opens (T79). start.ps1 calls this with the work area of the primary monitor (no taskbar) and passes the answer to Chrome as
 * --window-size / --window-position, but ONLY when the browser profile has no saved window placement (the user moved or resized it on purpose otherwise).
 *
 *   node scripts/window-placement.js <x> <y> <width> <height>     prints "W,H,X,Y"
 *
 * The work area is given the way a DPI-unaware process sees it (device-independent pixels, which is what Chrome's flags use), so the scaling (100/125/150 percent)
 * is already inside the numbers: at 125 percent a 3840x2160 screen is 3072x1728 here. toDip() converts physical pixels for callers that have those.
 * W,H = 85 percent of the work area, at least 1100x720 but never larger than the work area; centred in the work area.
 */
const SHARE = 0.85;
const MIN_W = 1100, MIN_H = 720;

const toDip = (rect, scale) => ({ x: Math.round(rect.x / scale), y: Math.round(rect.y / scale), w: Math.round(rect.w / scale), h: Math.round(rect.h / scale) });

function place(wa) {
  const w = Math.max(0, Math.round(wa.w)), h = Math.max(0, Math.round(wa.h));
  const W = Math.min(w, Math.max(Math.min(MIN_W, w), Math.round(w * SHARE)));
  const H = Math.min(h, Math.max(Math.min(MIN_H, h), Math.round(h * SHARE)));
  return { w: W, h: H, x: Math.round(wa.x + (w - W) / 2), y: Math.round(wa.y + (h - H) / 2) };
}

module.exports = { place, toDip, SHARE, MIN_W, MIN_H };

if (require.main === module) {
  const [x, y, w, h] = process.argv.slice(2).map(Number);
  if ([x, y, w, h].some((n) => !Number.isFinite(n)) || w <= 0 || h <= 0) { console.error('usage: node window-placement.js <x> <y> <width> <height>'); process.exit(2); }
  const p = place({ x, y, w, h });
  console.log(`${p.w},${p.h},${p.x},${p.y}`);
}
