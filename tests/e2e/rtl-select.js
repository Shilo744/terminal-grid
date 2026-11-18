'use strict';
// @slow
// T70: in a mirrored (right-aligned) Hebrew row the mouse acts on what is DISPLAYED: drag-select, double-click a word, hover and Ctrl+click on a link.
// Real CDP mouse events on a fixture with a Hebrew sentence that contains a URL and English words.
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('mouse in mirrored Hebrew rows');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-hebsel') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'hs' });
  await poll(() => keeper.sessions.size === 1, 15000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1300, height: 800 });
  const { ev } = page;
  await page.appReady(1);
  await page.waitFor(`document.querySelector('.pane-startup').hidden`, 15000);
  const id = [...keeper.sessions.values()][0].id;
  await page.waitFor(`document.querySelectorAll('.tg-rtl').length === 1`, 20000);
  await ev(`window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; true`);

  // מיקום שורה לפי טקסט: שורת המסך, העמודות המקוריות של הטקסט, וההזזה (אי-תלויה בשכבה: הקצה הימני של הטקסט = סוף השורה פחות ההזחה השמאלית המקורית)
  const rowInfo = (needle) => ev(`(async () => { const { state } = await import('/js/state.js'); const p = state.panes.get('${id}'); const b = p.term.buffer.active; const scr = p.el.querySelector('.xterm-screen').getBoundingClientRect();
    for (let r = 0; r < p.term.rows; r++) { const l = b.getLine(b.viewportY + r); if (!l) continue; const s = l.translateToString(true); if (!s.includes(${JSON.stringify(needle)})) continue;
      const start = s.length - s.trimStart().length, end = s.length; const cw = scr.width / p.term.cols, ch = scr.height / p.term.rows;
      const marker = /^[●•] /.test(s.trimStart()) ? 2 : 0; const textStart = start + marker, delta = p.term.cols - textStart - end;
      return { r, s, start, end, textStart, marker, delta, cw, ch, left: scr.left, top: scr.top, cols: p.term.cols }; } return null; })()`);
  // x במסך של התא המקורי c (באמצע התא), אחרי ההזזה של השורה
  const disp = (ri, c) => ({ x: ri.left + (c + ri.delta + 0.5) * ri.cw, y: ri.top + (ri.r + 0.5) * ri.ch });
  const plain = (ri, c) => ({ x: ri.left + (c + 0.5) * ri.cw, y: ri.top + (ri.r + 0.5) * ri.ch });
  const mouse = (type, p, extra = {}) => page.call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const drag = async (a, b) => { await mouse('mouseMoved', a, { buttons: 0 }); await mouse('mousePressed', a); for (let i = 1; i <= 6; i++) await mouse('mouseMoved', { x: a.x + ((b.x - a.x) * i) / 6, y: a.y }); await mouse('mouseReleased', b); await sleep(300); };
  const sel = () => ev(`import('/js/state.js').then(({ state }) => state.panes.get('${id}').term.getSelection())`);
  const px = (x, y) => ev(`(() => { const c = document.querySelector('.tg-rtl'); const r = c.getBoundingClientRect(); const d = c.getContext('2d').getImageData(Math.round((${x} - r.left) * c.width / r.width), Math.round((${y} - r.top) * c.height / r.height), 1, 1).data; return [d[0], d[1], d[2], d[3]]; })()`);

  await poll(async () => (await rowInfo('plain English')) && (await rowInfo('example.com')), 15000, 200);
  await sleep(500);
  const hebRow = await rowInfo('English');
  const linkRow = await rowInfo('example.com');
  const engRow = await rowInfo('plain English');
  t.check('(setup) the rows are on screen and the Hebrew rows are right-aligned by the layer (delta > 10)', !!hebRow && !!linkRow && !!engRow && hebRow.delta > 10 && linkRow.delta > 10, JSON.stringify({ hebRow, linkRow, engRow }));

  /* ---------- בחירה בגרירה: חלק מהשורה כפי שמוצג ---------- */
  const c1 = hebRow.s.indexOf('English') - 3, c2 = hebRow.s.indexOf('English') + 7; // שלוש אותיות לפני ושבע אחרי, בתאים המקוריים
  await drag(disp(hebRow, c1), disp(hebRow, c2));
  let s = await sel();
  t.check('dragging over the DISPLAYED middle of a mirrored row selects exactly the cells under the pointer', s === hebRow.s.slice(c1, c2), JSON.stringify({ got: s, want: hebRow.s.slice(c1, c2) }));
  const pDisp = await px(disp(hebRow, c1 + 2).x, disp(hebRow, c1 + 2).y - hebRow.ch / 2 + 1);
  t.check('the selection colour is painted at the displayed (mirrored) place', pDisp[3] > 0, JSON.stringify(pDisp));
  const pOrig = await px(plain(hebRow, c1 + 2).x, plain(hebRow, 0).y - hebRow.ch / 2 + 1);
  t.check('the row stays mirrored while selected: at the ORIGINAL left cells there is no selection colour (only the row background)', pOrig[3] > 0 && !(pOrig[0] === 38 && pOrig[1] === 79 && pOrig[2] === 120), JSON.stringify(pOrig));
  await sleep(200);
  const shotsDir = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.writeFileSync(path.join(shotsDir, 'T70-selection-ide.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await ev("import('/js/settings.js').then((m) => { m.setSetting('appearance.style', 'paper'); return true; })"); // the real route: it also re-themes the terminals
  await sleep(800);
  const hebPaper = await rowInfo('English'); // הخطيط זז בסגנון אחר
  await drag(disp(hebPaper, c1), disp(hebPaper, c2));
  t.check('the same drag in the paper style selects the same cells', (await sel()) === hebRow.s.slice(c1, c2), JSON.stringify({ got: await sel(), hebPaper }));
  const pPaper = await px(disp(hebPaper, c1 + 2).x, disp(hebPaper, c1 + 2).y - hebPaper.ch / 2 + 1);
  t.check('...and the selection colour is painted at the displayed place in paper too', pPaper[3] > 0 && pPaper[2] > pPaper[0], JSON.stringify({ pPaper, y: disp(hebPaper, 0).y, rowTop: hebPaper.top }));
  fs.writeFileSync(path.join(shotsDir, 'T70-selection-paper.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await ev(`document.documentElement.dataset.style = 'ide'; true`);
  await sleep(400);

  /* ---------- לחיצה כפולה: המילה המוצגת ---------- */
  await mouse('mouseMoved', disp(hebRow, hebRow.s.indexOf('English') + 2), { buttons: 0 });
  const dp = disp(hebRow, hebRow.s.indexOf('English') + 2);
  await mouse('mousePressed', dp, { clickCount: 1 }); await mouse('mouseReleased', dp, { clickCount: 1 });
  await mouse('mousePressed', dp, { clickCount: 2 }); await mouse('mouseReleased', dp, { clickCount: 2 });
  await sleep(300);
  s = await sel();
  t.check('a double-click on the displayed English word selects that word', s.trim() === 'English', JSON.stringify(s));

  /* ---------- שורה שאינה מוזזת: כמו קודם ---------- */
  await drag(plain(engRow, 6), plain(engRow, 12));
  s = await sel();
  t.check('a row that is not mirrored behaves as before (cells 6..12)', s === engRow.s.slice(6, 12), JSON.stringify({ got: s, want: engRow.s.slice(6, 12) }));

  /* ---------- קישורים: ריחוף ו-Ctrl+לחיצה במקום שהם מוצגים ---------- */
  const u = linkRow.s.indexOf('https://example.com/docs');
  const uPos = disp(linkRow, u + 8);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: uPos.x, y: uPos.y });
  await sleep(500);
  const chip = await ev(`(document.querySelector('.link-chip') || {}).textContent || null`);
  t.check('hovering the URL where it is DISPLAYED shows the link chip', !!chip && /example\.com\/docs/.test(chip), String(chip));
  await mouse('mousePressed', uPos, { modifiers: 0 }); await mouse('mouseReleased', uPos, { modifiers: 0 });
  await sleep(300);
  t.check('a plain click on the displayed URL opens nothing (T47)', (await ev('window.__opened.length')) === 0);
  await mouse('mousePressed', uPos, { modifiers: 2 }); await mouse('mouseReleased', uPos, { modifiers: 2 });
  await sleep(400);
  const opened = await ev('window.__opened');
  t.check('Ctrl+click on the displayed URL opens it (noopener,noreferrer)', opened.length === 1 && opened[0][0] === 'https://example.com/docs' && /noopener/.test(opened[0][2]), JSON.stringify(opened));
  await ev('window.__opened.length = 0; true');
  const ghost = plain(linkRow, u + 8); // איפה שהטקסט המקורי היה (שמאלה): שם אין עכשיו כלום על המסך
  await mouse('mousePressed', ghost, { modifiers: 2 }); await mouse('mouseReleased', ghost, { modifiers: 2 });
  await sleep(400);
  t.check('Ctrl+click where the text USED to be (left, now empty) does not open the link', (await ev('window.__opened.length')) === 0);

  /* ---------- בחירה בשורה עם נקודת רשימה: הנקודה בצד ימין ---------- */
  const w0 = null;
  await ev(`import('/js/state.js').then(({ state }) => state.panes.get('${id}').term.clearSelection())`);
  await sleep(200);
  const a = disp(linkRow, linkRow.textStart + 1), b = disp(linkRow, linkRow.textStart + 9);
  await drag(a, b);
  s = await sel();
  t.check('drag in a row with a bullet selects the cells under the pointer too', s === linkRow.s.slice(linkRow.textStart + 1, linkRow.textStart + 10) || s === linkRow.s.slice(linkRow.textStart + 1, linkRow.textStart + 9), JSON.stringify({ got: s, line: linkRow.s, w0 }));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
