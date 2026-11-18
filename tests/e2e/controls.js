'use strict';
/*
 * כפתורים וקיצורים של הממשק, בדפדפן אמיתי: גודל וסוג גופן, הגדלה וחזרה לרשת, סגירה בשתי לחיצות, שינוי שם,
 * גרירה להחלפת מקום (והסדר החדש נשמר בשרת), Alt+מספר, חלון בחירת התיקייה וחלון הייבוא. בנוסף נאספות שגיאות
 * JavaScript וקונסול לאורך כל הבדיקה.
 *
 * אפשר להריץ אותה גם על גרסה אחרת של הממשק, למשל לפני פיצול למודולים:
 *   APP_DIR=tests/.tmp/before-app node tests/e2e/controls.js
 */
const path = require('path');
const fs = require('fs');
const { APP, TMP, FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('controls & shortcuts' + (process.env.APP_DIR ? ` (APP_DIR=${process.env.APP_DIR})` : ''));
  const stateFile = path.join(TMP, 'controls-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* אין */ }
  const srv = await startServer({ cwd: path.resolve(process.env.APP_DIR || APP), stateFile, binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'B' });
  await sleep(2500);

  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  const { ev } = page;
  // אוספים שגיאות מרגע הטעינה: מוסיפים את האספן ומרעננים
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; window.addEventListener('error', (e) => window.__errs.push('error: ' + e.message)); window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + (e.reason && e.reason.message || e.reason))); const ce = console.error; console.error = (...a) => { window.__errs.push('console.error: ' + a.join(' ')); ce.apply(console, a); };` });
  await page.reload();
  await page.appReady(2);

  const panes = () => ev(`document.querySelectorAll('.pane').length`);
  t.check('two panes are shown', (await panes()) === 2);

  // גופן: זום מהמקלדת (Ctrl + = / - / 0); כפתורי A-/A+ ובורר הגופן הוסרו מהסרגל (הגופן נבחר בהגדרות)
  const zoom = (k, code) => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', code: '${code}', ctrlKey: true, bubbles: true, cancelable: true }))`);
  await zoom('=', 'Equal');
  t.check('Ctrl+= raises the font size (saved)', (await ev(`localStorage.getItem('tg.fontSize')`)) === '15');
  await zoom('-', 'Minus'); await zoom('-', 'Minus');
  t.check('Ctrl+- lowers it (saved)', (await ev(`localStorage.getItem('tg.fontSize')`)) === '13');
  await zoom('0', 'Digit0');
  t.check('Ctrl+0 resets it to 14', (await ev(`localStorage.getItem('tg.fontSize')`)) === '14');

  // Alt+2 מעביר מיקוד לטרמינל השני
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', altKey: true, bubbles: true, cancelable: true }))`);
  t.check('Alt+2 focuses the second terminal', await page.waitFor(`(document.querySelector('.pane.focused') || {}).dataset && document.querySelector('.pane.focused').dataset.id === '2'`, 5000));

  // הגדלה וחזרה לרשת
  await ev(`document.querySelector('.pane[data-id="1"] [data-act="expand"]').click()`);
  t.check('expand: grid button appears and the other terminal becomes a tile', await page.waitFor(`!document.querySelector('#gridBtn').hidden && document.querySelectorAll('.pane.tile').length === 1`, 8000));
  await ev(`document.querySelector('#gridBtn').click()`);
  t.check('grid button returns to the grid', await page.waitFor(`document.querySelector('#gridBtn').hidden && document.querySelectorAll('.pane.tile').length === 0`, 8000));

  // גרירה להחלפת מקום (באירועי גרירה אמיתיים) והסדר נשמר בשרת
  const lefts = () => ev(`['1', '2'].map((id) => Math.round(document.querySelector('.pane[data-id="' + id + '"]').getBoundingClientRect().left))`);
  const before = await lefts();
  await ev(`(() => { const dt = new DataTransfer(); const head = document.querySelector('.pane[data-id="1"] .pane-head'); const target = document.querySelector('.pane[data-id="2"]');
    head.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    head.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true })); })()`);
  await page.waitFor(`Math.round(document.querySelector('.pane[data-id="1"]').getBoundingClientRect().left) !== ${before[0]}`, 8000);
  const after = await lefts();
  t.check('dragging a header onto another swaps their places', before[0] !== after[0] && before[0] === after[1] && before[1] === after[0], `${before} -> ${after}`);
  // השרת שומר את הסדר בדחייה (view 300ms + שמירת מצב 400ms)
  const names = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).sessions.map((s) => s.name).join(','); } catch { return ''; } };
  for (let i = 0; i < 60 && names() !== 'B,A'; i++) await sleep(100);
  t.check('the new order is saved by the server', names() === 'B,A', names());

  // שינוי שם בלחיצה כפולה
  await ev(`document.querySelector('.pane[data-id="1"] .name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  t.check('double-click makes the name editable', (await ev(`document.querySelector('.pane[data-id="1"] .name').getAttribute('contenteditable')`)) === 'plaintext-only');
  await ev(`(() => { const n = document.querySelector('.pane[data-id="1"] .name'); n.textContent = 'Renamed'; n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  t.check('Enter commits the new name (server echoes it back)', await page.waitFor(`document.querySelector('.pane[data-id="1"] .name').textContent === 'Renamed'`, 8000));

  // חלון בחירת התיקייה
  await ev(`document.querySelector('#folderBtn').click()`);
  t.check('folder button opens the popover', (await ev(`!document.querySelector('#folderPop').hidden && document.querySelector('#folderBtn').getAttribute('aria-expanded') === 'true'`)) === true);
  await ev(`(() => { const i = document.querySelector('#pathInput'); i.value = 'C:\\\\Windows'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  t.check('typing a path + Enter sets the working folder', (await ev(`document.querySelector('#folderLabel').textContent`)) === 'Windows' && (await ev(`localStorage.getItem('tg.cwd')`)) === JSON.stringify('C:\\Windows'));
  await ev(`document.querySelector('#folderBtn').click()`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  t.check('Escape closes the popover', (await ev(`document.querySelector('#folderPop').hidden`)) === true);

  // חלון הייבוא
  await ev(`document.querySelector('#newMenuBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  await ev(`document.querySelector('.menu [data-id="adopt"]').click()`);
  t.check('the "ייבוא סוכנים" menu item opens its popover and it answers', await page.waitFor(`!document.querySelector('#adoptPop').hidden && document.querySelector('#adoptList').children.length > 0`, 30000));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  t.check('Escape closes the import popover', (await ev(`document.querySelector('#adoptPop').hidden`)) === true);

  // סגירה מיידית (T55): לחיצה אחת, בלי "לסגור?"
  await ev(`document.querySelector('.pane[data-id="2"] [data-act="close"]').click()`);
  t.check('a single click on × closes the terminal (no confirmation step)', await page.waitFor(`document.querySelectorAll('.pane').length === 1`, 10000));

  const errs = await ev(`window.__errs`);
  t.check('no JavaScript errors during the whole run', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
