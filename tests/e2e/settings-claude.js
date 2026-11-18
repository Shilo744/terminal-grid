'use strict';
// Settings group "סוכני Claude" (T21): the 3-way auto-compact control, the threshold select that only exists in "early" mode,
// persistence, the live "terminals keep the previous setting" note and the collapsed explanation.
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('settings: Claude auto-compact group');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'C1' });
  for (let i = 0; i < 100 && keeper.sessions.size < 1; i++) await sleep(100);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 900 });
  const { ev } = page;
  await page.appReady(1);
  const saved = () => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8')).claude.autoCompact;
  const until = async (pred) => { for (let i = 0; i < 60; i++) { try { if (pred(saved())) return true; } catch { /* עוד לא נכתב */ } await sleep(100); } return false; };
  const visible = (sel) => ev(`(() => { const e = document.querySelector('${sel}'); return !!e && e.getClientRects().length > 0; })()`);

  await ev(`document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('the group "סוכני Claude" is visible without expanding anything', await ev(`[...document.querySelectorAll('.st-title')].some((h) => h.textContent === 'סוכני Claude' && h.getClientRects().length > 0)`));
  t.check('the control has three options: Claude default / earlier / off', (await ev(`[...document.querySelectorAll('[data-row="autoCompactMode"] [role=radio]')].map((b) => b.textContent).join('|')`)) === 'ברירת המחדל של Claude|מוקדם יותר|כבוי');
  t.check('"ברירת המחדל" is selected and the threshold select is hidden', (await ev(`document.querySelector('[data-row="autoCompactMode"] [aria-checked="true"]').dataset.value`)) === 'default' && !(await visible('[data-row="autoCompactWindow"]')));
  t.check('the scope note is shown (new terminals only)', (await ev(`document.querySelector('.st-note').textContent`)).includes('טרמינלים שכבר רצים לא משתנים'));
  t.check('no "previous setting" count yet', !(await visible('.st-note-count')));

  await ev(`document.querySelector('[data-row="autoCompactMode"] [data-value="early"]').click()`);
  t.check('choosing "מוקדם יותר" shows the threshold select with four sizes', await page.waitFor(`(() => { const s = document.querySelector('[data-row="autoCompactWindow"] select'); return !!s && s.getClientRects().length > 0 && s.options.length === 4; })()`, 5000));
  t.check('400K is marked as recommended for long runs and is the default', (await ev(`document.querySelector('[data-row="autoCompactWindow"] select').selectedOptions[0].textContent`)) === '400K טוקנים (מומלץ לריצות ארוכות)');
  t.check('the open Claude terminal started before the change is counted in a note', await page.waitFor(`document.querySelector('.st-note-count') && !document.querySelector('.st-note-count').hidden && document.querySelector('.st-note-count').textContent.includes('1 טרמינל פתוח ימשיך עם ההגדרה הקודמת')`, 5000));
  await ev(`(() => { const s = document.querySelector('[data-row="autoCompactWindow"] select'); s.value = '250000'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  t.check('picking 250K saves a NUMBER on the server', await until((x) => x.mode === 'early' && x.window === 250000));

  await page.reload();
  await page.appReady(1);
  await ev(`document.querySelector('#settingsBtn').click()`);
  await page.waitFor(`document.querySelector('#settingsDlg').open`, 5000);
  t.check('after a reload "early" and 250K are still selected', (await ev(`document.querySelector('[data-row="autoCompactMode"] [aria-checked="true"]').dataset.value`)) === 'early' && (await ev(`document.querySelector('[data-row="autoCompactWindow"] select').value`)) === '250000');

  await ev(`document.querySelector('[data-row="autoCompactMode"] [data-value="off"]').click()`);
  t.check('"כבוי" hides the select again and saves', (await page.waitFor(`document.querySelector('[data-row="autoCompactWindow"]').hidden`, 5000)) && (await until((x) => x.mode === 'off')));
  await ev(`document.querySelector('[data-row="autoCompactMode"] [data-value="default"]').click()`);
  t.check('going back to the default clears the "previous setting" note (the terminal matches again)', await page.waitFor(`document.querySelector('.st-note-count').hidden`, 5000));

  t.check('the explanation is collapsed by default', (await ev(`document.querySelector('.st-help').open`)) === false);
  await ev(`document.querySelector('.st-help summary').click()`);
  const help = await ev(`document.querySelector('.st-help').textContent`);
  t.check('it explains what compaction is, each mode and recommendations', help.includes('מה זה דחיסה') && help.includes('מה עושה כל מצב') && help.includes('מה מומלץ') && help.includes('200K') && help.includes('967K') && help.includes('/compact') && help.includes('400K'));
  t.check('it does not invent numbers: no percentages in the text', !/%/.test(help));

  t.check('no JavaScript errors', page.errors.length === 0, page.errors.join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
