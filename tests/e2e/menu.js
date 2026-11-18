'use strict';
/*
 * תפריט קופץ משותף (menu.js) וכפתור "חדש" המפוצל, בדפדפן אמיתי: פתיחה בעכבר ובמקלדת, ניווט בחצים/Home/End/הקלדת אות,
 * Enter מפעיל, Esc מחזיר מיקוד, לחיצה בחוץ סוגרת, תפריט אחד בכל רגע, תפקידי ARIA, ומיקום: היפוך בקצוות החלון והצמדה לכיוון RTL.
 */
const path = require('path');
const { FIXTURES, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

const KEYS = { ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Escape: 27, Enter: 13 };

(async () => {
  const t = checker('popup menu + split New button');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args') });
  const keeper = await connect(srv.port);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(0);
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(e.message)); window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));` });

  // מקש אמיתי (trusted) דרך CDP: חצים, Esc, Enter וכו'
  const press = async (key, extra = {}) => {
    const vk = KEYS[key];
    const text = key === 'Enter' ? '\r' : undefined;
    await page.call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, text, ...extra });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
    await sleep(120);
  };
  const type = async (ch) => {
    await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
    await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(120);
  };
  const menuOpen = () => ev(`!!document.querySelector('.menu')`);
  const activeLabel = () => ev(`(document.activeElement.querySelector && document.activeElement.querySelector('.mi-label') || {}).textContent || ''`);
  const panes = () => ev(`document.querySelectorAll('.pane').length`);

  /* ---------- הכפתור המפוצל ---------- */
  t.check('split button: the main part keeps id addClaude and its label', await ev(`(() => { const b = document.querySelector('#addClaude'); return !!b && b.textContent.includes('Claude חדש') && b.closest('.split') === document.querySelector('#newMenuBtn').closest('.split'); })()`));
  t.check('the chevron part: aria-haspopup=menu, collapsed, labelled', await ev(`(() => { const b = document.querySelector('#newMenuBtn'); return b.getAttribute('aria-haspopup') === 'menu' && b.getAttribute('aria-expanded') === 'false' && !!b.getAttribute('aria-label') && !!b.title; })()`));
  await ev(`document.querySelector('#addClaude').click()`);
  t.check('the main part still opens a Claude terminal', await page.waitFor(`document.querySelectorAll('.pane .kind.claude').length === 1`, 20000));

  /* ---------- פתיחה בעכבר ---------- */
  await ev(`document.querySelector('#newMenuBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  t.check('the chevron opens a menu: role=menu, expanded, six items + a separator', await ev(`(() => { const m = document.querySelector('.menu'); return m.getAttribute('role') === 'menu' && document.querySelector('#newMenuBtn').getAttribute('aria-expanded') === 'true' && m.querySelectorAll('[role=menuitem]').length === 6 && m.querySelectorAll('[role=separator]').length === 1; })()`));
  t.check('items and order', (await ev(`[...document.querySelectorAll('.menu .mi-label')].map((e) => e.textContent).join('|')`)) === 'Claude חדש|PowerShell חדש|לשונית רשת חדשה|זוג סוכנים…|ייבוא סוכנים…|בחירת תיקיית עבודה…');
  t.check('the first two show the working folder on a second line', await ev(`[...document.querySelectorAll('.menu [data-id=claude] .mi-desc, .menu [data-id=powershell] .mi-desc')].every((d) => d.textContent.length > 3)`));
  t.check('focus starts on the first item (roving tabindex)', (await activeLabel()) === 'Claude חדש' && await ev(`document.querySelectorAll('.menu .menu-item[tabindex="0"]').length === 1`));

  /* ---------- מקלדת ---------- */
  await press('ArrowDown');
  t.check('ArrowDown moves to the next item', (await activeLabel()) === 'PowerShell חדש');
  await press('End');
  t.check('End goes to the last item', (await activeLabel()) === 'בחירת תיקיית עבודה…');
  await press('ArrowDown');
  t.check('ArrowDown wraps to the first', (await activeLabel()) === 'Claude חדש');
  await press('ArrowUp');
  t.check('ArrowUp wraps to the last', (await activeLabel()) === 'בחירת תיקיית עבודה…');
  await press('Home');
  t.check('Home goes to the first item', (await activeLabel()) === 'Claude חדש');
  await type('p');
  t.check('type-ahead: "p" jumps to PowerShell', (await activeLabel()) === 'PowerShell חדש');
  await sleep(800); // הקלדת אותיות ברצף (תוך 700ms) היא קידומת אחת; כאן מתחילים הקלדה חדשה
  await type('ז');
  t.check('type-ahead works in Hebrew too', (await activeLabel()) === 'זוג סוכנים…');
  await press('Escape');
  t.check('Esc closes the menu', !(await menuOpen()) && (await ev(`document.querySelector('#newMenuBtn').getAttribute('aria-expanded')`)) === 'false');
  t.check('and focus returns to the chevron', (await ev(`document.activeElement.id`)) === 'newMenuBtn');

  await press('ArrowDown');
  t.check('ArrowDown on the focused chevron opens the menu on the first item', (await menuOpen()) && (await activeLabel()) === 'Claude חדש');
  await press('Escape');
  await press('ArrowUp');
  t.check('ArrowUp on the chevron opens it on the last item', (await menuOpen()) && (await activeLabel()) === 'בחירת תיקיית עבודה…');
  await press('Escape');
  await press('Enter');
  t.check('Enter on the focused chevron opens the menu', await menuOpen());
  await press('ArrowDown');
  await press('Enter');
  t.check('Enter activates the item: a PowerShell terminal opens and the menu closes', (await page.waitFor(`document.querySelectorAll('.pane .kind.powershell').length === 1`, 20000)) && !(await menuOpen()));

  /* ---------- סגירה בלחיצה בחוץ, החלפה, toggle ---------- */
  await ev(`document.querySelector('#newMenuBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  await ev(`document.querySelector('#newMenuBtn').click()`);
  t.check('clicking the chevron again closes it (toggle)', await page.waitFor(`!document.querySelector('.menu')`, 3000));
  await ev(`document.querySelector('#newMenuBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  const r = await ev(`(() => { const b = document.querySelector('#stage').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await page.mouse('mousePressed', r.x, r.y); await page.mouse('mouseReleased', r.x, r.y);
  t.check('a click outside closes it', await page.waitFor(`!document.querySelector('.menu')`, 3000));

  // תפריט מהמודול עצמו: מקרי קצה שאין להם כפתור באפליקציה
  await ev(`(async () => { window.__m = await import('/js/menu.js'); })()`);
  const open = (opts) => ev(`(() => { window.__h = window.__m.openMenu(Object.assign({ items: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }] }, ${opts})); return true; })()`);
  // מחכים שאנימציית הפתיחה (120ms, scale קל) תסתיים לפני מדידה
  const rect = async () => { await sleep(220); return ev(`(() => { const r = document.querySelector('.menu').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; })()`); };
  const anchorAt = (css) => ev(`(() => { document.querySelectorAll('#tAnchor').forEach((e) => e.remove()); const a = document.createElement('button'); a.id = 'tAnchor'; a.textContent = 'x'; a.style.cssText = 'position:fixed;width:30px;height:30px;z-index:5;${css}'; document.body.append(a); const r = a.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; })()`);
  const close = () => ev(`window.__h && window.__h.close('api')`);

  await open('{}');
  await open('{ items: [{ id: "z", label: "Replaced" }] }');
  t.check('only one menu is open at a time (a second replaces the first)', (await ev(`document.querySelectorAll('.menu').length`)) === 1 && (await ev(`document.querySelector('.menu .mi-label').textContent`)) === 'Replaced');
  await close();

  await open(`{ items: [{ id: 'on', label: 'Checked', checked: true }, { id: 'off', label: 'Unchecked', checked: false }, { separator: true }, { id: 'dis', label: 'Disabled', disabled: true, hint: 'Ctrl+Shift+X' }, { id: 'del', label: 'Delete', danger: true }] }`);
  t.check('checked items are menuitemcheckbox with aria-checked', await ev(`(() => { const [a, b] = document.querySelectorAll('.menu [role=menuitemcheckbox]'); return a.getAttribute('aria-checked') === 'true' && b.getAttribute('aria-checked') === 'false'; })()`));
  t.check('the shortcut hint is rendered left-to-right', (await ev(`document.querySelector('.menu .mi-hint').getAttribute('dir')`)) === 'ltr' && (await ev(`document.querySelector('.menu .mi-hint').textContent`)) === 'Ctrl+Shift+X');
  t.check('a disabled item has aria-disabled and arrow keys skip it', await (async () => { await ev(`document.querySelector('.menu [data-id=off]').focus()`); await press('ArrowDown'); return (await ev(`document.activeElement.dataset.id`)) === 'del' && (await ev(`document.querySelector('.menu [data-id=dis]').getAttribute('aria-disabled')`)) === 'true'; })());
  await ev(`document.querySelector('.menu [data-id=dis]').click()`);
  t.check('clicking a disabled item does nothing', await menuOpen());
  t.check('a danger item is marked', await ev(`document.querySelector('.menu [data-id=del]').classList.contains('danger')`));
  await close();

  /* ---------- מיקום ---------- */
  const a1 = await anchorAt('left:700px;top:100px');
  await open('{ anchor: document.querySelector("#tAnchor") }');
  let m = await rect();
  t.check('RTL: opens below the anchor, start edge (right) aligned, extending toward the inline end (left)', Math.abs(m.r - a1.r) <= 1 && m.l < a1.l && m.t >= a1.b, JSON.stringify({ menu: m, anchor: a1 }));
  await close();
  await open('{ anchor: document.querySelector("#tAnchor"), align: "end" }');
  m = await rect();
  t.check('align "end" in RTL puts the left edges together', Math.abs(m.l - a1.l) <= 1, JSON.stringify({ menu: m, anchor: a1 }));
  await close();

  const a2 = await anchorAt('left:4px;top:100px');
  await open('{ anchor: document.querySelector("#tAnchor") }');
  m = await rect();
  t.check('near the left edge it flips/clamps and stays inside the window', m.l >= 8 && m.r <= 1500 - 8, JSON.stringify(m));
  await close();

  const a3 = await anchorAt('left:600px;top:855px');
  await open('{ anchor: document.querySelector("#tAnchor") }');
  m = await rect();
  t.check('near the bottom it opens ABOVE the anchor', m.b <= a3.t && m.t >= 8, JSON.stringify({ menu: m, anchor: a3 }));
  await close();

  await open('{ point: { x: 1496, y: 896 } }');
  m = await rect();
  t.check('a menu at a point in the bottom-right corner stays inside the window', m.l >= 0 && m.r <= 1500 && m.b <= 900 && m.t >= 0, JSON.stringify(m));
  await close();
  await open('{ point: { x: 4, y: 4 } }');
  m = await rect();
  t.check('a menu at a point in the top-left corner stays inside the window', m.l >= 0 && m.t >= 0, JSON.stringify(m));
  await close();
  await open('{ point: { x: 600, y: 300 } }');
  m = await rect();
  t.check('RTL pointer menu opens toward the left of the pointer when there is room', m.r <= 601 && m.t >= 299, JSON.stringify(m));
  await close();

  await page.resize(900, 220);
  await sleep(200);
  await open(`{ point: { x: 400, y: 100 }, items: Array.from({ length: 12 }, (_, i) => ({ id: 'i' + i, label: 'Item ' + i })) }`);
  m = await rect();
  t.check('in a short window a long menu is limited to the window and scrolls', m.t >= 0 && m.b <= 220 && (await ev(`(() => { const e = document.querySelector('.menu'); return e.scrollHeight > e.clientHeight; })()`)), JSON.stringify(m));
  await close();
  await page.resize(1500, 900);

  t.check('no JavaScript errors', (await ev(`window.__errs`) || []).length === 0 && page.errors.length === 0, JSON.stringify(await ev(`window.__errs`)) + page.errors.join('|'));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
