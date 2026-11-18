'use strict';
// @slow
// T70: scroll sensitivity with REAL wheel events at three pane sizes (a 4-pane grid cell, a full pane at 1100x700, a full pane at 1920x1080) and two font sizes:
// one mouse notch moves about 12% of the visible rows of THAT pane (3..12 lines), a trackpad delta moves its real pixel distance, Alt is x5.
const path = require('path');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('scroll sensitivity follows the pane size');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '80', DEMO_FILL: '200' } });
  const keeper = await connect(srv.port);
  for (let i = 0; i < 4; i++) keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'P' + i });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1100, height: 700 });
  const { ev } = page;
  await page.appReady(4);
  await page.waitFor(`import('/js/state.js').then(({ state }) => [...state.panes.values()].every((p) => p.term.buffer.active.baseY > 150))`, 60000);
  const first = await ev(`import('/js/state.js').then(({ state }) => state.order[0])`);
  const info = () => ev(`import('/js/state.js').then(async ({ state }) => { const p = state.panes.get('${first}'); const r = p.el.querySelector('.xterm-screen').getBoundingClientRect(); return { rows: p.term.rows, cellH: r.height / p.term.rows, x: r.left + r.width / 2, y: r.top + r.height / 2, y0: p.term.buffer.active.viewportY, base: p.term.buffer.active.baseY, font: p.term.options.fontSize }; })`);
  const bottom = () => ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${first}').term.scrollToBottom(); return true; })`);
  const y = () => ev(`import('/js/state.js').then(({ state }) => state.panes.get('${first}').term.buffer.active.viewportY)`);
  const wheel = (i, dy, modifiers = 0) => page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: i.x, y: i.y, deltaX: 0, deltaY: dy, modifiers });
  const settle = async () => { let a = await y(); for (let k = 0; k < 20; k++) { await sleep(120); const b = await y(); if (b === a) break; a = b; } return a; };
  const notchAt = async (label) => {
    await bottom(); await settle();
    const i = await info();
    await wheel(i, -100);
    const moved = i.y0 - (await settle());
    console.log(`NOTCH ${label}: rows ${i.rows}, cell ${i.cellH.toFixed(1)} px, font ${i.font}: ${moved} lines per notch`);
    return { ...i, moved };
  };
  const expected = (rows) => Math.max(3, Math.min(12, Math.round(rows * 0.12)));

  const small = await notchAt('4-pane grid cell, 1100x700');
  t.check('a grid cell scrolls linesPerNotch(its rows) per mouse notch', small.moved === expected(small.rows), JSON.stringify(small));
  await ev(`import('/js/layout.js').then((m) => { m.setExpanded('${first}'); return true; })`);
  await sleep(800);
  const mid = await notchAt('full pane, 1100x700');
  t.check('a full pane at 1100x700 scrolls linesPerNotch(its rows) per notch', mid.moved === expected(mid.rows), JSON.stringify(mid));
  await page.resize(1920, 1080);
  await sleep(800);
  const big = await notchAt('full pane, 1920x1080');
  t.check('a full pane at 1920x1080 scrolls linesPerNotch(its rows) per notch', big.moved === expected(big.rows), JSON.stringify(big));
  t.check('the bigger the pane, the more lines per notch (grid cell < full 1100 pane <= full 1920 pane) and never more than 12', small.moved < mid.moved && mid.moved <= big.moved && big.moved <= 12, `${small.moved} < ${mid.moved} <= ${big.moved}`);

  for (const fs of [11, 18]) {
    await ev(`import('/js/settings.js').then((m) => { m.setSetting('terminal.fontSize', ${fs}); return true; })`);
    await sleep(900);
    const r = await notchAt(`font ${fs}, 1920x1080`);
    t.check(`font size ${fs}: the notch follows the visible rows of the pane (${r.rows} rows)`, r.moved === expected(r.rows), JSON.stringify(r));
  }
  await ev(`import('/js/settings.js').then((m) => { m.setSetting('terminal.fontSize', 14); return true; })`);
  await sleep(900);

  // Alt = x5
  await bottom(); await settle();
  let i = await info();
  await wheel(i, -100, 1);
  const fast = i.y0 - (await settle());
  t.check('Alt multiplies a notch by 5', fast === Math.min(i.base, expected(i.rows) * 5), `${fast} vs ${expected(i.rows) * 5}`);

  // trackpad: 60 events of 3 px = 180 px
  await bottom(); await settle();
  i = await info();
  for (let k = 0; k < 60; k++) { await wheel(i, -3); await sleep(8); }
  const tp = i.y0 - (await settle());
  const wantLines = Math.trunc(180 / i.cellH);
  console.log(`TRACKPAD 60 x 3 px = 180 px: ${tp} lines (about ${wantLines} expected at ${i.cellH.toFixed(1)} px per line)`);
  t.check('a trackpad scroll of 180 px in 3 px events moves about 180 px worth of lines (smooth, fractional remainder carried)', Math.abs(tp - wantLines) <= 1, `${tp} vs ${wantLines}`);
  await bottom(); await settle();
  await wheel(i, -3);
  t.check('a single 3 px delta does not jump a whole notch', (await settle()) === i.base || i.base - (await y()) === 0);

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
