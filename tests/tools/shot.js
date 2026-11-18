'use strict';
/*
 * כלי צילום ידני (לא חלק מ-`npm test`): צילום מסך אמיתי של האפליקציה כמו שהיא נראית בדפדפן.
 *
 *   node tests/tools/shot.js <out.png> [empty|grid|side] [רוחב] [גובה]
 *
 *   empty - אין טרמינלים (מסך פתיחה)
 *   grid  - טרמינל Claude מזויף שמדפיס עברית כמו Claude (שכבת ה-RTL דולקת כברירת מחדל)
 *   side  - כמו grid, ותפריט הצד פתוח
 *
 * למה העתק של האפליקציה: ברירת המחדל של תפריט הצד נשמרת ב-localStorage, ובפרופיל של Chrome שנוצר בכל הרצה
 * אי אפשר לזרוע אותה בצורה אמינה (Chrome כותב לדיסק רק אחרי כ-5 שניות). לכן משנים את ברירת המחדל בהעתק בלבד.
 * ההעתק נוצר עם copyFileSync (לא fs.cpSync, שמפיל את node בשקט) ועם junction ל-node_modules של הפרויקט.
 */
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, startServer, connect, chromeScreenshot } = require('../lib/harness');
const { makeAppCopy, patchDefault } = require('./lib/app-copy');

const [out, scenario = 'grid', width = '1500', height = '900'] = process.argv.slice(2);
if (!out) { console.error('usage: node tests/tools/shot.js <out.png> [empty|grid|side] [width] [height]'); process.exit(2); }

const COPY = path.join(TMP, 'app-copy');

const patchSideDefault = (dir) => patchDefault(dir, /store\.get\('side', false\)/g, "store.get('side', true)");

(async () => {
  makeAppCopy(COPY);
  if (scenario === 'side') patchSideDefault(path.join(COPY, 'public'));
  // duo: מסך הזוגות פתוח כברירת מחדל, עם זוג של סוכנים מזויפים שסיים סבב עבודה (בהעתק בלבד)
  if (scenario === 'duo') patchDefault(path.join(COPY, 'public'), /store\.get\('view', 'grid'\)/g, "store.get('view', 'duo')");

  const stateFile = path.join(TMP, 'shot-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* אין */ }
  const srv = await startServer({ cwd: COPY, stateFile, binDir: path.join(FIXTURES, scenario === 'duo' ? 'bin-duo' : 'bin-heb') });
  const keeper = await connect(srv.port);
  if (scenario === 'duo') {
    const project = path.join(TMP, 'shot-duo-project');
    fs.mkdirSync(project, { recursive: true });
    try { fs.rmSync(path.join(project, '.duo'), { recursive: true, force: true }); } catch { /* אין */ }
    keeper.send({ t: 'duo', op: 'create', project, goal: 'לבנות אתר מנוי לחדר כושר לפי המסמך שבתיקייה', permissionMode: 'auto', reqId: 'shot' });
    await sleep(14000); // מספיק לסבב מלא של הסוכנים המזויפים
  } else if (scenario !== 'empty') {
    keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Claude' });
    await sleep(2500);
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const ok = chromeScreenshot(`http://127.0.0.1:${srv.port}/`, path.resolve(out), { width: Number(width), height: Number(height) });
  console.log(ok ? 'saved ' + path.resolve(out) : 'NO SCREENSHOT');
  keeper.close(); srv.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
