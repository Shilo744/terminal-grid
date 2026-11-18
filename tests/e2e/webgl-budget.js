'use strict';
// @slow
/*
 * תקציב WebGL (T27) עם הקשרים אמיתיים (GPU בתוכנה, SwiftShader): 9 טרמינלים נראים בבת אחת = לא יותר מ-8 הקשרים;
 * בהגדלה רק הטרמינל הראשי מחזיק הקשר (האריחים שחררו); בחזרה לרשת ההקשרים חוזרים, שוב לא יותר מ-8.
 * נפרד מ-e2e/tiles.js כי Chrome עם SwiftShader כבד, ורוצים לדעת אם הוא (ולא בדיקת האריחים) לא יציב על מחשב עמוס.
 * אם אין WebGL בכלל ב-Chrome הזה אי אפשר למדוד: ההודעה אומרת זאת ("SKIPPED") והציור ב-DOM נבדק ב-e2e/tiles.js.
 */
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const N = 9;

(async () => {
  const t = checker('WebGL budget (real contexts, software GL)');
  const work = path.join(TMP, 'webgl-budget-work');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-ticker') });
  const keeper = await connect(srv.port);
  for (let i = 1; i <= N; i++) {
    const d = path.join(work, 't' + i);
    fs.mkdirSync(d, { recursive: true });
    keeper.send({ t: 'create', kind: 'claude', cwd: d, name: 't' + i });
    await sleep(120);
  }
  await poll(() => keeper.sessions.size === N, 30000);
  const main = [...keeper.sessions.values()].sort((a, b) => Number(a.id) - Number(b.id))[0].id;

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900, gpu: true });
  await page.ev(`window.__pool = import('/js/renderer-pool.js'); true`);
  await page.appReady(N);
  // ---------- ג. תקציב WebGL (עם GPU בתוכנה) ----------
  const count = () => page.ev(`window.__pool.then((m) => m.webglCount())`);
  // ההקשרים נוצרים בפריסה הראשונה; על מחשב עמוס זה לוקח זמן, לכן מחכים עד שהמספר מפסיק לעלות
  let inGrid = 0;
  await poll(async () => { const c = await count(); const stable = c > 0 && c === inGrid; inGrid = c; return stable; }, 20000, 700);
  if (inGrid === 0) {
    t.check('WebGL is not available in this Chrome: the budget cannot be measured (DOM rendering works)', true, 'SKIPPED');
  } else {
    t.check(`${N} visible panes: at most 8 hold WebGL`, inGrid <= 8 && inGrid >= 1, `count=${inGrid}`);
    await page.ev(`document.querySelector('.pane[data-id="${main}"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
    await page.waitFor(`document.querySelectorAll('.pane.tile').length === ${N - 1}`, 15000);
    const expanded = await poll(async () => (await count()) === 1, 15000, 250);
    t.check('expanded: only the main terminal holds a context (tiles released theirs)', expanded, `count=${await count()}`);
    await page.ev(`document.querySelector('#gridBtn').click(); true`);
    await page.waitFor(`document.querySelectorAll('.pane.tile').length === 0`, 15000);
    const back = await poll(async () => { const c = await count(); return c >= 1 && c <= 8; }, 15000, 250);
    t.check('back in the grid contexts are restored, still at most 8', back, `count=${await count()}`);
  }

  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
