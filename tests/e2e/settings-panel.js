'use strict';
/*
 * פאנל ההגדרות בדפדפן אמיתי: חלון קטן בעמודה אחת (בלי ניווט וחיפוש), נפתח בכפתור ובקיצור Ctrl+, (גם כשטרמינל ממוקד),
 * Esc סוגר והמיקוד חוזר. "תצוגה" פתוח, "מתקדם" מקופל כברירת מחדל, נפתח, ונשאר פתוח אחרי רענון.
 * שינוי גודל גופן/גובה שורה/סמן/גלילה/יישור עברית משפיע על כל הטרמינלים ונשמר בשרת; איפוס לשורה ואיפוס כללי בשתי לחיצות.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

// חתימת מידות התא של כל הטרמינלים (משתנה עם גודל גופן וגובה שורה)
const SIG = `JSON.stringify([...document.querySelectorAll('.term-host .xterm-screen')].map((s) => s.style.width + 'x' + s.style.height))`;
// the height of one text row of each terminal: it changes with the line height by itself (the screen height is rows x row height and can land on the same number by coincidence)
const ROWH = `JSON.stringify([...document.querySelectorAll('.term-host .xterm-rows')].map((r) => r.firstElementChild ? r.firstElementChild.style.height : ''))`;
const KEYS = { Escape: 27, ArrowLeft: 37, ArrowRight: 39 };

(async () => {
  const t = checker('settings panel');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'B' });
  for (let i = 0; i < 100 && keeper.sessions.size < 2; i++) await sleep(100);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(2);
  const saved = () => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8'));
  // ממתין עד שהתנאי על הקובץ השמור מתקיים (עד 5 שניות): השמירה היא דחייה של 200ms + הלוך-חזור לשרת
  const until = async (pred) => { for (let i = 0; i < 50; i++) { try { if (pred(saved())) return true; } catch { /* עוד לא נכתב */ } await sleep(100); } return false; };
  const press = async (key) => {
    const vk = KEYS[key];
    await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
    await sleep(250);
  };
  const open = () => ev(`document.querySelector('#settingsDlg').open`);
  const row = (id) => `document.querySelector('[data-row="${id}"]')`;
  const visible = (id) => ev(`(() => { const r = ${row(id)}; return !!r && r.getClientRects().length > 0; })()`);
  const setRange = (id, v) => ev(`(() => { const r = ${row(id)}.querySelector('input[type=range]'); r.value = ${v}; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  /* ---------- פתיחה וסגירה ---------- */
  t.check('gear button: title and aria-label "הגדרות"', await ev(`(() => { const b = document.querySelector('#settingsBtn'); return !!b && b.title.startsWith('הגדרות') && b.getAttribute('aria-label') === 'הגדרות'; })()`));
  t.check('the dialog starts closed', !(await open()));
  await ev(`document.querySelector('#settingsBtn').focus(); document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('the button opens it, focus is on the first control', (await open()) && (await ev(`document.activeElement.closest('[data-row]').dataset.row`)) === 'style');
  // מידות פריסה (offsetWidth) ולא getBoundingClientRect: לא מושפעות מאנימציית ה-scale של הפתיחה
  const box = await ev(`(() => { const d = document.querySelector('#settingsDlg'); return [d.offsetWidth, d.offsetHeight]; })()`);
  // עם שורת ההתראות וקבוצת Claude התוכן ארוך מ-720px: הדיאלוג נעצר במגבלה והתוכן גולל בתוכו (.st-content), לכן "בתוך המגבלה" כולל שווה לה
  t.check('compact: 560px wide, within the dialog height limit', box[0] === 560 && box[1] <= 720, box.join('x'));
  t.check('no section navigation and no search box (a handful of settings)', await ev(`!document.querySelector('#settingsNav') && !document.querySelector('#settingsQ') && !document.querySelector('#settingsDlg input[type=search]')`));
  t.check('the display rows are visible by default: style, accent, font, size, Hebrew alignment', (await visible('style')) && (await visible('accent')) && (await visible('fontFamily')) && (await visible('fontSize')) && (await visible('rtlLayer')));
  t.check('the advanced group is collapsed by default', (await ev(`document.querySelector('.st-adv-toggle').getAttribute('aria-expanded')`)) === 'false' && !(await visible('lineHeight')) && !(await visible('scrollback')));
  await press('Escape');
  t.check('Esc closes it', !(await open()));
  t.check('and focus returns to the opener', (await ev(`document.activeElement.id`)) === 'settingsBtn');

  await ev(`(() => { const ta = document.querySelector('.pane textarea'); ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true, cancelable: true })); })()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('Ctrl+, opens it while a terminal has focus', await open());
  await press('Escape');
  t.check('Esc closes it and the terminal gets its focus back', !(await open()) && (await ev(`document.activeElement.classList.contains('xterm-helper-textarea')`)));

  /* ---------- שינוי הגדרות: כל הטרמינלים, השרת, רענון ---------- */
  await ev(`document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  const sig0 = await ev(SIG);
  await setRange('fontSize', 18);
  await page.waitFor(`${SIG} !== ${JSON.stringify(sig0)}`, 10000);
  const sig1 = await ev(SIG);
  t.check('font size slider: every terminal follows', JSON.parse(sig0).length === 2 && JSON.parse(sig1).every((s, i) => s !== JSON.parse(sig0)[i]), `${sig0} -> ${sig1}`);
  t.check('the server saved 18, silently (no "saved" message anywhere)', (await until((x) => x.terminal.fontSize === 18)) && !(await ev(`document.querySelector('#settingsDlg').textContent.includes('נשמר') || !!document.querySelector('#toasts .toast')`)));
  t.check('the row shows the value text, and there are no per-row reset icons anywhere', (await ev(`${row('fontSize')}.querySelector('.rng-val').textContent`)) === '18px' && (await ev(`document.querySelectorAll('.st-reset').length`)) === 0);
  t.check('the live sample follows the size', (await ev(`getComputedStyle(document.querySelector('.st-sample')).fontSize`)) === '18px');
  t.check('keyboard zoom (Ctrl+=) stays in sync with the panel (goes to 19)', await ev(`(async () => { document.querySelector('#settingsDlg').close(); window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 700)); document.querySelector('#settingsBtn').click(); return ${row('fontSize')}.querySelector('input[type=range]').value === '19'; })()`));
  await page.reload();
  await page.waitFor(`document.querySelectorAll('.pane .xterm-screen').length === 2`);
  await ev(`document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('after a reload the size is still 19', (await ev(`${row('fontSize')}.querySelector('input[type=range]').value`)) === '19' && (await until((x) => x.terminal.fontSize === 19)));

  await setRange('fontSize', 14);
  t.check('moving the slider back restores 14 (no reset icon needed)', (await until((x) => x.terminal.fontSize === 14)) && (await ev(`${row('fontSize')}.querySelector('input[type=range]').value`)) === '14');

  await ev(`${row('rtlLayer')}.querySelector('[role=switch]').click()`);
  t.check('RTL layer switch: saved and the topbar button follows', (await until((x) => x.appearance.rtlLayer === false)) && (await ev(`document.querySelector('#rtlOff').getAttribute('aria-checked') === 'true' && document.querySelector('#rtlOn').getAttribute('aria-checked') === 'false'`)) === true);

  /* ---------- מתקדם: נפתח, נשאר פתוח, והשורות עובדות ---------- */
  await ev(`document.querySelector('.st-adv-toggle').click()`);
  await page.waitFor(`document.querySelector('[data-row="scrollback"]').getClientRects().length > 0`, 5000);
  t.check('the advanced group expands on click', (await ev(`document.querySelector('.st-adv-toggle').getAttribute('aria-expanded')`)) === 'true' && (await visible('lineHeight')) && (await visible('cursorStyle')) && (await visible('cursorBlink')) && (await visible('scrollback')));
  t.check('and its state is saved', await until((x) => x.ui.advancedOpen === true));

  const rowH0 = await ev(ROWH);
  await setRange('lineHeight', 1.4);
  await page.waitFor(`${ROWH} !== ${JSON.stringify(rowH0)}`, 10000);
  t.check('line height: terminals re-measure and the server saves 1.4', (await until((x) => x.terminal.lineHeight === 1.4)) && (await ev(ROWH)) !== rowH0, `${rowH0} -> ${await ev(ROWH)}`);

  await ev(`${row('cursorStyle')}.querySelector('[aria-checked="true"]').focus()`);
  await press('ArrowLeft'); // בעברית (RTL) חץ שמאלה מתקדם: block -> bar
  t.check('cursor style by keyboard (RTL arrows): block -> bar, saved', (await until((x) => x.terminal.cursorStyle === 'bar')) && (await ev(`${row('cursorStyle')}.querySelector('[aria-checked="true"]').dataset.value`)) === 'bar');
  await ev(`${row('cursorStyle')}.querySelector('[data-value="underline"]').click()`);
  t.check('cursor style by click: underline (the sample follows)', (await until((x) => x.terminal.cursorStyle === 'underline')) && (await ev(`document.querySelector('.st-cursor').dataset.style`)) === 'underline');
  await ev(`${row('cursorBlink')}.querySelector('[role=switch]').click()`);
  t.check('cursor blink switch (role=switch) turns it off', (await until((x) => x.terminal.cursorBlink === false)) && (await ev(`${row('cursorBlink')}.querySelector('[role=switch]').getAttribute('aria-checked')`)) === 'false');

  await ev(`(() => { const n = ${row('scrollback')}.querySelector('input[type=number]'); n.value = 20000; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  t.check('scrollback 20000 is saved', await until((x) => x.terminal.scrollback === 20000));
  await ev(`(() => { const n = ${row('scrollback')}.querySelector('input[type=number]'); n.value = 5; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  t.check('a value below the range is clamped to 1000 (field and server)', (await until((x) => x.terminal.scrollback === 1000)) && (await ev(`${row('scrollback')}.querySelector('input[type=number]').value`)) === '1000');

  /* ---------- איפוס כללי בשתי לחיצות ---------- */
  await ev(`document.querySelector('.st-reset-all').click()`);
  await sleep(200);
  t.check('reset everything: the first click only arms it', (await ev(`document.querySelector('.st-reset-all').textContent`)).includes('לחצו שוב') && saved().terminal.cursorStyle === 'underline');
  await ev(`document.querySelector('.st-reset-all').click()`);
  await until((x) => x.terminal.scrollback === 5000 && x.appearance.rtlLayer === true);
  const s = saved();
  t.check('the second click restores every setting in the panel', s.terminal.fontSize === 14 && s.terminal.lineHeight === 1 && s.terminal.cursorStyle === 'block' && s.terminal.cursorBlink === true && s.terminal.scrollback === 5000 && s.appearance.rtlLayer === true, JSON.stringify(s));

  /* ---------- הקבוצה המתקדמת נזכרת אחרי רענון ---------- */
  await page.reload();
  await page.waitFor(`document.querySelectorAll('.pane .xterm-screen').length === 2`);
  await ev(`document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('after a reload the advanced group is still open (remembered)', (await ev(`document.querySelector('.st-adv-toggle').getAttribute('aria-expanded')`)) === 'true' && (await visible('scrollback')));
  await ev(`document.querySelector('.st-adv-toggle').click()`);
  await page.waitFor(`document.querySelector('[data-row="scrollback"]').getClientRects().length === 0`, 5000);
  t.check('it can be collapsed again', !(await visible('scrollback')) && (await until((x) => x.ui.advancedOpen === false)));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.join(' | '));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
