'use strict';
/*
 * שחזור מצב התצוגה בטעינת הדף: הסדר, הטרמינל המוגדל והמיקוד שהשרת שמר חוזרים בדיוק; וחלון שנפתח עם #f=<id>
 * (כמו "פתח ב-Terminal Grid" בתיקייה) ממקד את הטרמינל החדש. רץ גם על גרסה אחרת: APP_DIR=tests/.tmp/before-app
 */
const path = require('path');
const fs = require('fs');
const { APP, TMP, FIXTURES, sleep, poll, checker, startServer, connect, openPage, getJson } = require('../lib/harness');

(async () => {
  const t = checker('view restore on load' + (process.env.APP_DIR ? ` (APP_DIR=${process.env.APP_DIR})` : ''));
  const stateFile = path.join(TMP, 'view-restore-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* אין */ }
  const srv = await startServer({ cwd: path.resolve(process.env.APP_DIR || APP), stateFile, binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  for (const name of ['A', 'B', 'C']) keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name });
  // השרת יצר את שלושת הטרמינלים (כל אחד מופיע ב-list של חיבור חדש)
  for (let i = 0; i < 100 && keeper.sessions.size < 3; i++) await sleep(100);
  keeper.send({ t: 'view', order: ['3', '1', '2'], expanded: '1', focus: '1' });
  await sleep(500);

  let page = await openPage(`http://127.0.0.1:${srv.port}/`);
  await page.appReady(3);
  await page.waitFor(`document.querySelectorAll('.pane.tile').length === 2 && document.querySelector('.pane.focused')`);
  const geom = () => page.ev(`(() => { const r = (id) => document.querySelector('.pane[data-id="' + id + '"]').getBoundingClientRect(); return { top3: Math.round(r('3').top), top2: Math.round(r('2').top), tile1: document.querySelector('.pane[data-id="1"]').classList.contains('tile'), tiles: document.querySelectorAll('.pane.tile').length, focused: (document.querySelector('.pane.focused') || {}).dataset && document.querySelector('.pane.focused').dataset.id, gridBtn: !document.querySelector('#gridBtn').hidden }; })()`);
  let g = await geom();
  t.check('the expanded terminal from the server is expanded', g.tile1 === false && g.tiles === 2 && g.gridBtn, JSON.stringify(g));
  t.check('the saved order is applied (C above B in the side column)', g.top3 < g.top2, `top3=${g.top3} top2=${g.top2}`);
  t.check('the saved focus is applied', g.focused === '1', String(g.focused));
  page.close();

  // בלי מצב תצוגה שמור: #f=2 ממקד את הטרמינל השני.
  // קודם מחכים שהחלון הראשון באמת התנתק מהשרת: הוא שולח את מצב התצוגה שלו בדחייה (300ms) והיה דורס את מה שנכתב כאן
  await poll(async () => (await getJson(`http://127.0.0.1:${srv.port}/api/info`)).clients === 1, 15000);
  keeper.send({ t: 'view', order: ['1', '2', '3'], expanded: null, focus: null });
  await poll(async () => { const probe = await connect(srv.port); const ok = probe.view && probe.view.expanded === null; probe.close(); return ok; }, 15000, 300);
  page = await openPage(`http://127.0.0.1:${srv.port}/#f=2`);
  await page.appReady(3);
  await page.waitFor(`document.querySelectorAll('.pane.tile').length === 0 && (document.querySelector('.pane.focused') || {}).dataset && document.querySelector('.pane.focused').dataset.id === '2'`);
  g = await geom();
  t.check('#f=<id> focuses that terminal', g.focused === '2', String(g.focused));
  t.check('without an expanded terminal everything is in the grid', g.tiles === 0 && !g.gridBtn, JSON.stringify(g));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
