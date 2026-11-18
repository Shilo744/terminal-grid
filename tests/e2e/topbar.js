'use strict';
/*
 * הסרגל העליון אחרי הניקוי: רק הפקדים שנשארו, זום מהמקלדת ומהגלגלת (Ctrl + = / - / 0, Ctrl + גלגלת מעל טרמינל),
 * תפריט "עוד" (ייבוא, זוג חדש, אודות), ושורה אחת בגובה הסרגל של הסגנון (44px ב-IDE, 52px בשאר) בלי גלישה אופקית ובלי הסתרת תוויות בין 900 ל-2560.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('topbar: declutter, zoom, overflow menu, widths');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'A' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'B' });
  for (let i = 0; i < 100 && keeper.sessions.size < 2; i++) await sleep(100);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 800 });
  const { ev } = page;
  await page.appReady(2);
  const size = () => ev(`localStorage.getItem('tg.fontSize')`);
  const saved = () => JSON.parse(fs.readFileSync(srv.settingsFile, 'utf8'));
  const key = (k, code, extra = '') => ev(`(() => { const e = new KeyboardEvent('keydown', { key: '${k}', code: '${code}', ctrlKey: true, ${extra} bubbles: true, cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`);

  /* ---------- מה נשאר ומה הוסר ---------- */
  const ids = ['sideBtn', 'folderBtn', 'addClaude', 'newMenuBtn', 'rtlBtn', 'settingsBtn', 'moreBtn'];
  t.check('the remaining controls exist', await ev(`${JSON.stringify(ids)}.every((id) => !!document.getElementById(id))`));
  t.check('PowerShell / pair / import buttons, the font select and A-/A+ are gone', await ev(`['addPs', 'addDuo', 'adoptBtn', 'fontFamily', 'fontUp', 'fontDown'].every((id) => !document.getElementById(id))`));
  t.check('every icon-only control has a label and a title', await ev(`['sideBtn', 'newMenuBtn', 'rtlBtn', 'settingsBtn', 'moreBtn'].every((id) => { const b = document.getElementById(id); return !!b.getAttribute('aria-label') && !!b.title; })`));

  /* ---------- גופן הממשק מקומי (T19, GL-2) ---------- */
  await ev(`document.fonts.load("600 14px Heebo", "שלום Abc").then(() => true)`);
  t.check('Heebo (hebrew + latin) is served from /fonts and loaded, no request goes to Google', await ev(`(() => { const loaded = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Heebo' && f.status === 'loaded').length; const names = performance.getEntriesByType('resource').map((r) => r.name); return loaded >= 1 && names.some((n) => n.includes('/fonts/heebo-hebrew-')) && !names.some((n) => n.includes('googleapis') || n.includes('gstatic')); })()`));

  /* ---------- זום מהמקלדת ---------- */
  t.check('Ctrl+= is handled (default prevented, so the browser does not zoom the page)', (await key('=', 'Equal')) === true);
  t.check('and raises the font size to 15', (await size()) === '15');
  await key('+', 'Equal', 'shiftKey: true,');
  t.check('Ctrl+Shift++ also raises it (16)', (await size()) === '16');
  await key('-', 'Minus');
  t.check('Ctrl+- lowers it (15)', (await size()) === '15');
  await key('0', 'Digit0');
  t.check('Ctrl+0 resets it to 14', (await size()) === '14');
  for (let i = 0; i < 12; i++) await key('=', 'Equal');
  t.check('the size stops at the maximum (24)', (await size()) === '24');
  for (let i = 0; i < 20; i++) await key('-', 'Minus');
  t.check('and at the minimum (9)', (await size()) === '9');
  await key('0', 'Digit0');
  t.check('Ctrl+= under a Hebrew keyboard layout works by key code', await (async () => { await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true }))`); return (await size()) === '15'; })());
  await key('0', 'Digit0');
  t.check('with focus in a terminal textarea the shortcut still works', await ev(`(() => { const ta = document.querySelector('.pane textarea'); ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true })); return localStorage.getItem('tg.fontSize') === '15'; })()`));
  await key('0', 'Digit0');
  await ev(`document.querySelector('#folderBtn').click()`);
  await page.waitFor(`!document.querySelector('#folderPop').hidden`, 5000);
  t.check('but not while typing in a normal text field (the folder path box)', await ev(`(() => { const i = document.querySelector('#pathInput'); i.focus(); const e = new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true }); i.dispatchEvent(e); return !e.defaultPrevented && localStorage.getItem('tg.fontSize') === '14'; })()`));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  /* ---------- Ctrl + גלגלת מעל טרמינל ---------- */
  const wheel = (selector, dy, ctrl) => ev(`(() => { const el = document.querySelector('${selector}'); const e = new WheelEvent('wheel', { deltaY: ${dy}, ctrlKey: ${ctrl}, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; })()`);
  t.check('Ctrl+wheel up over a terminal raises the size by 1', (await wheel('.pane-body', -100, true)) === true && (await size()) === '15');
  await sleep(100);
  await wheel('.pane-body', 100, true);
  t.check('Ctrl+wheel down lowers it by 1', (await size()) === '14');
  await sleep(100);
  await wheel('.pane-body', -100, false);
  t.check('a plain wheel does nothing (it scrolls the terminal)', (await size()) === '14');
  await wheel('.topbar', -100, true);
  t.check('Ctrl+wheel outside a terminal does nothing', (await size()) === '14');
  t.check('the zoom reaches the server settings', await (async () => { for (let i = 0; i < 40; i++) { if (saved().terminal.fontSize === 14) return true; await sleep(100); } return false; })());

  /* ---------- תפריט "עוד" ---------- */
  await ev(`document.querySelector('#moreBtn').focus(); document.querySelector('#moreBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  t.check('the ⋯ button opens a menu: import, new pair, separator, about', (await ev(`[...document.querySelectorAll('.menu [role=menuitem] .mi-label')].map((e) => e.textContent).join('|')`)) === 'ייבוא סוכנים…|זוג סוכנים חדש…|אודות Terminal Grid' && (await ev(`document.querySelectorAll('.menu [role=separator]').length`)) === 1);
  t.check('it is a real menu (aria-expanded on the button, focus on the first item)', (await ev(`document.querySelector('#moreBtn').getAttribute('aria-expanded')`)) === 'true' && (await ev(`document.activeElement.dataset.id`)) === 'adopt');
  await ev(`document.querySelector('.menu [data-id="about"]').click()`);
  t.check('"אודות" opens a dialog with the version and where settings and state live', await page.waitFor(`document.querySelector('#aboutDlg').open && document.querySelector('#aboutLine').textContent.includes('4.0.0') && document.querySelector('#aboutSettings').textContent.endsWith('.json')`, 8000));
  t.check('the paths shown are this server\'s files', (await ev(`document.querySelector('#aboutSettings').textContent`)) === srv.settingsFile && (await ev(`document.querySelector('#aboutState').textContent`)) === srv.stateFile);
  await ev(`document.querySelector('#aboutDlg').close()`);
  await ev(`document.querySelector('#moreBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  await ev(`document.querySelector('.menu [data-id="duo"]').click()`);
  t.check('"זוג סוכנים חדש" opens the pair dialog', await page.waitFor(`document.querySelector('#duoDlg').open`, 5000));
  await ev(`document.querySelector('#duoDlg').close()`);
  await ev(`document.querySelector('#moreBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  await ev(`document.querySelector('.menu [data-id="adopt"]').click()`);
  t.check('"ייבוא סוכנים" opens the import popover under the ⋯ button', await page.waitFor(`!document.querySelector('#adoptPop').hidden`, 5000));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  /* ---------- רוחבים: שורה אחת, בלי גלישה, בלי הסתרת תוויות ---------- */
  for (const w of [900, 1100, 1280, 1920, 2560]) {
    await page.resize(w, 800);
    await page.waitFor(`document.documentElement.clientWidth === ${w}`, 5000);
    await sleep(250);
    const m = await ev(`(() => { const bar = document.querySelector('.topbar'); const kids = [...bar.querySelectorAll('button, .chip, .viewseg')].filter((e) => !e.hidden && e.getClientRects().length);
      const r = bar.getBoundingClientRect(); const label = document.querySelector('#addClaude span:last-child'); const lr = label.getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth > innerWidth, barOverflow: bar.scrollWidth > bar.clientWidth + 1, h: Math.round(r.height), top: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')), oneRow: kids.every((e) => e.getBoundingClientRect().bottom <= r.bottom + 1 && e.getBoundingClientRect().top >= r.top - 1),
        withinBar: kids.every((e) => e.getBoundingClientRect().left >= -1 && e.getBoundingClientRect().right <= innerWidth + 1), newLabel: lr.width > 20 && getComputedStyle(label).display !== 'none',
        brandName: getComputedStyle(document.querySelector('.brand-name')).display !== 'none', summary: getComputedStyle(document.querySelector('#summary')).display !== 'none' }; })()`);
    t.check(`${w}px: one row of the style topbar height (44px in IDE, 52px in the others), no horizontal overflow, every control inside the window`, !m.overflowX && !m.barOverflow && m.h === m.top && [44, 52].includes(m.h) && m.oneRow && m.withinBar, JSON.stringify(m));
    t.check(`${w}px: the New button keeps its label; only the brand name / summary may collapse`, m.newLabel && (w > 1100 ? m.brandName : true) && (w >= 1000 ? m.summary : true), JSON.stringify(m));
  }
  await page.resize(900, 800);
  await ev(`document.querySelector('#sideBtn').click()`);
  await sleep(500);
  t.check('900px with the side menu open: the topbar still fits', await ev(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.topbar').scrollWidth <= document.querySelector('.topbar').clientWidth + 1`));

  t.check('no JavaScript errors', page.errors.length === 0, page.errors.join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
