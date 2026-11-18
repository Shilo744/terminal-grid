'use strict';
// T70: wheel sensitivity maths (pure): a notch = about 12% of the visible rows (3..12), a trackpad delta = its real pixel distance, Alt = x5.
const path = require('path');
const { pathToFileURL } = require('url');
const { checker } = require('../lib/harness');

(async () => {
  const t = checker('wheel sensitivity (unit)');
  const { wheelLines, linesPerNotch } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'wheel.js')).href);
  t.check('lines per notch: 12% of the rows, at least 3, at most 12', [10, 25, 40, 60, 100, 200].map(linesPerNotch).join() === '3,3,5,7,12,12', [10, 25, 40, 60, 100, 200].map(linesPerNotch).join());
  const notch = (rows, extra = {}) => wheelLines({ deltaY: 100, deltaMode: 0, altKey: false, ...extra }, { rows, cellH: 17, carry: 0 });
  t.check('one 100 px mouse notch scrolls linesPerNotch(rows) lines, down; negative = up', notch(40).lines === 5 && notch(40, { deltaY: -100 }).lines === -5 && notch(100).lines === 12 && notch(12).lines === 3);
  t.check('a bigger pane scrolls more lines per notch than a small one', notch(60).lines > notch(20).lines);
  t.check('a line-mode wheel (deltaMode 1, 3 lines = one click) is one notch too', wheelLines({ deltaY: 3, deltaMode: 1, altKey: false }, { rows: 40, cellH: 17, carry: 0 }).lines === 5);
  t.check('two notches in one event scroll two notches', notch(40, { deltaY: 200 }).lines === 10);
  t.check('Alt multiplies by 5', notch(40, { altKey: true }).lines === 25);
  // טראקפד: פיקסלים אמיתיים עם שארית
  let carry = 0, moved = 0;
  for (let i = 0; i < 17; i++) { const r = wheelLines({ deltaY: 3, deltaMode: 0, altKey: false }, { rows: 40, cellH: 17, carry }); carry = r.carry; moved += r.lines; }
  t.check('17 trackpad events of 3 px move 3 lines (51 px at 17 px per line) with no jumps, the remainder carried', moved === 3 && Math.abs(carry) < 1e-9 || (moved === 2 && carry > 0.99), `moved ${moved} carry ${carry}`);
  carry = 0; moved = 0; let maxStep = 0;
  for (let i = 0; i < 200; i++) { const r = wheelLines({ deltaY: 3, deltaMode: 0, altKey: false }, { rows: 40, cellH: 17, carry }); carry = r.carry; moved += r.lines; maxStep = Math.max(maxStep, r.lines); }
  t.check('200 events of 3 px (600 px) move 35 lines (600 / 17), one line at a time at most', moved === 35 && maxStep === 1, `moved ${moved} maxStep ${maxStep}`);
  t.check('a 3 px delta alone moves nothing yet (it is a fraction of a line), but is not lost', wheelLines({ deltaY: 3, deltaMode: 0, altKey: false }, { rows: 40, cellH: 17, carry: 0 }).lines === 0);
  const up = wheelLines({ deltaY: -3, deltaMode: 0, altKey: false }, { rows: 40, cellH: 17, carry: 0.9 });
  t.check('reversing direction drops the old remainder (no kick the other way)', up.lines === 0 && up.carry < 0);
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
