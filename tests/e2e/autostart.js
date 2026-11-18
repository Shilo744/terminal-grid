'use strict';
// @slow
/*
 * המתג "הפעלה אוטומטית עם Windows" בהגדרות (T30), בתיקייה זמנית ועם קיצור מדומה:
 *  - קבוצה "כללי" גלויה בלי לפתוח כלום; המתג קורא את המצב האמיתי (קובץ הקיצור), גם כשהקובץ נוצר מבחוץ;
 *  - הפעלה יוצרת את הקובץ, כיבוי מוחק אותו; "איפוס כל ההגדרות" לא נוגע בו;
 *  - כשאי אפשר ליצור את הקיצור המתג נשאר כבוי ומתחת לשורה מופיעה הודעה ברורה;
 *  - משוב מיידי (T38): המתג מתהפך מיד ויש ספינר צמוד בזמן שהשרת עובד (TG_TEST_AUTOSTART_DELAY_MS מדמה את 1-3 השניות של PowerShell), גם בכישלון: חוזר אחורה.
 */
const path = require('path');
const fs = require('fs');
const { TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('autostart switch in settings');
  const dir = path.join(TMP, 'startup-ui');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let srv = await startServer({ env: { TG_TEST_STARTUP_DIR: dir, TG_TEST_AUTOSTART_STUB: '1', TG_TEST_AUTOSTART_DELAY_MS: '900' } });
  const lnk = path.join(dir, `Terminal Grid (${srv.port}).lnk`);
  let keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  await poll(() => keeper.sessions.size === 1, 15000);

  let page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(1);
  await page.ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  const sw = `document.querySelector('[data-row="autostart"] .sw')`;
  const checked = () => page.ev(`${sw}.getAttribute('aria-checked')`);
  t.check('the group "כללי" is visible without expanding anything', await page.ev(`[...document.querySelectorAll('.st-title')].some((h) => h.textContent === 'כללי' && h.getClientRects().length > 0)`));
  t.check('the row is labelled "הפעלה אוטומטית עם Windows" and explains what it does', await page.ev(`(() => { const r = document.querySelector('[data-row="autostart"]'); return r.textContent.includes('הפעלה אוטומטית עם Windows') && r.textContent.includes('ישחזר את הטרמינלים ואת זוגות הסוכנים'); })()`));
  t.check('the second note about sign-in is shown', await page.ev(`document.querySelector('[data-row="autostartNote"]').textContent.includes('כניסה אוטומטית')`));
  t.check('the switch is off when there is no shortcut', (await checked()) === 'false');

  const instant = await page.ev(`(() => { const s = ${sw}; s.click(); const row = document.querySelector('[data-row="autostart"]'); return { on: s.getAttribute('aria-checked'), busy: s.getAttribute('aria-busy'), disabled: s.disabled, spin: !!row.querySelector('.spin') }; })()`);
  t.check('the switch flips at once and a spinner shows next to it while the server works', instant.on === 'true' && instant.busy === 'true' && instant.disabled && instant.spin, JSON.stringify(instant));
  t.check('the shortcut does not exist yet at that moment (the server is still working)', !fs.existsSync(lnk));
  t.check('turning it on creates the shortcut file and the switch stays on', await poll(() => fs.existsSync(lnk), 8000, 150) && await poll(async () => (await checked()) === 'true', 6000, 150));
  t.check('when the server is done the spinner is gone and the switch works again', await poll(() => page.ev(`!document.querySelector('[data-row="autostart"] .spin') && !${sw}.disabled && !${sw}.hasAttribute('aria-busy')`), 4000, 100));
  await page.ev(`document.querySelector('#settingsDlg').close(); true`);
  await page.reload();
  await page.appReady(1);
  await page.ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('after a reload the switch still shows on (the state comes from the server)', await poll(async () => (await checked()) === 'true', 6000, 150));

  // איפוס כל ההגדרות לא נוגע בהפעלה האוטומטית
  await page.ev(`document.querySelector('.st-adv-toggle').click(); true`);
  await page.ev(`document.querySelector('.st-reset-all').click(); true`);
  await sleep(300);
  await page.ev(`document.querySelector('.st-reset-all').click(); true`);
  await sleep(1200);
  t.check('"איפוס כל ההגדרות" does not turn the autostart off', fs.existsSync(lnk) && (await checked()) === 'true');

  await page.ev(`${sw}.click(); true`);
  t.check('turning it off removes the file and the switch', await poll(() => !fs.existsSync(lnk), 8000, 150) && await poll(async () => (await checked()) === 'false', 6000, 150));

  // המצב נקבע מהדיסק: קובץ שנוצר מבחוץ מדליק את המתג בחלון פתוח (השרת משדר רק כשהוא עצמו שינה, לכן פותחים מחדש)
  fs.writeFileSync(lnk, '{}');
  await page.ev(`document.querySelector('#settingsDlg').close(); true`);
  await page.reload();
  await page.appReady(1);
  await page.ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('a shortcut created outside the app is reflected after opening the window', await poll(async () => (await checked()) === 'true', 6000, 150));
  fs.unlinkSync(lnk);
  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();

  // ---------- שגיאה: אי אפשר ליצור את הקיצור ----------
  await sleep(600);
  const blocker = path.join(TMP, 'startup-ui-blocker.txt');
  fs.writeFileSync(blocker, 'not a folder');
  srv = await startServer({ env: { TG_TEST_STARTUP_DIR: path.join(blocker, 'inner'), TG_TEST_AUTOSTART_STUB: '1', TG_TEST_AUTOSTART_DELAY_MS: '900' } });
  keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  await poll(() => keeper.sessions.size === 1, 15000);
  page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(1);
  await page.ev(`document.querySelector('#settingsBtn').click(); true`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  const instantFail = await page.ev(`(() => { const s = ${sw}; s.click(); return { on: s.getAttribute('aria-checked'), spin: !!document.querySelector('[data-row="autostart"] .spin') }; })()`);
  t.check('even when it will fail, the switch flips at once with a spinner (never looks un-clicked)', instantFail.on === 'true' && instantFail.spin, JSON.stringify(instantFail));
  t.check('when the shortcut cannot be created the switch goes back to off', await poll(async () => (await checked()) === 'false', 6000, 150));
  t.check('and a clear message appears under the row', await poll(() => page.ev(`(() => { const n = document.querySelector('[data-row="autostart"] .st-row-note'); return !!n && !n.hidden && /תיקיית ההפעלה|הקיצור/.test(n.textContent); })()`), 6000, 150));
  page.close(); keeper.close(); srv.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
