'use strict';
// @slow
/*
 * מגן הניווט החיצוני של דפדפן הבדיקות (T50, tests/lib/external-guard.js): כל דרך שבה דף יכול לנווט לסכמה שאינה web מבוטלת ונרשמת, והדף נשאר במקומו.
 * הבדיקה משתמשת בסכמה שלא קיימת (x-tg-test:) ולא ב-mailto: אמיתי, כדי שגם אם המגן שבור לא יקפוץ חלון "בחירת אפליקציה" על שולחן העבודה של המשתמש.
 * הדף הנבדק הוא תשובת JSON של השרת (מסמך בלי סקריפטים של האפליקציה), כדי שחגורת הבטיחות של האפליקציה לא תסתיר את פעולת המגן.
 */
const { checker, startServer, openPage, sleep } = require('../lib/harness');

(async () => {
  const t = checker('test browser cannot launch external apps');
  const srv = await startServer({});
  const page = await openPage(`http://127.0.0.1:${srv.port}/api/info`, { width: 800, height: 400 });
  const { ev } = page;
  const base = await ev('location.href');
  const log = () => ev('JSON.stringify(window.__tgBlockedExternal || [])').then(JSON.parse);
  t.check('the guard is installed in the very first document', Array.isArray(await ev('window.__tgBlockedExternal')), 'no __tgBlockedExternal');

  const opened = await ev(`window.open('x-tg-test:from-window-open', '_blank')`);
  t.check('window.open to a non-web scheme returns null and is logged', opened === null && (await log()).some((l) => l.startsWith('open ')), JSON.stringify(await log()));

  await ev(`(() => { const a = document.createElement('a'); a.href = 'x-tg-test:from-anchor'; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  t.check('an anchor click to a non-web scheme is cancelled and logged', (await log()).some((l) => l.startsWith('click ')), JSON.stringify(await log()));

  await ev(`(() => { const f = document.createElement('form'); f.action = 'x-tg-test:from-form'; document.body.appendChild(f); try { f.submit(); } catch {} try { f.requestSubmit(); } catch {} f.remove(); return true; })()`);
  const afterForm = await log();
  t.check('form submit() and requestSubmit() to a non-web scheme are cancelled and logged', afterForm.some((l) => l.startsWith('submit ')) && afterForm.some((l) => l.startsWith('requestSubmit ')), JSON.stringify(afterForm));

  const navApi = await ev('typeof window.navigation === "object" && typeof window.navigation.addEventListener === "function"');
  t.check('this Chrome has the Navigation API (the guard for location.href needs it)', navApi === true, String(navApi));
  await ev(`location.href = 'x-tg-test:from-location'; true`);
  await sleep(300);
  t.check('location.href = non-web scheme is cancelled and logged', (await log()).some((l) => l.startsWith('navigate ')), JSON.stringify(await log()));

  await ev(`window.open('file:///C:/Windows/notepad.exe', '_blank'); true`);
  t.check('file: is blocked too', (await log()).some((l) => l.startsWith('open file:')), JSON.stringify(await log()));

  t.check('the page itself never moved', (await ev('location.href')) === base, await ev('location.href'));
  const before = (await log()).length;
  await ev(`(() => { const a = document.createElement('a'); a.href = '#fine'; document.body.appendChild(a); a.click(); a.remove(); return true; })()`);
  await sleep(200);
  t.check('a normal same-page web link still works and is not logged', (await ev('location.hash')) === '#fine' && (await log()).length === before, await ev('location.hash'));

  page.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
