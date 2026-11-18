'use strict';
// T79: where the app window opens: 85 percent of the primary work area, centred, never bigger than the work area, same result at 100/125/150 percent scaling.
const path = require('path');
const { execFileSync } = require('child_process');
const { checker } = require('../lib/harness');
const { place, toDip } = require('../../scripts/window-placement');

const t = checker('centred app window (unit)');
const centred = (wa, p) => Math.abs((p.x - wa.x) - (wa.x + wa.w - (p.x + p.w))) <= 1 && Math.abs((p.y - wa.y) - (wa.y + wa.h - (p.y + p.h))) <= 1;

let wa = { x: 0, y: 0, w: 1920, h: 1040 }; // 1920x1080 minus a 40 px taskbar
let p = place(wa);
t.check('1920x1080 with a taskbar: 85 percent, centred in the WORK area (not under the taskbar)', p.w === 1632 && p.h === 884 && p.x === 144 && p.y === 78 && centred(wa, p), JSON.stringify(p));
wa = { x: 0, y: 0, w: 1366, h: 728 };
p = place(wa);
t.check('a small 1366x768 screen: the 1100x720 minimum wins over 85 percent (1161x619) only where it fits: height is capped at the work area', p.w === 1161 && p.h === 720 && p.y === 4 && centred(wa, p), JSON.stringify(p));
wa = { x: 0, y: 0, w: 1024, h: 600 };
p = place(wa);
t.check('a tiny screen: never larger than the work area, filling it', p.w === 1024 && p.h === 600 && p.x === 0 && p.y === 0, JSON.stringify(p));
wa = { x: 0, y: 0, w: 3440, h: 1400 };
p = place(wa);
t.check('an ultrawide: 85 percent of the width, centred', p.w === 2924 && p.h === 1190 && centred(wa, p), JSON.stringify(p));
wa = { x: 0, y: 40, w: 1920, h: 1040 }; // taskbar at the top
p = place(wa);
t.check('a taskbar at the top: the window starts below it', p.y === 40 + Math.round((1040 - p.h) / 2) && centred(wa, p), JSON.stringify(p));
// DPI: the same physical 3840x2160 screen (minus an 80 px taskbar) at 100, 125 and 150 percent: the window is centred on screen in every case and keeps 85 percent
for (const scale of [1, 1.25, 1.5]) {
  const physical = { x: 0, y: 0, w: 3840, h: 2080 };
  const dip = toDip(physical, scale);
  const q = place(dip);
  t.check(`DPI ${scale * 100}%: centred, 85 percent of the work area (${dip.w}x${dip.h} DIP)`, centred(dip, q) && Math.abs(q.w - dip.w * 0.85) <= 1 && q.w >= Math.min(1100, dip.w), JSON.stringify({ dip, q }));
}
// second monitor to the left (negative x): the position is relative to the work area it was given
wa = { x: -1920, y: 0, w: 1920, h: 1040 };
p = place(wa);
t.check('a work area that starts at a negative x (monitor on the left) is centred inside itself', p.x === -1920 + 144 && centred(wa, p), JSON.stringify(p));
// the command line the launcher uses
const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'window-placement.js'), '0', '0', '1920', '1040'], { encoding: 'utf8' }).trim();
t.check('the command line prints "W,H,X,Y" for the launcher', out === '1632,884,144,78', out);
let bad = 0;
try { execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'window-placement.js'), 'a', 'b'], { stdio: 'ignore' }); } catch (e) { bad = e.status; }
t.check('bad arguments exit with an error code (the launcher then opens without a position)', bad === 2, String(bad));
process.exit(t.finish() ? 0 : 1);
