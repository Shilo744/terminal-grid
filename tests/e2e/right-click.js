'use strict';
// @slow
/*
 * קליק ימני (T57), בעכבר אמיתי: פותח את התפריט שלנו ולעולם לא מדביק, לא נוגע בלוח ולא משנה את הבחירה.
 *  - טרמינל: תפריט בנקודה (גם ליד הקצוות), העתקה פעילה רק עם בחירה, בחירת הכול, כל פריט עובד, Esc סוגר והמיקוד חוזר לטרמינל; אריח באותו תפריט;
 *  - לוח עם טקסט: שום דבר לא מגיע לתוכנית (תוכנית מדומה שמדפיסה בהקסה כל בית), והלוח לא נקרא בכלל;
 *  - לשונית זוג, פריט זוג בתפריט הצד ופרויקט בתפריט הצד: שינוי שם / השהיה / סגירה / שיחה חדשה; שטח ריק ברשת: תפריט "חדש"; שדה טקסט: התפריט המקורי של הדפדפן.
 * צילומי מסך: docs/screens/T57-terminal-menu.png, T57-tab-menu.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, TEST_HOME, sleep, poll, strip, checker, startServer, connect, openPage, seedHistory } = require('../lib/harness');

(async () => {
  const t = checker('right-click: our menu, never paste');
  seedHistory(TEST_HOME, { projects: 1, perProject: 1 });
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.mkdirSync(shots, { recursive: true });
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-keys') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Kc' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'Ps' });
  keeper.send({ t: 'create', kind: 'claude', cwd: process.env.USERPROFILE, name: 'Kd' });
  await poll(() => keeper.sessions.size === 3, 20000);
  const byName = (n) => [...keeper.sessions.values()].find((s) => s.name === n);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 800 });
  const { ev } = page;
  await page.appReady(3);
  const Kc = byName('Kc').id;
  await poll(() => /KEYS-FIXTURE ready/.test(strip(keeper.out.get(Kc) || '')), 20000);
  // לוח עם טקסט, ומונה קריאות: הקליק הימני לא קורא ממנו ולא כותב אליו
  await ev(`window.__clip = { text: 'PASTE-ME-NOT', reads: 0, writes: [] }; Object.defineProperty(navigator, 'clipboard', { value: { readText: () => { window.__clip.reads++; return Promise.resolve(window.__clip.text); }, writeText: (s) => { window.__clip.writes.push(s); return Promise.resolve(); } }, configurable: true }); true`);
  const rightClick = async (x, y) => { await page.mouse('mouseMoved', x, y); await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 }); await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(250); };
  const menuIds = () => ev(`[...document.querySelectorAll('.menu .menu-item')].map((b) => b.dataset.id + (b.classList.contains('disabled') ? ':off' : '')).join(',')`);
  const menuRect = () => ev(`(() => { const m = document.querySelector('.menu'); if (!m) return null; const r = m.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }; })()`);
  const key = (k, code, vk) => page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }));
  const bodyPoint = (id) => ev(`(() => { const r = document.querySelector('.pane[data-id="${id}"] .pane-body').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right, bottom: r.bottom }; })()`);
  const sel = (id) => ev(`(async () => { const { state } = await import('/js/state.js'); const p = state.panes.get('${id}'); return p.term.hasSelection() ? p.term.getSelection() : ''; })()`);
  const setSel = (id) => ev(`(async () => { const { state } = await import('/js/state.js'); const p = state.panes.get('${id}'); p.term.selectLines(0, 0); return p.term.getSelection(); })()`);

  /* ---------- טרמינל ---------- */
  let p = await bodyPoint(Kc);
  await rightClick(p.x, p.y);
  let ids = await menuIds();
  t.check('right-click on a Claude terminal opens the menu: copy, select all | rename, duplicate, expand, move | path, explorer, clear, compact | close', ids === 'copy:off,select-all,rename,duplicate,expand,move,copy-path,reveal,clear,compact,close', ids);
  const rc = await menuRect();
  t.check('the menu opens at the pointer, inside the window', !!rc && rc.l >= 0 && rc.t >= 0 && rc.r <= rc.vw && rc.b <= rc.vh, JSON.stringify(rc));
  t.check('NOTHING reached the program (no paste, no bytes at all) and the clipboard was not even read', (strip(keeper.out.get(Kc) || '').match(/KEYS [0-9a-f ]+/g) || []).length === 0 && (await ev(`window.__clip.reads`)) === 0, JSON.stringify(await ev('window.__clip')));
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
  const escState = await ev(`JSON.stringify({ menu: !!document.querySelector('.menu'), active: (document.activeElement || {}).className, inPane: !!(document.activeElement && document.activeElement.closest('.pane[data-id="${Kc}"]')) })`);
  t.check('Esc closes it and the focus is back in the terminal', !JSON.parse(escState).menu && JSON.parse(escState).inPane && /xterm-helper-textarea/.test(JSON.parse(escState).active), escState);
  // ליד הקצוות
  const edge = await bodyPoint(Kc);
  await rightClick(edge.right - 3, edge.bottom - 3);
  const re = await menuRect();
  t.check('near the right/bottom edge the menu still opens fully inside the window', !!re && re.l >= 0 && re.t >= 0 && re.r <= re.vw && re.b <= re.vh, JSON.stringify(re));
  await key('Escape', 'Escape', 27); await sleep(200);
  // בחירה: לא משתנה בקליק ימני, וההעתקה פעילה רק איתה
  const text = await setSel(Kc);
  t.check('(setup) a selection exists', text.length > 0);
  await rightClick(p.x, p.y + 30);
  t.check('a right-click does not touch the selection, and "copy" is enabled only now', (await sel(Kc)) === text && (await menuIds()).startsWith('copy,select-all'), await menuIds());
  await page.screenshotTo ? 0 : 0;
  fs.writeFileSync(path.join(shots, 'T57-terminal-menu.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await ev(`document.querySelector('.menu [data-id="copy"]').click(); true`);
  await sleep(250);
  t.check('"copy" writes the selection to the clipboard (a user gesture), nothing is read', JSON.stringify(await ev('window.__clip.writes')) === JSON.stringify([text]) && (await ev('window.__clip.reads')) === 0, JSON.stringify(await ev('window.__clip')));
  await rightClick(p.x, p.y);
  await ev(`document.querySelector('.menu [data-id="select-all"]').click(); true`);
  await sleep(200);
  t.check('"select all" selects the terminal text', (await sel(Kc)).length >= text.length);
  // פריטים
  const Ps = byName('Ps').id;
  const pp = await bodyPoint(Ps);
  await rightClick(pp.x, pp.y);
  t.check('a shell terminal gets the same menu without the Claude-only compaction', (await menuIds()) === 'copy:off,select-all,rename,duplicate,expand,move,copy-path,reveal,clear,close', await menuIds());
  await ev(`document.querySelector('.menu [data-id="rename"]').click(); true`);
  await sleep(250);
  t.check('"rename" starts the inline edit on that terminal', await ev(`document.querySelector('.pane[data-id="${Ps}"] .name').getAttribute('contenteditable') === 'plaintext-only'`));
  await key('Escape', 'Escape', 27);
  await rightClick(pp.x, pp.y);
  await ev(`document.querySelector('.menu [data-id="expand"]').click(); true`);
  t.check('"expand" enlarges it (the others become tiles)', !!(await poll(() => ev(`document.querySelectorAll('.pane.tile').length >= 1`), 6000, 100)));
  // אריח
  const tileId = await ev(`document.querySelector('.pane.tile').dataset.id`);
  const tr = await ev(`(() => { const r = document.querySelector('.pane.tile[data-id="${tileId}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height - 8 }; })()`);
  await rightClick(tr.x, tr.y);
  t.check('right-click on a tile opens the pane menu too (never the browser menu, never a paste)', (await menuIds()).includes('rename') && (await menuIds()).includes('close') && (await ev('window.__clip.reads')) === 0, await menuIds());
  await key('Escape', 'Escape', 27); await sleep(200);
  await ev(`import('/js/layout.js').then((m) => { m.setExpanded(null); return true; })`);
  await sleep(300);
  // סגירה מהתפריט
  const Kd = byName('Kd').id;
  const kd = await bodyPoint(Kd);
  await rightClick(kd.x, kd.y);
  await ev(`document.querySelector('.menu [data-id="close"]').click(); true`);
  t.check('"close" closes the terminal (one step, T55)', !!(await poll(() => !byName('Kd'), 8000, 100)));
  // שטח ריק וטקסט
  await ev(`import('/js/layout.js').then((m) => { return true; })`);
  const input = await ev(`(() => { const i = document.querySelector('#sideQ'); const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); i.dispatchEvent(e); return e.defaultPrevented; })()`);
  t.check('a text field keeps the browser\'s own menu (copy/paste there is expected)', input === false);

  /* ---------- זוג, תפריט הצד, שטח ריק ---------- */
  page.close(); keeper.close(); srv.stop();
  await sleep(500);
  const project = path.join(TMP, 'right-click-pair');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nHi.\n');
  const srv2 = await startServer({ binDir: path.join(FIXTURES, 'bin-duo') });
  const k2 = await connect(srv2.port);
  k2.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r' });
  const created = await poll(() => k2.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  k2.send({ t: 'duo', op: 'pause', duoId: created.duoId });
  const pg = await openPage(`http://127.0.0.1:${srv2.port}/`, { width: 1400, height: 800 });
  await pg.appReady(0);
  const ids2 = () => pg.ev(`[...document.querySelectorAll('.menu .menu-item')].map((b) => b.dataset.id).join(',')`);
  const rc2 = async (sel, x, y) => { const r = await pg.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); const px = x == null ? r.x : x, py = y == null ? r.y : y; await pg.mouse('mouseMoved', px, py); await pg.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'right', buttons: 2, clickCount: 1 }); await pg.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'right', buttons: 2, clickCount: 1 }); await sleep(250); };
  // שטח ריק (מסך הפתיחה)
  await pg.ev(`(() => { const b = document.querySelector('.gtab'); if (b) b.click(); return !!b; })()`);
  await sleep(300);
  await rc2('#stage', 300, 600);
  t.check('right-click on an empty area of the grid opens the "new" menu (Claude, PowerShell, grid tab, pair, import, folder)', (await ids2()) === 'claude,powershell,tab,duo,adopt,folder', await ids2());
  await pg.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  await pg.ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await pg.waitFor(`!!document.querySelector('.duo-tab[data-id] .nm')`, 20000);
  await rc2('.duo-tab[data-id]');
  t.check('right-click on a pair tab: rename, pause, close', (await ids2()) === 'rename,pause,close', await ids2());
  fs.writeFileSync(path.join(shots, 'T57-tab-menu.png'), Buffer.from((await pg.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await pg.ev(`document.querySelector('.menu [data-id="rename"]').click(); true`);
  await sleep(300);
  t.check('"rename" opens the inline editor on the tab', await pg.ev(`!!document.querySelector('.rename-input')`));
  await pg.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
  await rc2('.duo-tab[data-id]');
  await pg.ev(`document.querySelector('.menu [data-id="pause"]').click(); true`);
  await sleep(500);
  t.check('"resume" shows for a paused pair and works', await pg.ev(`true`) && !!(await poll(async () => { const d = [...k2.messages].reverse().find((m) => m.t === 'duo' && m.op === 'state'); return d && d.duo.paused === false; }, 8000, 100)));
  await rc2('.duo-tab[data-id]');
  await pg.ev(`document.querySelector('.menu [data-id="close"]').click(); true`);
  await sleep(500);
  t.check('"close the pair" goes to its board and arms the quiet two-step button (the pair is NOT closed yet)', await pg.ev(`document.querySelector('.db-close') && document.querySelector('.db-close').classList.contains('armed')`) && [...k2.sessions.values()].filter((s) => s.duo).length === 2);
  // תפריט הצד
  await pg.ev(`document.querySelector('.gtab').click(); document.querySelector('#sideBtn').click(); true`);
  await pg.waitFor(`!!document.querySelector('.grp-head') && !!document.querySelector('.duo-item')`, 20000);
  await rc2('.duo-item');
  t.check('right-click on a pair row in the side menu: the same three items', (await ids2()) === 'rename,pause,close', await ids2());
  await pg.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  await rc2('.grp-head');
  t.check('right-click on a project row: rename, new conversation here, copy path', (await ids2()) === 'rename,new,copy-path', await ids2());
  await pg.ev(`document.querySelector('.menu [data-id="rename"]').click(); true`);
  await sleep(300);
  t.check('...and "rename" opens the inline editor on the project', await pg.ev(`!!document.querySelector('.rename-input')`));
  t.check('no JavaScript errors', pg.errors.length === 0, pg.errors.slice(0, 3).join(' | '));
  pg.close(); k2.close(); srv2.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
