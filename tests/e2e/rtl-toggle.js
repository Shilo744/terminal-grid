'use strict';
// @slow
/*
 * יישור עברית (T42): בקרה מסומנת בסרגל עם שני מצבים ברורים, תצוגה מקדימה בהגדרות, והחלקה של 120ms בטרמינל:
 *  - תווית "יישור עברית" וקטעים "ימין" / "שמאל" עם אייקון; הקטע הפעיל הוא מילוי בצבע ההדגשה עם טקסט בצבע הדיו, והלא פעיל ניטרלי;
 *  - לחיצה (וחצים במקלדת) מחליפה מצב, בלי הערת "לחוץ": אותה הגדרה (appearance.rtlLayer), השכבה בטרמינל נמחקת/נצבעת, והדבר נשמר ושורד טעינה מחדש ושרת אחר;
 *  - בהגדרות מתחת לשורה שתי שורות לדוגמה, משמאל ומימין, והמצב הנוכחי מודגש ועוקב אחרי הסרגל;
 *  - במעבר השכבה מחליקה (אנימציה של 120ms על הקנבס).
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const luma = (rgb) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(rgb); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]); };
const ratio = (a, b) => { const x = luma(a), y = luma(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  const t = checker('Hebrew alignment toggle (T42)');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-heb'), env: { DEMO_COLS: '60' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Claude' });
  await poll(() => keeper.sessions.size === 1, 15000);
  let page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  let { ev } = page;
  await page.waitFor(`document.querySelectorAll('.tg-rtl').length === 1`, 30000);
  const ink = () => ev(`(() => { const c = document.querySelector('.tg-rtl'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);
  const saved = () => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8'));
  const colors = (sel) => ev(`(() => { const cs = getComputedStyle(document.querySelector('${sel}')); return { bg: cs.backgroundColor, color: cs.color, weight: cs.fontWeight }; })()`);
  await poll(async () => (await ink()) > 500, 15000, 150);

  /* ---------- המראה של הבקרה ---------- */
  t.check('a labelled control: the small label "יישור עברית" and two segments "ימין" / "שמאל", each with an alignment icon', await ev(`(() => { const r = document.querySelector('#rtlBtn'); const l = r.querySelector('.rtlseg-label'); return l.textContent === 'יישור עברית' && l.getClientRects().length > 0 && r.querySelector('#rtlOn').textContent.trim() === 'ימין' && r.querySelector('#rtlOff').textContent.trim() === 'שמאל' && !!r.querySelector('#rtlOn svg') && !!r.querySelector('#rtlOff svg') && r.getAttribute('role') === 'radiogroup'; })()`));
  const act = await colors('#rtlOn'), off = await colors('#rtlOff');
  t.check('ON: the active segment is a flat filled segment in the accent fill colour with the ink colour text', act.bg === 'rgb(14, 99, 156)' && act.color === 'rgb(255, 255, 255)' && Number(act.weight) >= 600, JSON.stringify(act));
  t.check('the inactive segment is neutral (surface colour, muted text)', off.bg === 'rgb(45, 45, 48)' && off.color !== act.color && Number(off.weight) < 600, JSON.stringify(off));
  t.check('the active text is readable on its fill (contrast at least 4.5:1) and the two segments are clearly different (at least 1.5:1)', ratio(act.color, act.bg) >= 4.5 && ratio(act.bg, off.bg) >= 1.5, `${ratio(act.color, act.bg).toFixed(2)} / ${ratio(act.bg, off.bg).toFixed(2)}`);
  t.check('the tooltip explains it', (await ev(`document.querySelector('#rtlBtn').title`)) === 'יישור עברית לימין בטרמינלים של Claude. אזור ההקלדה לא משתנה.');

  /* ---------- הגדרות: תצוגה מקדימה ---------- */
  await ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  await sleep(300);
  t.check('settings: under the row two sample cards (right-aligned and left-aligned) and the current one (right) is highlighted', await ev(`(() => { const r = document.querySelector('[data-row="rtlLayer"]'); const on = r.querySelector('.rp-card.on'); return r.querySelectorAll('.rp-card').length === 2 && !!on && on.classList.contains('right') && r.querySelectorAll('.rp-line').length === 4 && getComputedStyle(r.querySelector('.rp-card.right .rp-line')).textAlign === 'right' && getComputedStyle(r.querySelector('.rp-card.left .rp-line')).textAlign === 'left'; })()`));
  await ev(`document.querySelector('#settingsDlg').close(); true`);

  /* ---------- החלפה בלחיצה: מצב, שכבה, הגדרה, אנימציה ---------- */
  await ev(`document.querySelector('#rtlOff').click(); true`);
  t.check('clicking "שמאל": the segments swap (checked state, data-on) at once', await ev(`document.querySelector('#rtlOff').getAttribute('aria-checked') === 'true' && document.querySelector('#rtlOn').getAttribute('aria-checked') === 'false' && document.querySelector('#rtlBtn').dataset.on === 'false'`));
  await sleep(400); // מעבר הצבע של הקטע (160ms)
  const offColors = await colors('#rtlOff');
  t.check('and now the LEFT segment carries the accent fill', offColors.bg === 'rgb(14, 99, 156)', JSON.stringify(offColors));
  t.check('the layer in the terminal is cleared (Hebrew rows go back to the left)', await poll(async () => (await ink()) === 0, 4000, 100));
  t.check('the setting is saved on the server', await poll(() => { try { return saved().appearance.rtlLayer === false; } catch { return false; } }, 5000, 150));
  await ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('settings: the preview follows (the left card is the highlighted one)', await ev(`!!document.querySelector('[data-row="rtlLayer"] .rp-card.left.on') && !document.querySelector('[data-row="rtlLayer"] .rp-card.right.on')`));
  await ev(`document.querySelector('#settingsDlg').close(); true`);

  await ev(`document.querySelector('#rtlOn').click(); true`);
  // אנימציה של 120ms על הקנבס מיד אחרי ההדלקה (עד שני פריימים), ואז נגמרת
  const anim = await ev(`new Promise((res) => { const t0 = performance.now(); const tick = () => { const c = document.querySelector('.tg-rtl'); const a = c && c.getAnimations(); if (a && a.length) { const eff = a[0].effect.getTiming(); res({ running: true, duration: eff.duration, at: Math.round(performance.now() - t0) }); return; } if (performance.now() - t0 > 600) { res({ running: false }); return; } requestAnimationFrame(tick); }; tick(); })`);
  t.check('turning it on slides the Hebrew rows in with a 120 ms animation', anim.running === true && anim.duration === 120, JSON.stringify(anim));
  t.check('and the layer is drawn again afterwards', await poll(async () => (await ink()) > 500, 5000, 100));
  t.check('no animation is left running on the layer', await poll(() => ev(`document.querySelector('.tg-rtl').getAnimations().length === 0`), 2000, 100));

  /* ---------- מקלדת ---------- */
  await ev(`document.querySelector('#rtlOn').focus(); true`);
  await page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await sleep(300);
  t.check('keyboard: an arrow key on the group switches state and keeps focus on the new active segment', await ev(`document.querySelector('#rtlOff').getAttribute('aria-checked') === 'true' && document.activeElement.id === 'rtlOff'`));

  /* ---------- נשמר אחרי רענון ---------- */
  await page.reload();
  await page.waitFor(`document.querySelectorAll('.pane').length === 1`, 20000);
  await sleep(800);
  t.check('after a reload OFF is still shown (left segment active) and the layer stays empty', await ev(`document.querySelector('#rtlOff').getAttribute('aria-checked') === 'true'`) && (await ink()) === 0);
  page.close(); keeper.close(); srv.stop();
  await sleep(600);

  /* ---------- שרת אחר: המצב מגיע מהגדרות השרת ---------- */
  const srv2 = await startServer({ binDir: path.join(FIXTURES, 'bin-heb'), settingsFile: srv.settingsFile, keepState: true });
  page = await openPage(`http://127.0.0.1:${srv2.port}/`, { width: 1500, height: 900 });
  ({ ev } = page);
  await page.appReady(0);
  t.check('another port with an empty browser cache: the control follows the server setting (left active)', await page.waitFor(`document.querySelector('#rtlOff').getAttribute('aria-checked') === 'true'`, 8000));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); srv2.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
