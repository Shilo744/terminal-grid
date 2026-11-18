'use strict';
// T52: wheel scrolling is animated (small steps per frame instead of 3-4 lines at once) while everything that must be instant stays instant:
// programmatic jumps (renderer swap restore), following new output at the bottom, and a view the user scrolled up not being dragged by output.
const path = require('path');
const { FIXTURES, TMP, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('smooth scrolling');
  const srv = await startServer({ stateFile: path.join(TMP, 'scroll-smooth-state.json'), binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '80', DEMO_FILL: '150' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'PS' });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  const { ev } = page;
  await page.waitFor(`document.querySelectorAll('.pane').length === 2`, 30000);
  await page.waitFor(`import('/js/state.js').then(({ state }) => [...state.panes.values()].every((p) => p.term.buffer.active.baseY > 100 || p.meta.kind !== 'claude'))`, 30000);

  const durations = () => ev(`import('/js/state.js').then(({ state }) => [...state.panes.values()].map((p) => p.term.options.smoothScrollDuration))`);
  t.check('at rest the animation is off (programmatic scrolls stay instant)', (await durations()).every((d) => d === 0), JSON.stringify(await durations()));

  const claude = await ev(`import('/js/state.js').then(({ state }) => { const p = [...state.panes.values()].find((x) => x.meta.kind === 'claude'); const r = p.el.querySelector('.xterm-screen').getBoundingClientRect(); return { id: p.id, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
  // גלגלת אמיתית, 60Hz: מודדים כמה שורות הקופץ ה-viewport בכל פריים
  await ev(`import('/js/state.js').then(({ state }) => { const term = state.panes.get('${claude.id}').term; term.scrollToBottom(); window.__ys = []; window.__go = true; const tick = () => { if (!window.__go) return; window.__ys.push(term.buffer.active.viewportY); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })`);
  for (let i = 0; i < 40; i++) { await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: claude.x, y: claude.y, deltaX: 0, deltaY: -20 }); await sleep(16); }
  const during = await durations();
  await sleep(400);
  const ys = await ev('(() => { window.__go = false; return window.__ys; })()');
  const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i])).filter((d) => d > 0);
  const maxStep = Math.max(0, ...steps), avg = steps.reduce((a, b) => a + b, 0) / (steps.length || 1);
  t.check('a trackpad-size wheel (20 px events at 60 Hz, T70: real pixel distance) moves the view in small steps, never a jump', steps.length > 20 && maxStep <= 2 && avg < 1.6, JSON.stringify({ frames: ys.length, moved: steps.length, maxStep, avg: +avg.toFixed(2) }));

  t.check('while the wheel is used the scrolled terminal animates', during.includes(100), JSON.stringify(during));
  await sleep(900);
  t.check('and it is off again shortly after the last wheel event', (await durations()).every((d) => d === 0), JSON.stringify(await durations()));

  // קפיצה מתוכנתת (החזרת מיקום אחרי החלפת מרנדר) נשארת מיידית
  const jump = await ev(`import('/js/state.js').then(async ({ state }) => { const term = state.panes.get('${claude.id}').term; term.scrollToLine(10); await new Promise((r) => requestAnimationFrame(r)); const a = term.buffer.active.viewportY; term.scrollToBottom(); await new Promise((r) => requestAnimationFrame(r)); return { a, b: term.buffer.active.viewportY, base: term.buffer.active.baseY }; })`);
  t.check('scrollToLine and scrollToBottom land within one frame', jump.a === 10 && jump.b === jump.base, JSON.stringify(jump));

  // פלט חדש בתחתית: התצוגה נשארת צמודה לתחתית; גוללו למעלה: הפלט לא גורר אותה
  const follow = await ev(`import('/js/state.js').then(async ({ state }) => { const term = state.panes.get('${claude.id}').term; const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    term.scrollToBottom(); await frame();
    for (let i = 0; i < 5; i++) term.write('שורה חדשה ' + i + '\\r\\n');
    await frame(); await frame();
    const atBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    term.scrollToLine(20); await frame(); const base0 = term.buffer.active.baseY;
    for (let i = 0; i < 5; i++) term.write('עוד שורה ' + i + '\\r\\n');
    await frame(); await frame();
    return { atBottom, stayed: term.buffer.active.viewportY === 20, grew: term.buffer.active.baseY >= base0 }; })`);
  t.check('new output keeps the bottom followed', follow.atBottom === true, JSON.stringify(follow));
  t.check('a view scrolled up is not dragged by new output', follow.stayed === true, JSON.stringify(follow));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
