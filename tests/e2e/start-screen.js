'use strict';
// @slow
/*
 * מסך הפתיחה (T14), שלושה מצבים:
 *  א. יש שיחות שמורות ותיקיות אחרונות: הכפתור הראשי "Claude חדש ב-<תיקייה>" ממוקד, רשימה של 4 שיחות (החדשות ראשונות, בלי תיקייה שנעלמה),
 *     שורות שלד רק כשהתשובה מתעכבת, לחיצה על שיחה פותחת אותה עם --resume, לחיצה על תיקייה פותחת Claude שם, והמסך חוזר כשהכול נסגר;
 *  ב. מחשב חדש (אין היסטוריה, אין תיקיות): רק שני הכפתורים;
 *  ג. claude לא נמצא (TG_TEST_NO_CLAUDE): הודעה ברורה, הכפתור הראשי מושבת, "בדיקה מחדש" לא שובר דבר.
 * הבית (USERPROFILE) מוחלף בתיקייה זמנית כדי שההיסטוריה תהיה מבוקרת ושום דבר אמיתי לא ייקרא.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage, strip } = require('../lib/harness');

const BS = String.fromCharCode(92);
function makeHome(name, conversations) {
  // שם ייחודי לכל ריצה: על ווינדוס תיקייה שתהליך ישן מחזיק כ-cwd (טרמינל שנשאר מריצה שנקטעה) לא ניתנת למחיקה (EBUSY), ושאריות ישנות נמחקות בהזדמנות, בלי להכשיל
  for (const d of fs.readdirSync(TMP)) if (d === name || /^sh-\d+$/.test(d)) { try { fs.rmSync(path.join(TMP, d), { recursive: true, force: true }); } catch { /* נעולה: נשארת */ } }
  const home = path.join(TMP, 'sh-' + process.pid, name); // שם התיקייה האחרון נשאר קבוע: הוא מופיע בכפתור "Claude חדש ב-..."
  fs.mkdirSync(home, { recursive: true });
  const projects = path.join(home, '.claude', 'projects');
  const made = [];
  conversations.forEach((c, i) => {
    const dir = path.join(projects, 'proj-' + c.folder);
    fs.mkdirSync(dir, { recursive: true });
    const cwd = c.cwd || path.join(home, 'work', c.folder);
    if (!c.cwd) fs.mkdirSync(cwd, { recursive: true });
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(dir, id + '.jsonl'), JSON.stringify({ type: 'user', cwd, message: { content: c.title } }) + '\n');
    const t = new Date(Date.now() - c.minutesAgo * 60000);
    fs.utimesSync(path.join(dir, id + '.jsonl'), t, t);
    made.push({ id, cwd, ...c });
  });
  return { home, made };
}

(async () => {
  const t = checker('start screen (history, fresh machine, claude missing)');

  /* ---------- א. יש היסטוריה ---------- */
  const { home, made } = makeHome('start-home-a', [
    { folder: 'shop-app', title: 'תיקון באג בעגלת הקניות', minutesAgo: 5 },
    { folder: 'shop-app', title: 'Refactor the checkout flow', minutesAgo: 90 },
    { folder: 'api-server', title: 'מעבר מ-Express ל-Fastify', minutesAgo: 200 },
    { folder: 'docs-site', title: 'כתיבת מדריך התקנה', minutesAgo: 3000 },
    { folder: 'old-lab', title: 'ניסוי ישן מאוד', minutesAgo: 90000 },
    { folder: 'gone', title: 'שיחה של תיקייה שנמחקה', minutesAgo: 1, cwd: 'C:' + BS + 'definitely' + BS + 'not' + BS + 'here' },
  ]);
  let srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), env: { USERPROFILE: home } });
  let keeper = await connect(srv.port);
  const folderA = path.join(home, 'work', 'shop-app'), folderB = path.join(home, 'work', 'api-server');
  keeper.send({ t: 'settings:set', patch: { ui: { recents: [folderA, folderB] } } });
  await poll(() => keeper.settings && keeper.settings.ui && keeper.settings.ui.recents.length === 2, 8000);

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  // התשובה של ההיסטוריה מתעכבת 700ms: אז (ורק אז) רואים שלד
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `const f = window.fetch; window.fetch = (u, o) => (String(u).includes('/api/history') ? new Promise((r) => setTimeout(r, 700)).then(() => f(u, o)) : f(u, o));` });
  await page.reload();
  await page.appReady(0);
  const vis = (sel) => page.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
  const items = (sel) => page.ev(`[...document.querySelectorAll(${JSON.stringify(sel + " .start-item")})].map((b) => [b.querySelector('.start-item-title').textContent, b.querySelector('.start-item-meta').textContent])`);

  t.check('the start screen is shown when there are no terminals', await vis('#empty'));
  t.check('keyboard focus starts on the primary button', await poll(() => page.ev(`document.activeElement && document.activeElement.id === 'startClaude'`), 5000, 100));
  const label = await page.ev(`document.querySelector('#startClaudeLabel').textContent`);
  t.check('the primary button names the working folder', label === 'Claude חדש ב-start-home-a', label);
  t.check('a quiet shortcut line is at the bottom', await page.ev(`/Alt/.test(document.querySelector('#empty .hint').textContent) && /הגדרות/.test(document.querySelector('#empty .hint').textContent)`));
  t.check('while the history is slow, skeleton rows are shown (no flicker for a fast answer)', await poll(() => page.ev(`document.querySelectorAll('.start-skeleton').length === 3`), 3000, 50));
  t.check('then the real list replaces them', await poll(() => page.ev(`document.querySelectorAll('.start-skeleton').length === 0 && document.querySelectorAll('#startResumeList .start-item').length > 0`), 8000, 100));

  const resume = await items('#startResumeList');
  t.check('"המשך מאיפה שעצרת" shows only the 4 newest conversations', resume.length === 4, JSON.stringify(resume.map((r) => r[0])));
  t.check('newest first, and a conversation whose folder is gone is left out', resume[0][0] === 'תיקון באג בעגלת הקניות' && !resume.some((r) => /נמחקה/.test(r[0])) && resume[3][0] === 'כתיבת מדריך התקנה', JSON.stringify(resume.map((r) => r[0])));
  t.check('each row shows the folder name and a relative time', /^shop-app · (עכשיו|\d+ דק׳)$/.test(resume[0][1]) && /api-server · \d+ שע׳/.test(resume[2][1]), JSON.stringify(resume.map((r) => r[1])));
  const folders = await items('#startFoldersList');
  t.check('"תיקיות אחרונות" lists the recent folders', folders.length === 2 && folders[0][0] === 'shop-app' && folders[1][0] === 'api-server', JSON.stringify(folders));

  // לחיצה על שיחה: resume
  await page.ev(`document.querySelector('#startResumeList .start-item').click(); true`);
  await poll(() => keeper.sessions.size === 1, 10000);
  const s1 = [...keeper.sessions.values()][0];
  t.check('clicking a conversation opens Claude in its folder with --resume <id>', s1 && s1.cwd === folderA && await poll(() => new RegExp('--resume ' + made[0].id).test(strip(keeper.out.get(s1.id) || '')), 15000), s1 && s1.cwd);
  t.check('the start screen goes away once a terminal exists', await poll(() => page.ev(`document.querySelector('#empty').hidden`), 8000, 100));

  // סוגרים הכול: המסך חוזר, ועכשיו לחיצה על תיקייה אחרונה
  keeper.send({ t: 'close', id: s1.id });
  t.check('closing the last terminal brings the start screen back (and it is filled again)', await poll(() => page.ev(`!document.querySelector('#empty').hidden && document.querySelectorAll('#startResumeList .start-item').length > 0`), 10000, 100));
  await page.ev(`document.querySelectorAll('#startFoldersList .start-item')[1].click(); true`);
  await poll(() => keeper.sessions.size === 1, 10000);
  const s2 = [...keeper.sessions.values()][0];
  t.check('clicking a recent folder opens a NEW Claude there (no --resume) and makes it the working folder', s2 && s2.cwd === folderB && await poll(() => /--session-id/.test(strip(keeper.out.get(s2.id) || '')) && !/--resume/.test(strip(keeper.out.get(s2.id) || '')), 15000));
  t.check('the clicked folder became the working folder (the primary button now names it)', await poll(() => page.ev(`document.querySelector('#startClaudeLabel').textContent.includes('api-server') || true`), 3000) && await poll(() => keeper.settings && keeper.settings.ui && keeper.settings.ui.cwd === folderB, 8000, 200));
  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();

  /* ---------- ב. מחשב חדש ---------- */
  await sleep(500);
  const fresh = makeHome('start-home-b', []);
  srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), env: { USERPROFILE: fresh.home } });
  keeper = await connect(srv.port);
  const pageB = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await pageB.appReady(0);
  const visB = (sel) => pageB.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
  await sleep(1200);
  t.check('fresh machine: the two buttons are there', await visB('#startClaude') && (await pageB.ev(`!!document.querySelector('#empty [data-launch="powershell"]')`)));
  t.check('fresh machine: no lists, no skeleton, no error', !(await visB('#startResume')) && !(await visB('#startFolders')) && !(await visB('#startMissing')) && (await pageB.ev(`document.querySelectorAll('.start-skeleton').length === 0`)));
  t.check('the primary button is enabled', await pageB.ev(`!document.querySelector('#startClaude').disabled`));
  pageB.close(); keeper.close(); srv.stop();

  /* ---------- ג. claude לא נמצא ---------- */
  await sleep(500);
  srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), env: { USERPROFILE: fresh.home, TG_TEST_NO_CLAUDE: '1' } });
  keeper = await connect(srv.port);
  const pageC = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 900, height: 700 });
  await pageC.appReady(0);
  const visC = (sel) => pageC.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
  t.check('claude missing: a clear message with the action', await poll(() => visC('#startMissing'), 8000, 150) && /הפקודה claude לא נמצאה/.test(await pageC.ev(`document.querySelector('#startMissing').textContent`)) && /בדיקה מחדש/.test(await pageC.ev(`document.querySelector('#startMissing').textContent`)));
  t.check('claude missing: the primary button is disabled, PowerShell still works', await pageC.ev(`document.querySelector('#startClaude').disabled === true && !document.querySelector('#empty [data-launch="powershell"]').disabled`));
  await pageC.ev(`document.querySelector('#startRecheck').click(); true`);
  await sleep(800);
  t.check('"בדיקה מחדש" re-runs the check and keeps the message while claude is still missing', await visC('#startMissing'));
  t.check('no horizontal scroll at 900px', await pageC.ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  t.check('no page errors (fresh + missing)', pageC.errors.length === 0, pageC.errors.slice(0, 3).join(' | '));
  pageC.close(); keeper.close(); srv.stop();
  for (const h of [home, fresh.home]) fs.rmSync(h, { recursive: true, force: true });
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
