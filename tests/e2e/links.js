'use strict';
// @slow
/*
 * קישורים בטרמינל (T47): קישורי OSC 8 (mailto:, file:///, https://) וכתובת רגילה בטקסט, בעכבר אמיתי (CDP):
 *  - לחיצה רגילה לא פותחת כלום (window.open לא נקרא, הדף לא מנווט);
 *  - Ctrl+לחיצה על https (קישור OSC 8 וכתובת בטקסט) קוראת ל-window.open עם noopener,noreferrer;
 *  - Ctrl+לחיצה על mailto ועל file מעתיקה ללוח ומציגה הודעה, ולעולם לא קוראת ל-window.open;
 *  - ריחוף מעל קישור מציג צ'יפ עם היעד ו"Ctrl+לחיצה", ונעלם ביציאה;
 *  - חגורת הבטיחות: עוגן עם סכמה שאינה web בדף עצמו נחסם. הבדיקה משתמשת בסכמה שלא קיימת (x-tg-test:) ולא ב-mailto: אמיתי: אם החגורה הייתה שבורה,
 *    mailto: היה מפעיל את תוכנת הדואר של המשתמש (T50); וגם מגן הניווט של הבדיקות (tests/lib/external-guard.js) לא הצטרך לפעול.
 */
const path = require('path');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('terminal links: Ctrl+click, web only');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-links') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'cl' });
  await poll(() => keeper.sessions.size === 1, 15000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(1);
  await page.waitFor(`document.querySelector('.pane-startup').hidden`, 15000);
  const id = [...keeper.sessions.values()][0].id;
  // מחכים שהפלט יצויר ושהקישורים יהיו רשומים
  await poll(() => ev(`(async () => { const { state } = await import('/js/state.js'); const p = state.panes.get('${id}'); const b = p.term.buffer.active; let t = ''; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l) t += l.translateToString(true); } return t.includes('plain-url'); })()`), 10000, 100);
  await sleep(500);
  // ריגול: window.open והעתקה ללוח
  await ev(`window.__opened = []; window.open = (...a) => { window.__opened.push(a); return null; }; window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (s) => { window.__copied.push(s); return Promise.resolve(); } }, configurable: true }); window.__url0 = location.href; true`);

  // מיקום (פיקסלים) של טקסט בתוך הטרמינל, לפי מאגר המסך ומידות התא
  const where = (needle) => ev(`(async () => { const { state } = await import('/js/state.js'); const p = state.panes.get('${id}'); const b = p.term.buffer.active; const scr = p.el.querySelector('.xterm-screen').getBoundingClientRect();
    for (let y = 0; y < p.term.rows; y++) { const l = b.getLine(b.baseY + y); if (!l) continue; const s = l.translateToString(true); const x = s.indexOf(${JSON.stringify('__N__')}.replace('__N__', ${JSON.stringify(needle)})); if (x >= 0) return { x: scr.left + (x + 2) * scr.width / p.term.cols, y: scr.top + (y + 0.5) * scr.height / p.term.rows }; } return null; })()`);
  const click = async (pos, modifiers = 0) => {
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, modifiers });
    await sleep(250);
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1, modifiers });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1, modifiers });
    await sleep(300);
  };
  const state = () => ev(`({ opened: window.__opened, copied: window.__copied, same: location.href === window.__url0, toast: (document.querySelector('#toasts') || {}).textContent || '', chip: (document.querySelector('.link-chip') || {}).textContent || null })`);
  const reset = () => ev(`window.__opened.length = 0; window.__copied.length = 0; true`);

  const mail = await where('worker@local'), file = await where('open notepad'), web = await where('the docs'), plain = await where('example.org');
  t.check('(setup) all four links are on screen', !!mail && !!file && !!web && !!plain, JSON.stringify({ mail, file, web, plain }));

  /* ---------- לחיצה רגילה: לא נפתח כלום ---------- */
  for (const [name, pos] of [['mailto', mail], ['file', file], ['https', web], ['plain url', plain]]) {
    await reset();
    await click(pos);
    const s = await state();
    t.check(`a plain click on the ${name} link opens nothing and copies nothing`, s.opened.length === 0 && s.copied.length === 0 && s.same, JSON.stringify(s));
  }

  /* ---------- ריחוף: צ'יפ ---------- */
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: web.x, y: web.y });
  await sleep(400);
  const chip = await ev(`(document.querySelector('.link-chip') || {}).textContent || null`);
  t.check('hovering a web link shows the chip "Ctrl+לחיצה לפתיחה: <target>"', !!chip && /Ctrl\+לחיצה לפתיחה/.test(chip) && /example\.com\/docs/.test(chip), String(chip));
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 600 });
  await sleep(300);
  t.check('and it disappears when the pointer leaves', (await ev(`!document.querySelector('.link-chip')`)) === true);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mail.x, y: mail.y });
  await sleep(400);
  const chip2 = await ev(`(document.querySelector('.link-chip') || {}).textContent || null`);
  t.check('hovering a mailto link says it will be copied, not opened', !!chip2 && /להעתקה/.test(chip2) && /mailto:worker@local/.test(chip2), String(chip2));
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 600 });

  /* ---------- Ctrl+לחיצה ---------- */
  await reset();
  await click(web, 2);
  let s = await state();
  t.check('Ctrl+click on the https link calls window.open with noopener,noreferrer', s.opened.length === 1 && s.opened[0][0] === 'https://example.com/docs' && s.opened[0][1] === '_blank' && /noopener/.test(s.opened[0][2]) && /noreferrer/.test(s.opened[0][2]) && s.same, JSON.stringify(s));
  await reset();
  await click(plain, 2);
  s = await state();
  t.check('Ctrl+click on a plain-text URL opens it the same way', s.opened.length === 1 && /^https:\/\/example\.org\/plain-url/.test(s.opened[0][0]) && /noopener/.test(s.opened[0][2]), JSON.stringify(s));
  await reset();
  await click(mail, 2);
  s = await state();
  t.check('Ctrl+click on mailto: never opens, copies the address and shows the toast', s.opened.length === 0 && s.copied.length === 1 && s.copied[0] === 'worker@local' && /הקישור הועתק \(לא נפתח אוטומטית\)/.test(s.toast) && s.same, JSON.stringify(s));
  await reset();
  await click(file, 2);
  s = await state();
  t.check('Ctrl+click on file:/// never opens, copies the link and shows the toast', s.opened.length === 0 && s.copied.length === 1 && /^file:\/\/\/C:\/Windows\/notepad\.exe/.test(s.copied[0]) && s.same, JSON.stringify(s));

  /* ---------- חגורת בטיחות ---------- */
  const belt = await ev(`(() => { const a = document.createElement('a'); a.href = 'x-tg-test:nothing'; a.textContent = 'x'; document.body.appendChild(a); const e = new MouseEvent('click', { bubbles: true, cancelable: true }); a.dispatchEvent(e); const prevented = e.defaultPrevented; const b = document.createElement('a'); b.href = 'https://example.com/'; document.body.appendChild(b); const e2 = new MouseEvent('click', { bubbles: true, cancelable: true }); b.addEventListener('click', (x) => x.preventDefault()); b.dispatchEvent(e2); a.remove(); b.remove(); return { mailtoBlocked: prevented, guardActed: (window.__tgBlockedExternal || []).length }; })()`);
  t.check('the app own page-wide seatbelt cancels navigation of a non-web anchor (the test guard did not have to)', belt.mailtoBlocked === true && belt.guardActed === 0, JSON.stringify(belt));
  t.check('no JavaScript errors and the app page never navigated', page.errors.length === 0 && (await state()).same, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
