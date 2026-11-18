'use strict';
// @slow
// T71: the rename editor sits IN the tab / project row (same rectangle, font, height and direction as the name), survives updates while it is open,
// and the tab row is bigger (44 px tabs, 15 px names, 32 px "+", 28 px "?", 120-240 px tabs).
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, poll, checker, startServer, connect, openPage, seedHistory } = require('../lib/harness');

(async () => {
  const t = checker('in-place rename and bigger tabs');
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.mkdirSync(shots, { recursive: true });
  const hist = seedHistory(undefined, { projects: 2, perProject: 1 });
  const work = path.join(TMP, 'rename-inplace-work');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-ticker') });
  const keeper = await connect(srv.port);
  for (const n of ['alpha', 'beta']) { const d = path.join(work, n); fs.mkdirSync(d, { recursive: true }); keeper.send({ t: 'create', kind: 'claude', cwd: d, name: n }); await sleep(150); }
  await poll(() => keeper.sessions.size === 2, 20000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 800 });
  const { ev } = page;
  await page.appReady(2);
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { l: r.left, t: r.top, w: r.width, h: r.height, font: c.fontSize + ' ' + c.fontWeight }; })()`);
  const near = (a, b, d = 2) => !!a && !!b && Math.abs(a.l - b.l) <= d && Math.abs(a.t - b.t) <= d && Math.abs(a.w - b.w) <= d && Math.abs(a.h - b.h) <= d;
  const key = (k, code, vk) => page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }));
  const dbl = async (sel) => { const r = await rect(sel); const x = r.l + r.w / 2, y = r.t + r.h / 2; await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y, { clickCount: 1 }); await page.mouse('mouseReleased', x, y, { clickCount: 1 }); await page.mouse('mousePressed', x, y, { clickCount: 2 }); await page.mouse('mouseReleased', x, y, { clickCount: 2 }); await sleep(300); };
  const shot = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  /* ---------- גודל הלשוניות ---------- */
  await ev(`import('/js/tabs.js').then((m) => { m.newTab({ activate: false }); return true; })`);
  await page.waitFor(`document.querySelectorAll('.gtab').length === 2`, 5000);
  await sleep(300);
  const sz = await ev(`(() => { const t = document.querySelector('.gtab'); const r = t.getBoundingClientRect(); const nm = getComputedStyle(t.querySelector('.nm')); const pr = getComputedStyle(t.querySelector('.pr')); const dot = t.querySelector('.dot').getBoundingClientRect(); const plus = document.querySelector('.duo-tab-new').getBoundingClientRect(); const help = document.querySelector('.duo-legend-btn').getBoundingClientRect(); const row = document.querySelector('#duoTabs').getBoundingClientRect(); const x = document.querySelector('.gtab .x'); const xr = x ? x.getBoundingClientRect() : null; const xa = x ? getComputedStyle(x, '::after') : null; return { tabH: Math.round(r.height), rowH: Math.round(row.height), nm: nm.fontSize, pr: pr.fontSize, dot: Math.round(dot.width), plus: Math.round(plus.width) + 'x' + Math.round(plus.height), help: Math.round(help.width), tabW: Math.round(r.width), x: xr && Math.round(xr.width), xHit: xa && xa.inset }; })()`);
  t.check('tabs are 44 px high in a 46 px row, names 15 px, counts 13 px, dot 9 px, "+" 32 px, "?" 28 px, X 20 px with a 28 px hit area', sz.tabH === 44 && sz.rowH >= 44 && sz.rowH <= 48 && sz.nm === '15px' && sz.pr === '13px' && sz.dot === 9 && sz.plus === '32x32' && sz.help === 28 && sz.x === 20 && /-4px/.test(sz.xHit || ''), JSON.stringify(sz));
  t.check('a tab is at least 120 px wide', sz.tabW >= 120, String(sz.tabW));

  /* ---------- עריכה במקום בלשונית ---------- */
  await dbl('.gtab .nm');
  await ev(`window.__nm = document.querySelector('.gtab .nm'); true`); // אחרי הלחיצה הכפולה: הלחיצה הראשונה בנתה מחדש את הלשונית
  const ed = await rect('input.rename-input');
  const nm = await rect('.gtab .nm');
  t.check('double-click on a tab name opens the editor exactly on the name (same rectangle within 2 px)', near(ed, nm), JSON.stringify({ ed, nm }));
  const same = await ev(`(() => { const i = document.querySelector('input.rename-input'); const n = document.querySelector('.gtab .nm'); const a = getComputedStyle(i), b = getComputedStyle(n); return { size: a.fontSize === b.fontSize, family: a.fontFamily === b.fontFamily, weight: a.fontWeight === b.fontWeight, dir: i.dir === 'auto' }; })()`);
  t.check('same font size, family and weight as the name (no smaller text while editing), direction auto', same.size && same.family && same.weight && same.dir, JSON.stringify(same));
  await shot('T71-rename-ide.png');
  // עדכונים בזמן העריכה: בנייה מחדש של השורה נדחית
  await ev(`import('/js/state.js').then(({ bus }) => { bus.emit('tabs'); bus.emit('status-tick'); return true; })`);
  await ev(`import('/js/tabs.js').then((m) => m.newTab({ activate: false }) && true)`);
  await sleep(500);
  const still = await ev(`({ editor: !!document.querySelector('input.rename-input'), sameNode: window.__nm === document.querySelector('.gtab .nm'), tabs: document.querySelectorAll('.gtab').length })`);
  t.check('updates while editing (tabs event, status tick, even a new tab) do not close the editor or rebuild its tab', still.editor && still.sameNode, JSON.stringify(still));
  const during = await rect('input.rename-input');
  t.check('and the editor did not move', near(during, ed, 2), JSON.stringify({ during, ed }));
  // הקלדה: הרוחב גדל עד קצה הלשונית ולא מעבר
  await ev(`(() => { const i = document.querySelector('input.rename-input'); i.value = 'שם ארוך מאוד של לשונית כדי לבדוק גידול ' + 'x'.repeat(60); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const grown = await rect('input.rename-input');
  const tabR = await ev(`(() => { const r = document.querySelector('.gtab').getBoundingClientRect(); return { l: r.left, r: r.right }; })()`);
  t.check('the width grows with the text but stays inside the tab', grown.w > ed.w && grown.l >= tabR.l - 2 && grown.l + grown.w <= tabR.r + 2, JSON.stringify({ ed: ed.w, grown: grown.w, tabR }));
  await key('Escape', 'Escape', 27);
  await sleep(300);
  t.check('Esc cancels: the editor is gone and the name is unchanged', !(await rect('input.rename-input')) && (await ev(`document.querySelector('.gtab .nm').textContent`)) === 'alpha');
  await dbl('.gtab .nm');
  await ev(`(() => { const i = document.querySelector('input.rename-input'); i.value = 'עבודה א'; return true; })()`);
  await key('Enter', 'Enter', 13);
  await sleep(400);
  t.check('Enter saves: the new Hebrew name is on the tab (a right-to-left name)', (await ev(`document.querySelector('.gtab .nm').textContent`)) === 'עבודה א' && !(await rect('input.rename-input')));
  await dbl('.gtab .nm');
  await ev(`(() => { const i = document.querySelector('input.rename-input'); i.value = 'saved by blur'; return true; })()`);
  await page.mouse('mousePressed', 700, 600); await page.mouse('mouseReleased', 700, 600);
  await sleep(400);
  t.check('leaving the field (blur) saves too', (await ev(`document.querySelector('.gtab .nm').textContent`)) === 'saved by blur');
  // סגנונות
  for (const st of ['classic', 'paper']) {
    await ev(`import('/js/settings.js').then((m) => { m.setSetting('appearance.style', '${st}'); return true; })`);
    await sleep(700);
    await dbl('.gtab .nm');
    t.check(`${st}: the in-place editor sits on the name`, near(await rect('input.rename-input'), await rect('.gtab .nm')));
    await shot(`T71-rename-${st}.png`);
    await key('Escape', 'Escape', 27);
    await sleep(200);
  }
  await ev(`import('/js/settings.js').then((m) => { m.setSetting('appearance.style', 'ide'); return true; })`);
  await sleep(500);

  /* ---------- שורת פרויקט בתפריט הצד ---------- */
  await ev(`document.querySelector('#sideBtn').click(); true`);
  await page.waitFor(`document.querySelector('#side').dataset.liveReady === 'true' && document.querySelectorAll('.grp-name').length > 0`, 40000);
  await dbl('.grp-name');
  await ev(`window.__gn = document.querySelector('.grp-name'); true`);
  const pEd = await rect('input.rename-input');
  const pNm = await rect('.grp-name');
  t.check('project row: the editor sits exactly on the project name', near(pEd, pNm), JSON.stringify({ pEd, pNm }));
  t.check('project row: the editor text is not smaller than the row text', (await ev(`getComputedStyle(document.querySelector('input.rename-input')).fontSize === getComputedStyle(document.querySelector('.grp-name')).fontSize`)));
  await ev(`document.querySelector('#sideQ').dispatchEvent(new Event('input', { bubbles: true })); true`);
  await sleep(400);
  const rowStill = await ev(`({ editor: !!document.querySelector('input.rename-input'), sameNode: window.__gn === document.querySelector('.grp-name') })`);
  t.check('project row: a re-render of the side menu while editing is deferred (editor stays, the row is not rebuilt)', rowStill.editor && rowStill.sameNode, JSON.stringify(rowStill));
  await key('Escape', 'Escape', 27);
  await sleep(300);
  t.check('after closing, the deferred re-render happened (row rebuilt)', await ev(`window.__gn !== document.querySelector('.grp-name')`));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
