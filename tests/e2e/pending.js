'use strict';
// @slow
/*
 * משוב מיידי (T38): כל לחיצה שממתינה לשרת משנה את הממשק לפני שהשרת עונה.
 *  - Claude חדש / שכפול: כרטיס "פותח את..." בגריד (גם מעל מסך הפתיחה), שמוחלף בטרמינל האמיתי; בשגיאה או אחרי 10 שניות הוא נעלם עם הודעה;
 *  - הפעלה מחדש: הכפתור מקבל ספינר מיד, והטרמינל הישן מוחלף בחדש;
 *  - סגירה: הפאן מתעמעם מיד ונעלם כשהשרת מאשר;
 *  - אין אייקוני איפוס בשורות ההגדרות.
 * השרת מדמה פתיחה איטית עם TG_TEST_CREATE_DELAY_MS ופתיחה כושלת עם TG_TEST_CREATE_FAIL=1.
 */
const path = require('path');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('instant feedback: placeholder cards and busy buttons');
  const bin = path.join(FIXTURES, 'bin-args');

  /* ---------- פתיחה איטית (1.5 שניות) ---------- */
  let srv = await startServer({ binDir: bin, env: { TG_TEST_CREATE_DELAY_MS: '1500' } });
  let keeper = await connect(srv.port);
  let page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(0);
  const cards = () => page.ev(`document.querySelectorAll('.pending-card').length`);
  const panes = () => page.ev(`document.querySelectorAll('.pane').length`);

  // הבדיקה והלחיצה באותה הרצה: הכרטיס כבר קיים כשהקוד שהגיב ללחיצה חזר, לפני שהשרת עונה (ההשהיה בשרת 1.5 שניות)
  const first = await page.ev(`(() => { document.querySelector('#addClaude').click(); const c = document.querySelector('.pending-card'); return { cards: document.querySelectorAll('.pending-card').length, text: c && c.textContent, spin: !!(c && c.querySelector('.spin')), empty: document.querySelector('#empty').hidden }; })()`);
  t.check('Claude חדש: a card "פותח את..." with a spinner exists in the same tick as the click', first.cards === 1 && /פותח את Claude/.test(first.text) && first.spin, JSON.stringify(first));
  await sleep(150);
  t.check('and it is a real cell in the grid (sized), while the start screen steps aside', await page.ev(`(() => { const r = document.querySelector('.pending-card').getBoundingClientRect(); return r.width > 300 && r.height > 300 && document.querySelector('#empty').hidden; })()`));
  t.check('no terminal yet at that point', (await panes()) === 0);
  t.check('when the server answers the card is replaced by the real terminal', await poll(async () => (await panes()) === 1 && (await cards()) === 0, 10000, 150));
  t.check('the grid shows only the terminal (one cell)', await page.ev(`(() => { const r = document.querySelector('.pane').getBoundingClientRect(); return r.width > 800; })()`));

  // שתי לחיצות רצופות: שני כרטיסים בתאים נפרדים
  await page.ev(`document.querySelector('#addClaude').click(); document.querySelector('#addClaude').click(); true`);
  await sleep(200);
  t.check('two quick clicks: two cards in separate cells next to the existing terminal', await page.ev(`(() => {
    const rs = [...document.querySelectorAll('.pending-card, .pane')].map((e) => e.getBoundingClientRect());
    if (rs.length !== 3) return false;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return false; }
    return true; })()`));
  t.check('both are replaced by terminals', await poll(async () => (await panes()) === 3 && (await cards()) === 0, 12000, 150));

  // שכפול מתפריט הפאן
  await page.ev(`document.querySelector('.pane .ph-btn[data-act="menu"]').click(); true`);
  await page.waitFor(`!!document.querySelector('.menu [data-id="duplicate"]')`, 3000);
  const dup = await page.ev(`(() => { document.querySelector('.menu [data-id="duplicate"]').click(); return document.querySelectorAll('.pending-card').length; })()`);
  t.check('duplicate: the card appears at once', dup === 1, String(dup));
  t.check('and is replaced by the copy', await poll(async () => (await panes()) === 4 && (await cards()) === 0, 10000, 150));

  // סגירה: מתעמם מיד
  const closing = await page.ev(`(() => { const p = document.querySelector('.pane'); const b = p.querySelector('.ph-btn[data-act="close"]'); b.click(); b.click(); return p.classList.contains('closing'); })()`);
  t.check('close: the pane dims at once after the second click', closing === true);
  t.check('and disappears when the server confirms', await poll(async () => (await panes()) === 3, 6000, 100));

  // הפעלה מחדש: טרמינל PowerShell שיצא
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'X' });
  await poll(async () => [...keeper.sessions.values()].some((s) => s.name === 'X'), 10000, 100);
  const x = [...keeper.sessions.values()].find((s) => s.name === 'X');
  await page.waitFor(`!!document.querySelector('.pane[data-id="${x.id}"]')`, 8000);
  keeper.send({ t: 'input', id: x.id, d: 'exit\r' });
  await page.waitFor(`!document.querySelector('.pane[data-id="${x.id}"] .pane-exit').hidden`, 15000);
  const restart = await page.ev(`(() => { const b = document.querySelector('.pane[data-id="${x.id}"] [data-act="restart"]'); b.click(); return { busy: b.getAttribute('aria-busy'), disabled: b.disabled, spin: !!b.querySelector('.spin'), text: b.textContent }; })()`);
  t.check('restart: the button shows a spinner and "מפעיל מחדש" at once and cannot be pressed twice', restart.busy === 'true' && restart.disabled && restart.spin && /מפעיל מחדש/.test(restart.text), JSON.stringify(restart));
  t.check('then the old terminal is replaced by a new one (no exited overlay left)', await poll(async () => (await page.ev(`!document.querySelector('.pane[data-id="${x.id}"]') && ![...document.querySelectorAll('.pane-exit')].some((e) => !e.hidden)`)) === true, 15000, 150));

  t.check('no settings reset icons exist anywhere (T38 removed them)', await page.ev(`(async () => { document.querySelector('#settingsBtn').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelectorAll('#settingsDlg .st-reset').length === 0 && !!document.querySelector('#settingsDlg .st-reset-all'); })()`));
  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();

  /* ---------- פתיחה שנכשלת: הכרטיס נעלם עם הודעה, ומסך הפתיחה חוזר ---------- */
  await sleep(500);
  srv = await startServer({ binDir: bin, env: { TG_TEST_CREATE_DELAY_MS: '600', TG_TEST_CREATE_FAIL: '1' } });
  page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(0);
  const failFirst = await page.ev(`(() => { document.querySelector('#addClaude').click(); return document.querySelectorAll('.pending-card').length; })()`);
  t.check('failing open: the card appears at once', failFirst === 1);
  t.check('when the server answers with an error the card disappears and the error is shown', await poll(async () => (await cards()) === 0 && (await page.ev(`!!document.querySelector('#toasts .toast') && document.querySelector('#toasts').textContent.includes('שגיאה מדומה')`)), 6000, 150));
  t.check('the start screen is back', await page.ev(`!document.querySelector('#empty').hidden`));
  page.close(); srv.stop();

  /* ---------- השרת לא עונה: אחרי 10 שניות הכרטיס נעלם עם הודעה ---------- */
  await sleep(500);
  srv = await startServer({ binDir: bin, env: { TG_TEST_CREATE_DELAY_MS: '20000' } });
  page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(0);
  await page.ev(`document.querySelector('#addClaude').click(); true`);
  await sleep(6000);
  t.check('after 6 s the card is still waiting', (await cards()) === 1);
  t.check('after 10 s without an answer the card is removed with a message', await poll(async () => (await cards()) === 0 && (await page.ev(`document.querySelector('#toasts').textContent.includes('לא הצלחנו לפתוח')`)), 8000, 200));
  t.check('no page errors on the other servers', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
