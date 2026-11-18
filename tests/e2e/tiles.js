'use strict';
// @slow
/*
 * אריחים זולים ופאנים שלא נראים (T27): 9 טרמינלים שמדפיסים "<שם> tick N" כל 300ms.
 *  א. הגדלת טרמינל אחד: ל-8 האריחים host מוסתר (xterm לא מצייר), הם לא משנים גודל, ובגוף שלהם שתי שורות הפלט האחרונות שמתעדכנות.
 *  ב. החזרה למסך מלא (הגדלת אריח, ואז חזרה לרשת): המסך שמצויר זהה למאגר של xterm, כלומר עדכני.
 *  (תקציב ה-WebGL עם GPU בתוכנה נבדק בנפרד ב-e2e/webgl-budget.js: הוא כבד, ואם הוא לא יציב רוצים לראות מי מהם)
 */
const path = require('path');
const { TMP, FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('./../lib/harness');
const fs = require('fs');

const N = 9;
const url = (srv) => `http://127.0.0.1:${srv.port}/`;
// קוד שרץ בדף: אותו מופע של המודולים שהאפליקציה משתמשת בו (import דינמי של אותו כתובת)
const IN_PAGE = `
  window.__t = {
    async mods() { const s = await import('/js/state.js'); const p = await import('/js/renderer-pool.js'); return { state: s.state, pool: p }; },
  };`;

(async () => {
  const t = checker('cheap tiles and parked panes');
  const work = path.join(TMP, 'tiles-work');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-ticker') });
  const keeper = await connect(srv.port);
  for (let i = 1; i <= N; i++) {
    const d = path.join(work, 't' + i);
    fs.mkdirSync(d, { recursive: true });
    keeper.send({ t: 'create', kind: 'claude', cwd: d, name: 't' + i });
    await sleep(120);
  }
  await poll(() => keeper.sessions.size === N, 30000);
  const ids = [...keeper.sessions.values()].sort((a, b) => Number(a.id) - Number(b.id)).map((s) => s.id);

  let page = await openPage(url(srv), { width: 1500, height: 900 });
  await page.ev(IN_PAGE);
  await page.appReady(N);
  const bufferTail = (id) => `(async () => { const { state } = await window.__t.mods(); const b = state.panes.get('${id}').term.buffer.active; for (let y = b.length - 1; y >= 0; y--) { const s = b.getLine(y).translateToString(true).trim(); if (s) return s; } return ''; })()`;
  // כל הטרמינלים כבר מדפיסים (בלי זה אין מה לראות באריחים)
  const ticking = (id) => poll(async () => /tick \d+$/.test(await page.ev(bufferTail(id))), 30000, 200);
  for (const id of ids) await ticking(id);

  const info = () => page.ev(`(() => { const o = {}; for (const el of document.querySelectorAll('.pane')) { const host = el.querySelector('.term-host'); const tl = [...el.querySelectorAll('.tl')].map((x) => x.textContent); o[el.dataset.id] = { tile: el.classList.contains('tile'), hostDisplay: getComputedStyle(host).display, tl, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }; } return JSON.stringify(o); })()`).then(JSON.parse);

  // ---------- א. הגדלה ----------
  const main = ids[0];
  await page.ev(`document.querySelector('.pane[data-id="${main}"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await page.waitFor(`document.querySelectorAll('.pane.tile').length === ${N - 1}`, 15000);
  let g = await info();
  const tiles = ids.slice(1);
  t.check(`expanding one of ${N} gives ${N - 1} tiles`, tiles.every((id) => g[id].tile) && !g[main].tile);
  t.check('every tile has a hidden terminal host (xterm does not paint it)', tiles.every((id) => g[id].hostDisplay === 'none'), JSON.stringify(tiles.map((id) => g[id].hostDisplay)));
  t.check('the expanded terminal paints', g[main].hostDisplay !== 'none');
  t.check('tiles are compact (76px) and stacked in the 380px column, not scaled terminals', tiles.every((id) => g[id].h <= 80 && g[id].w <= 380), JSON.stringify(tiles.map((id) => [g[id].w, g[id].h])));

  // תצוגת אריח: שורות קריאות מהמאגר, ומתעדכנות
  await page.waitFor(`[...document.querySelectorAll('.pane.tile')].every((el) => /tick \\d+/.test(el.querySelectorAll('.tl')[1].textContent))`, 15000);
  g = await info();
  const first = g[tiles[0]].tl;
  t.check('a tile shows the terminal name\'s last two output lines', /t2 tick \d+/.test(first[1]) && /t2 (tick \d+|ready t2)/.test(first[0]), JSON.stringify(first));
  const sig0 = JSON.stringify(first);
  const changed = await page.waitFor(`JSON.stringify([...document.querySelector('.pane[data-id="${tiles[0]}"]').querySelectorAll('.tl')].map((x) => x.textContent)) !== ${JSON.stringify(sig0)}`, 8000);
  t.check('the preview keeps updating as output arrives', changed);
  const stateText = await page.ev(`document.querySelector('.pane[data-id="${tiles[0]}"] .pstatus').textContent`);
  t.check('the tile shows the state as text (the ticker keeps printing: working)', stateText === 'עובד…', stateText);

  // ---------- ב. הגדלת אריח וחזרה ----------
  const pick = tiles[3];
  // המסך המצויר זהה למאגר של xterm. הטיקר מדפיס שורה חדשה כל 300ms והציור מפגר אחריה במעט, לכן לא דורשים את השורה האחרונה בדיוק:
  // מספיק שהשורה השלישית מהסוף (עם "tick") כבר מצוירת. מסך ריק או ישן (לא סונכרן מהמאגר) לא מכיל אותה. הכול בקריאה אחת לדף, בלי פער זמן בין טרמינלים.
  const rowsMatchBuffer = (id) => `(async () => { const { state } = await window.__t.mods(); const p = state.panes.get('${id}'); const b = p.term.buffer.active; const rows = p.el.querySelector('.xterm-rows').textContent; const seen = []; for (let y = b.length - 1; y >= 0 && seen.length < 3; y--) { const s = b.getLine(y).translateToString(true).trim(); if (s) seen.push(s); } const s = seen[seen.length - 1]; return !!s && (rows.includes(s) || rows.includes(s.slice(0, 20))); })()`;
  await page.ev(`document.querySelector('.pane[data-id="${pick}"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await page.waitFor(`!document.querySelector('.pane[data-id="${pick}"]').classList.contains('tile') && document.querySelector('.pane[data-id="${main}"]').classList.contains('tile')`, 15000);
  t.check('clicking a tile expands it and shows its terminal again', await page.ev(`getComputedStyle(document.querySelector('.pane[data-id="${pick}"] .term-host')).display !== 'none'`));
  t.check('the expanded tile shows the CURRENT screen (DOM matches the xterm buffer)', await poll(() => page.ev(rowsMatchBuffer(pick)), 8000, 200));
  t.check('the previously expanded terminal became a tile with a hidden host', await page.ev(`getComputedStyle(document.querySelector('.pane[data-id="${main}"] .term-host')).display === 'none'`));
  const dims = await page.ev(`(async () => { const { state } = await window.__t.mods(); const p = state.panes.get('${pick}'); const host = p.el.querySelector('.term-host'); return { cols: p.term.cols, rows: p.term.rows, w: host.getBoundingClientRect().width, h: host.getBoundingClientRect().height }; })()`);
  t.check('its size was re-measured on expand (columns fit the host, not a stale size)', dims.cols > 20 && dims.rows > 5 && dims.w > 600, JSON.stringify(dims));

  // הטרמינל המוגדל הראשון היה אריח (מוסתר) ועכשיו חוזר: הוא צריך להישאר למטה, לא לקפוץ לראש ההיסטוריה (באג אמיתי שנמצא בבדיקה הזאת)
  await page.ev(`document.querySelector('#gridBtn').click(); true`);
  await page.waitFor(`document.querySelectorAll('.pane.tile').length === 0`, 15000);
  const allCurrent = await poll(() => page.ev(`Promise.all([${ids.map((id) => rowsMatchBuffer(id)).join(',')}]).then((r) => r.every(Boolean))`), 20000, 400);
  const detail = allCurrent ? '' : JSON.stringify(await page.ev(`(async () => { const { state } = await window.__t.mods(); return [...state.panes.values()].map((p) => ({ id: p.id, rendering: p.rendering, disp: p.host.style.display, cols: p.term.cols, tail: p.el.querySelector('.xterm-rows').textContent.replace(/\s+/g, ' ').slice(-50), buf: (() => { const b = p.term.buffer.active; const o = []; for (let y = b.length - 1; y >= 0 && o.length < 3; y--) { const s = b.getLine(y).translateToString(true).trim(); if (s) o.push(s); } return o; })() })); })()`));
  t.check('back in the grid every terminal shows its current screen', allCurrent, detail);
  g = await info();
  const scrolled = await poll(() => page.ev(`(async () => { const { state } = await window.__t.mods(); return [...state.panes.values()].every((p) => { const b = p.term.buffer.active; return b.viewportY >= b.baseY - 1; }); })()`), 15000, 400);
  t.check('back in the grid no terminal jumped to the top of its history (all stay at the bottom)', scrolled);
  t.check('back in the grid all hosts paint', ids.every((id) => g[id].hostDisplay !== 'none'));

  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
