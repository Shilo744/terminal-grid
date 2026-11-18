'use strict';
/*
 * הגדרות בשרת, בדפדפן אמיתי: שינוי גודל גופן נשמר ב-settings.json ושורד הפעלה מחדש של השרת על פורט אחר (origin אחר,
 * localStorage ריק), חלון שני מתעדכן מיד, וההגדרות הישנות מ-localStorage עוברות לשרת פעם אחת בלבד.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

// חתימה של גודל הגופן בפועל: מידות מסך הטרמינל (שורות × גובה תא) משתנות עם הגופן, ובחלון באותו גודל הן קבועות
const SIG = `(() => { const s = document.querySelector('.term-host .xterm-screen'); return s ? s.style.width + 'x' + s.style.height : null; })()`;
const readSettings = (srv) => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8'));
// ממתין עד שהתנאי על קובץ ההגדרות מתקיים (השמירה היא דחייה של 200ms + הלוך-חזור)
const until = async (srv, pred, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { try { if (pred(readSettings(srv))) return true; } catch { /* עוד לא נכתב */ } await sleep(100); } return false; };

(async () => {
  const t = checker('settings: server-side, synced, migrated');
  const binDir = path.join(FIXTURES, 'bin-args');

  /* ---------- שינוי נשמר ושורד פורט אחר ---------- */
  let srv = await startServer({ binDir });
  let keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  for (let i = 0; i < 100 && keeper.sessions.size < 1; i++) await sleep(100);
  let page = await openPage(`http://127.0.0.1:${srv.port}/`);
  await page.appReady(1);
  await page.waitFor(`!!document.querySelector('.term-host .xterm-screen')`);
  const sig14 = await page.ev(SIG);
  t.check('the terminal is on screen at the default size', !!sig14, String(sig14));
  await page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true }))`);
  await page.waitFor(`${SIG} !== ${JSON.stringify(sig14)}`);
  // the size is only 16 px after BOTH key presses were applied (each one is applied in its own frame): sampling right after the first change caught the 15 px layout as "16" (flaky under load; the diagnostics showed server, page and terminal all at 16)
  await page.waitFor(`import('/js/state.js').then(({ state }) => [...state.panes.values()].every((p) => p.term.options.fontSize === 16))`, 30000);
  let sig16 = await page.ev(SIG);
  for (let i = 0; i < 40; i++) { await sleep(150); const again = await page.ev(SIG); if (again === sig16) break; sig16 = again; } // the layout has settled when two samples in a row are equal
  t.check('Ctrl+= twice: the terminal follows (its cell metrics change)', !!sig16 && sig16 !== sig14, `${sig14} -> ${sig16}`);
  t.check('the server wrote it to settings.json', await until(srv, (x) => x.terminal.fontSize === 16));
  const first = srv;
  page.close(); keeper.close(); srv.stop();
  for (let i = 0; i < 40 && !first.child.exited; i++) await sleep(250);

  srv = await startServer({ binDir, stateFile: first.stateFile, settingsFile: first.settingsFile, keepState: true });
  t.check('the second server really listens on another port', srv.port !== first.port);
  page = await openPage(`http://127.0.0.1:${srv.port}/`);
  await page.appReady(1);
  await page.waitFor(`${SIG} === ${JSON.stringify(sig16)}`, 40000);
  const diag = async () => JSON.stringify({ file: readSettings(srv).terminal.fontSize, api: (await (await fetch(`http://127.0.0.1:${srv.port}/api/settings`)).json()).settings.terminal.fontSize, page: await page.ev("import('/js/settings.js').then((m) => m.getSetting('terminal.fontSize'))"), ls: await page.ev("localStorage.getItem('tg.fontSize')"), term: await page.ev("import('/js/state.js').then(({ state }) => [...state.panes.values()].map((p) => p.term.options.fontSize))") });
  t.check('after restart on a different port the size is still the 16px one', (await page.ev(SIG)) === sig16, `${await page.ev(SIG)} vs ${sig16} ${await diag()}`);
  t.check('localStorage on the new origin was refilled as a cache', (await page.ev(`localStorage.getItem('tg.fontSize')`)) === '16');

  /* ---------- חלון שני מתעדכן ---------- */
  const page2 = await openPage(`http://127.0.0.1:${srv.port}/`);
  await page2.appReady(1);
  await page2.waitFor(`${SIG} === ${JSON.stringify(sig16)}`, 40000);
  t.check('a second window starts with the same size', (await page2.ev(SIG)) === sig16);
  await page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'Minus', ctrlKey: true, bubbles: true, cancelable: true }))`);
  await page2.waitFor(`${SIG} !== ${JSON.stringify(sig16)}`, 30000);
  await until(srv, (x) => x.terminal.fontSize === 15);
  const sig15 = await page.ev(SIG);
  await page2.waitFor(`${SIG} === ${JSON.stringify(sig15)}`, 30000);
  t.check('changing it in one window updates the other', sig15 !== sig16 && (await page2.ev(SIG)) === sig15, `${sig15} vs ${await page2.ev(SIG)}`);
  t.check('the server holds 15 and the first window did not flicker back', readSettings(srv).terminal.fontSize === 15 && (await page.ev(`localStorage.getItem('tg.fontSize')`)) === '15');
  page.close(); page2.close();
  keeper = await connect(srv.port);
  keeper.close();
  srv.stop();

  /* ---------- העברה חד-פעמית מ-localStorage ---------- */
  srv = await startServer({ binDir });
  const seed = (size, cwd) => `localStorage.setItem('tg.fontSize', '${size}'); localStorage.setItem('tg.cwd', ${JSON.stringify(JSON.stringify(cwd))}); localStorage.setItem('tg.recents', ${JSON.stringify(JSON.stringify([cwd]))});`;
  // הזריעה לפני שהאפליקציה נטענת בפעם הראשונה: מתחילים מ-about:blank ורק אז מנווטים
  page = await openPage('about:blank');
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: seed(18, 'C:\\Windows') });
  await page.call('Page.navigate', { url: `http://127.0.0.1:${srv.port}/` });
  await until(srv, (x) => x.migrated === true, 20000);
  t.check('legacy localStorage values were sent to the server once', readSettings(srv).terminal.fontSize === 18 && readSettings(srv).ui.cwd === 'C:\\Windows' && readSettings(srv).migrated === true, JSON.stringify(readSettings(srv).ui));
  page.close();

  const other = await openPage('about:blank');
  await other.call('Page.addScriptToEvaluateOnNewDocument', { source: seed(11, 'C:\\Temp') });
  await other.call('Page.navigate', { url: `http://127.0.0.1:${srv.port}/` });
  await other.waitFor(`localStorage.getItem('tg.fontSize') === '18' && document.querySelector('#folderLabel') && document.querySelector('#folderLabel').textContent === 'Windows'`, 20000);
  t.check('a window with other old values does not overwrite the migrated settings', readSettings(srv).terminal.fontSize === 18 && readSettings(srv).ui.cwd === 'C:\\Windows');
  t.check('that window shows the server values, not its old localStorage', (await other.ev(`localStorage.getItem('tg.fontSize')`)) === '18' && (await other.ev(`document.querySelector('#folderLabel').textContent`)) === 'Windows');
  other.close();
  srv.stop();

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
