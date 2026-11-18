'use strict';
// T52: while a pane that is NOT focused is scrolled with the mouse wheel (grid mode), the RTL canvas must be redrawn in the same
// frame as the terminal. Otherwise the new rows (left-aligned, from xterm) and the old canvas rows (mirrored) are visible together.
// Measured per render: the viewport the layer last drew must equal the viewport xterm just rendered.
const path = require('path');
const { FIXTURES, TMP, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('RTL layer while scrolling a non-focused pane');
  const srv = await startServer({ stateFile: path.join(TMP, 'rtl-scroll-state.json'), binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '60', DEMO_FILL: '120' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'B' });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  const { ev } = page;
  await page.waitFor(`document.querySelectorAll('.tg-rtl').length === 2`, 30000);
  // ההיסטוריה צריכה להתמלא (120 פסקאות) לפני שגוללים
  await page.waitFor(`import('/js/state.js').then(({ state }) => [...state.panes.values()].every((p) => p.term.buffer.active.baseY > 100))`, 30000);

  // B ממוקד (לוחצים עליו); A הוא הפאן שגוללים בלי להתמקד בו
  const rects = await ev(`(() => [...document.querySelectorAll('.pane')].map((p) => { const r = p.querySelector('.xterm-screen').getBoundingClientRect(); return { id: p.dataset.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }))()`);
  t.check('two Claude panes are on screen', rects.length === 2, JSON.stringify(rects));
  const [a, b] = rects;
  await page.mouse('mousePressed', b.x, b.y); await page.mouse('mouseReleased', b.x, b.y);
  await sleep(300);
  await ev(`import('/js/state.js').then(({ state }) => { window.__bad = 0; window.__renders = 0; window.__y0 = null;
    const p = state.panes.get('${a.id}'); window.__y0 = p.term.buffer.active.viewportY; window.__p = p;
    p.term.onRender(() => { window.__renders++; if (p.rtl.drawnViewportY !== p.term.buffer.active.viewportY) window.__bad++; }); return true; })`);
  t.check('the scrolled pane is not the focused one', (await ev(`import('/js/state.js').then(({ state }) => state.focusId)`)) === b.id);

  // גלגלת אמיתית על A, 60Hz, דלתאות קטנות כמו משטח מגע
  for (let i = 0; i < 60; i++) {
    await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: a.x, y: a.y, deltaX: 0, deltaY: -40 });
    await sleep(16);
  }
  await sleep(400);
  const res = await ev('({ bad: window.__bad, renders: window.__renders, moved: window.__y0 - window.__p.term.buffer.active.viewportY })');
  t.check('the wheel really scrolled the pane and it rendered many times', res.moved > 10 && res.renders > 5, JSON.stringify(res));
  t.check('every render of the scrolled pane had the RTL layer drawn for the same rows (no old canvas rows next to new terminal rows)', res.bad === 0, JSON.stringify(res));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
