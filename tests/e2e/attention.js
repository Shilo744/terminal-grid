'use strict';
// @slow
/*
 * חוויית "מי צריך אותי" (T12), עם אירועי hooks אמיתיים דרך /api/agent/event ו-Notification מדומה:
 *  - הכפתור "N ממתינים לך" ו-Alt+W: הדחוף ראשון (צריך אישור), לחיצות חוזרות עוברות במעגל; title עם הזמן במצב בריחוף הכותרת;
 *  - סמל הלשונית מקבל נקודה כתומה כשמישהו מחכה וחוזר כשאף אחד לא;
 *  - התראות: כבוי כברירת מחדל; הצעה חד-פעמית בחזרה לחלון; הפעלה דרך ההצעה; רק כשהחלון לא ממוקד; צריך אישור, או סיים אחרי 20 שניות עבודה;
 *    tag לכל טרמינל; הרשאה שנדחתה משאירה את המתג כבוי עם הסבר בהגדרות.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const postEvent = (port, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/agent/event', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'x-tg': '1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
  rq.on('error', reject); rq.end(data);
});

// מוזרק לפני שהדף נטען: מצב מיקוד ו-Notification בשליטת הבדיקה
const STUBS = `
  window.__focus = true; window.__perm = 'default'; window.__grant = true; window.__notes = []; window.__asked = 0;
  document.hasFocus = () => window.__focus;
  window.Notification = class { constructor(title, opts) { this.title = title; window.__notes.push({ title, ...opts }); } close() {} static get permission() { return window.__perm; } static requestPermission() { window.__asked++; window.__perm = window.__grant ? 'granted' : 'denied'; return Promise.resolve(window.__perm); } };`;

(async () => {
  const t = checker('attention UX (summary button, Alt+W, favicon, notifications)');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-agent') });
  const keeper = await connect(srv.port);
  const work = path.join(TMP, 'attention-work');
  fs.mkdirSync(work, { recursive: true });
  for (const n of ['A', 'B', 'C', 'D']) keeper.send({ t: 'create', kind: 'claude', cwd: work, name: n });
  await poll(() => keeper.sessions.size === 4, 20000);
  const id = (n) => [...keeper.sessions.values()].find((s) => s.name === n).id;
  const [A, B, C, D] = ['A', 'B', 'C', 'D'].map(id);

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: STUBS });
  await page.reload();
  await page.appReady(4);
  const ev = (p, body) => postEvent(srv.port, { paneId: p, ...body });
  const pane = (x) => `document.querySelector('.pane[data-id="${x}"]')`;
  const focusedId = () => page.ev(`(document.querySelector('.pane.focused') || {}).dataset ? document.querySelector('.pane.focused').dataset.id : ''`);
  const click = (sel) => page.ev(`document.querySelector(${JSON.stringify(sel)}).click(); true`);
  const waitText = (sel, re) => page.waitFor(`/${re}/.test((document.querySelector(${JSON.stringify(sel)}) || {}).textContent || '')`, 8000);
  const focusPane = (x) => page.ev(`${pane(x)}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  const key = (type, extra) => page.call('Input.dispatchKeyEvent', { type, key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, ...extra });
  const notes = () => page.ev('JSON.stringify(window.__notes)').then(JSON.parse);
  const icon = () => page.ev(`document.querySelector('link[rel="icon"]').href`);

  // ---------- כפתור הסיכום, Alt+W, כותרת עם זמן ----------
  await focusPane(D);
  for (const p of [A, B, C, D]) await ev(p, { event: 'start' });
  await ev(A, { event: 'submit' });
  await ev(A, { event: 'notify', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await ev(B, { event: 'submit' });
  await ev(B, { event: 'stop' });
  await ev(C, { event: 'submit' });
  await waitText('#summary .stat-wait', '2');
  // C הוא האחרון שנשלח: מחכים שגם הוא נספר כפעיל (הספירות מתעדכנות בבדיקה אחת, אבל האירועים מגיעים אחד אחד)
  await page.waitFor(`/1\\s*פעיל/.test(document.querySelector('#summary').textContent)`, 8000);
  t.check('the summary shows "2 ממתינים לך" as a button', await page.ev(`document.querySelector('#summary .stat-wait').tagName`) === 'BUTTON');
  t.check('the summary counts the working terminal too', /1\s*פעיל/.test(await page.ev(`document.querySelector('#summary').textContent`)));
  t.check('the tab title shows the waiting count', await page.ev('document.title').then((x) => x.startsWith('(2)')));

  await click('#summary .stat-wait');
  t.check('first click: the terminal that needs approval (not the one that merely finished)', await poll(async () => (await focusedId()) === A, 4000, 100), await focusedId());
  await sleep(600);
  await click('#summary .stat-wait');
  t.check('second click: moves on to the finished one', await poll(async () => (await focusedId()) === B, 4000, 100), await focusedId());
  await sleep(900);
  await click('#summary .stat-wait');
  t.check('third click: only the approval is still waiting, so it cycles back to it', await poll(async () => (await focusedId()) === A, 4000, 100), await focusedId());

  await focusPane(D);
  await sleep(600);
  await key('keyDown', { modifiers: 1, text: 'w' }); await key('keyUp', { modifiers: 1 });
  t.check('Alt+W jumps to the waiting terminal', await poll(async () => (await focusedId()) === A, 4000, 100), await focusedId());

  await page.ev(`${pane(A)}.querySelector('.pane-head').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); true`);
  const hover = await page.ev(`${pane(A)}.querySelector('.pstatus').title`);
  t.check('hovering the header gives the state and the time in it ("מזה ...")', /צריך אישור · מזה/.test(hover), hover);

  // ---------- סמל הלשונית ----------
  const withDot = await icon();
  t.check('while someone waits the favicon is the canvas one', withDot.startsWith('data:image/png'));
  const px = await page.ev(`new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.drawImage(i, 0, 0); res(Array.from(g.getImageData(24, 8, 1, 1).data)); }; i.src = document.querySelector('link[rel="icon"]').href; })`);
  t.check('and it has an amber dot in the corner', px[0] > 200 && px[1] > 140 && px[2] < 110, JSON.stringify(px));
  await ev(A, { event: 'stop' });
  await focusPane(A);
  await focusPane(B);
  t.check('when nobody waits any more the original icon returns', await poll(async () => (await icon()).startsWith('data:image/svg+xml'), 6000, 200), (await icon()).slice(0, 30));
  t.check('and the summary has no waiting button', await poll(() => page.ev(`!document.querySelector('#summary .stat-wait')`), 4000, 200));
  t.check('Alt+W with nobody waiting just says so (focus stays)', await (async () => {
    await key('keyDown', { modifiers: 1, text: 'w' }); await key('keyUp', { modifiers: 1 });
    return poll(() => page.ev(`!!document.querySelector('#toasts .toast')`), 3000, 100);
  })());

  // ---------- התראות שולחן עבודה ----------
  const setting = () => page.ev(`fetch('/api/settings').then((r) => r.json()).then((j) => j.settings.ui.notifyWaiting)`);
  t.check('desktop notifications are off by default', (await setting()) === false);
  await page.ev('window.__focus = false; true');
  await ev(C, { event: 'notify', notificationType: 'permission_prompt', message: 'permission' });
  await sleep(500);
  t.check('with the setting off nothing is sent even though the window is unfocused', (await notes()).length === 0);
  t.check('the one-time offer is armed (nothing shown while nobody is looking)', await page.ev(`!document.querySelector('.toast-action')`));
  await page.ev(`window.__focus = true; window.dispatchEvent(new Event('focus')); true`);
  t.check('coming back to the window shows the offer with an action button', await page.waitFor(`!!document.querySelector('.toast-action')`, 5000));
  t.check('the button says "להפעיל התראות"', (await page.ev(`document.querySelector('.toast-action').textContent`)) === 'להפעיל התראות');
  await click('.toast-action');
  t.check('clicking it asks for permission (once) and turns the setting on', await poll(async () => (await setting()) === true, 6000, 200) && (await page.ev('window.__asked')) === 1);
  t.check('the offer is remembered: it will not be shown again', await page.ev(`localStorage.getItem('tg.notifyOffered')`) === 'true');

  // לא ממוקד: צריך אישור -> התראה עם שם הטרמינל ו-tag; ממוקד: אין
  await page.ev('window.__focus = true; true');
  await ev(D, { event: 'submit' });
  await ev(D, { event: 'notify', notificationType: 'permission_prompt', message: 'permission' });
  await sleep(500);
  t.check('a focused window gets no desktop notification', (await notes()).length === 0);
  await ev(D, { event: 'stop' });
  await page.ev('window.__focus = false; true');
  await ev(C, { event: 'submit' }); // C עדיין במצב "צריך אישור" מקודם; הודעה חדשה מחזירה אותו לעבודה
  await ev(C, { event: 'notify', notificationType: 'permission_prompt', message: 'permission' });
  t.check('unfocused: a terminal that needs approval notifies with its name, a Hebrew body and a per-terminal tag', await poll(async () => (await notes()).length === 1, 5000, 100) && JSON.stringify((await notes())[0]) === JSON.stringify({ title: 'C', body: 'צריך אישור', tag: 'tg-' + C }), JSON.stringify(await notes()));
  // סיום אחרי עבודה קצרה: אין התראה. אחרי 20 שניות לפחות: יש
  await ev(C, { event: 'submit' });
  await ev(C, { event: 'stop' });
  await sleep(600);
  t.check('finishing after a short job (under 20 s) is silent', (await notes()).length === 1, JSON.stringify(await notes()));
  await ev(C, { event: 'submit' });
  await page.ev(`import('/js/state.js').then(({ state }) => { state.panes.get('${C}').meta.agentSince = Date.now() - 25000; return true; })`);
  await ev(C, { event: 'stop' });
  t.check('finishing after a 25 s job notifies "סיים — ממתין לך"', await poll(async () => (await notes()).length === 2, 5000, 100) && (await notes())[1].body === 'סיים — ממתין לך');
  t.check('both notifications of the same terminal share one tag (the browser replaces, never stacks)', (await notes())[0].tag === (await notes())[1].tag);

  // ---------- הרשאה שנדחתה ----------
  await page.ev(`window.__focus = true; window.__perm = 'default'; window.__grant = false; true`);
  await page.ev(`fetch('/api/settings', { method: 'GET' }).then(() => true)`);
  keeper.send({ t: 'settings:set', patch: { ui: { notifyWaiting: false } } });
  await poll(async () => (await setting()) === false, 6000, 200);
  await click('#settingsBtn');
  await page.waitFor(`!!document.querySelector('[data-row="notifyWaiting"] .sw')`, 5000);
  await click('[data-row="notifyWaiting"] .sw');
  t.check('when the browser denies permission the switch stays off', await poll(() => page.ev(`document.querySelector('[data-row="notifyWaiting"] .sw').getAttribute('aria-checked') === 'false'`), 4000, 150) && (await setting()) === false);
  t.check('and a note under the row explains it', await poll(() => page.ev(`(() => { const n = document.querySelector('[data-row="notifyWaiting"] .st-row-note'); return !!n && !n.hidden && /חסם/.test(n.textContent); })()`), 4000, 150));
  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
