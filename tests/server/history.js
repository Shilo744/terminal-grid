'use strict';
// @slow
/*
 * היסטוריית שיחות (/api/history) ו-transcriptExists אחרי שהפכו לאסינכרוניים עם מטמון (T27):
 *  - התוצאה נכונה (קבוצות לפי תיקייה, כותרות, מיון), ובקשה שנייה בתוך 3 שניות מגיעה מהמטמון;
 *  - סריקה גדולה (600 קבצים) לא חוסמת את לולאת האירועים: בזמן שהיא רצה השרת ממשיך לענות (/api/health) תוך זמן קצר.
 * הבית (USERPROFILE) מוחלף בתיקייה זמנית, כך שזה לא נוגע בהיסטוריה האמיתית.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { APP, TMP, sleep, checker, startServer, connect, getJson, post } = require('../lib/harness');

(async () => {
  const t = checker('history scan (async, cached)');
  const home = path.join(TMP, 'history-home');
  fs.rmSync(home, { recursive: true, force: true });
  const proj = path.join(home, '.claude', 'projects');
  // 600 שיחות ב-30 פרויקטים; הקבצים גדולים מספיק כדי שפענוח יעלה (כ-150KB: ראש הקובץ + זנב נקראים)
  const filler = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(900) }] } });
  const ids = [];
  for (let p = 0; p < 30; p++) {
    const dir = path.join(proj, 'C--work-proj' + p);
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0; n < 20; n++) {
      const id = crypto.randomUUID();
      ids.push(id);
      const lines = [JSON.stringify({ type: 'user', cwd: `C:\\work\\proj${p}`, message: { content: `question ${p}-${n}` } })];
      for (let k = 0; k < 160; k++) lines.push(filler);
      fs.writeFileSync(path.join(dir, id + '.jsonl'), lines.join('\n') + '\n');
      const when = new Date(Date.now() - (p * 20 + n) * 60000);
      fs.utimesSync(path.join(dir, id + '.jsonl'), when, when);
    }
  }

  const srv = await startServer({ cwd: path.resolve(process.env.APP_DIR || APP), env: { USERPROFILE: home } });
  const keeper = await connect(srv.port); // מחכה שהשרת יעלה
  // בזמן הסריקה הראשונה (אין מטמון) בודקים שהשרת מגיב: דוגמים /api/health במקביל
  await getJson(`http://127.0.0.1:${srv.port}/api/health?reset=1`);
  const pings = [];
  let scanning = true;
  const pinger = (async () => { while (scanning) { const t0 = Date.now(); await getJson(`http://127.0.0.1:${srv.port}/api/health`); pings.push(Date.now() - t0); await sleep(10); } })();
  const t0 = Date.now();
  // כמו הלקוח: אם הסריקה הראשונה לא נגמרה בתקציב הזמן מקבלים partial ושואלים שוב
  let first = await post(srv.port, '/api/history');
  const partialSeen = !!first.partial;
  const firstCallMs = Date.now() - t0;
  while (first.partial && Date.now() - t0 < 60000) { await sleep(300); first = await post(srv.port, '/api/history'); }
  const firstMs = Date.now() - t0;
  scanning = false;
  await pinger;

  t.check('all 30 projects are listed', first.projects.length === 30, String(first.projects.length));
  t.check('each project has its 20 conversations', first.projects.every((g) => g.sessions.length === 20));
  t.check('titles come from the first user message', first.projects.some((g) => g.sessions.some((s) => s.title === 'question 0-0')));
  t.check('newest project first, conversations newest first', first.projects[0].name === 'proj0' && first.projects[0].sessions[0].title === 'question 0-0');
  t.check('the first call answers within the time budget (partial or complete), never hangs', firstCallMs < 3000, `first call ${firstCallMs}ms, partial=${partialSeen}, full scan ${firstMs}ms`);
  t.check('the scan completes (no partial flag at the end)', !first.partial);
  // יחסי ולא מוחלט: על מחשב רווי (ה-CPU של כל המחשב ב-90%+) גם סריקה תקינה נמשכת עשרות שניות והשרת עצמו לא מתוזמן. סריקה סינכרונית (לפני T27)
  // חסמה את הלולאה כמעט לכל משך הסריקה (3.66s מתוך 3.7s); אחרי התיקון הפינג הגרוע ביותר הוא שבריר ממנה
  const worst = Math.max(...pings);
  t.check('the server kept answering during the scan (worst ping a small fraction of the scan time)', worst < Math.max(250, firstMs * 0.3), `pings=${pings.length} worst=${worst}ms scan=${firstMs}ms`);

  const t1 = Date.now();
  const second = await post(srv.port, '/api/history');
  const secondMs = Date.now() - t1;
  t.check('a second request within the TTL is served from the cache (no rescan)', second.projects.length === 30 && secondMs < Math.max(400, firstMs / 5), `${secondMs}ms vs first ${firstMs}ms`);

  // מפתח "פתוחה" נשאר בתשובה (נוסף בכל תשובה, לא נשמר במטמון)
  t.check('every conversation carries open/live flags', second.projects[0].sessions.every((s) => 'open' in s && 'live' in s));

  const health = await getJson(`http://127.0.0.1:${srv.port}/api/health`);
  t.check('the server watchdog never saw the loop blocked for a large part of the scan', health.blocked.worstMs < Math.max(300, firstMs * 0.3), JSON.stringify(health.blocked));

  keeper.close(); srv.stop();
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
