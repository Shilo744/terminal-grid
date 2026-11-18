'use strict';
/*
 * בידוד מהבית האמיתי (T43): בדיקה שמשתמשת ב-harness וכל שרת בדיקה שלה רצים עם בית זמני. נמצא שבדיקה יצרה זוג סוכנים בתיקיית הבית האמיתית של המשתמש
 * וכתבה לשם .duo\CHAT.md ו-TASKS.md מזויפים ("first thing", "done by the fake worker"). כאן: הבית הזמני פעיל בתהליך הבדיקה ובשרת, וזוג שנוצר "בבית" כותב רק לשם.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FIXTURES, REAL_HOME, TEST_HOME, poll, checker, startServer, connect, getJson } = require('../lib/harness');

(async () => {
  const t = checker('tests never touch the real home folder');
  const start = Date.now();
  t.check('the test process runs with a temporary home (USERPROFILE, HOME, os.homedir)', process.env.USERPROFILE === TEST_HOME && process.env.HOME === TEST_HOME && os.homedir() === TEST_HOME && TEST_HOME !== REAL_HOME && TEST_HOME.includes(path.join('tests', '.tmp')), `${process.env.USERPROFILE} vs ${REAL_HOME}`);
  t.check('HOMEDRIVE + HOMEPATH point to the same folder', path.resolve(process.env.HOMEDRIVE + process.env.HOMEPATH) === path.resolve(TEST_HOME));
  t.check('the real home is remembered only for the runner guard (it is not the test home)', !!REAL_HOME && path.resolve(REAL_HOME) !== path.resolve(TEST_HOME));

  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo') });
  const c = await connect(srv.port); // מחכה שהשרת יעלה
  const info = await getJson(`http://127.0.0.1:${srv.port}/api/info`);
  t.check('a test server reports the temporary home as the user home (the default folder for new terminals and pairs)', path.resolve(info.home) === path.resolve(TEST_HOME), info.home);

  // זוג שנוצר "בבית" (ברירת המחדל של חלון היצירה) כותב רק לבית הזמני
  c.send({ t: 'duo', op: 'create', project: process.env.USERPROFILE, goal: 'isolation check', reqId: 'iso' });
  await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const mine = path.join(TEST_HOME, '.duo');
  t.check('the pair created "in the home folder" wrote its .duo files into the temporary home', await poll(() => fs.existsSync(path.join(mine, 'STATUS.json')) && fs.existsSync(path.join(mine, 'TASKS.md')), 10000, 100));
  const real = path.join(REAL_HOME, '.duo');
  let touched = [];
  try { touched = [real, ...fs.readdirSync(real).map((f) => path.join(real, f))].filter((p) => fs.statSync(p).mtimeMs > start); } catch { /* אין תיקייה: תקין */ }
  t.check('and nothing in the real home .duo folder is newer than this test', touched.length === 0, touched.join(', '));
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
