'use strict';
// @slow
/*
 * תפריט הפעולות של טרמינל (T9): כפתור "⋯" ולחיצה ימנית על הכותרת, כל הפעולות, ושכבת "התהליך הסתיים" עם הפעלה מחדש וסגירה.
 * claude מדומה (bin-args), Explorer לא מופעל (TG_TEST_REVEAL_LOG), הלוח והשליחה לשרת נתפסים בדף.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('pane menu and exited overlay');
  const work = path.join(TMP, 'pane-menu-work');
  const dirs = ['p', 'c', 'q'].map((n) => { const d = path.join(work, n); fs.mkdirSync(d, { recursive: true }); return d; });
  const revealLog = path.join(TMP, 'reveal-log-ui.txt');
  try { fs.unlinkSync(revealLog); } catch { /* none */ }
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-args'), env: { TG_TEST_REVEAL_LOG: revealLog } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'create', kind: 'powershell', cwd: dirs[0], name: 'P' });
  keeper.send({ t: 'create', kind: 'claude', cwd: dirs[1], name: 'C' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: dirs[2], name: 'Q' });
  await poll(() => keeper.sessions.size === 3, 20000);
  const id = (n) => [...keeper.sessions.values()].find((s) => s.name === n).id;
  const [P, C, Q] = [id('P'), id('C'), id('Q')];

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(3);
  const pane = (x) => `document.querySelector('.pane[data-id="${x}"]')`;
  const modState = `import('/js/state.js').then((m) => m.state)`;
  const order = () => page.ev(`${modState}.then((s) => JSON.stringify(s.order))`).then(JSON.parse);
  const menuIds = () => page.ev(`[...document.querySelectorAll('.menu .menu-item')].map((b) => b.dataset.id).join(',')`);
  const menuOpen = () => page.ev(`!!document.querySelector('.menu .menu-item')`);
  const openVia = async (x) => { await page.ev(`${pane(x)}.querySelector('[data-act="menu"]').click(); true`); await poll(menuOpen, 4000, 80); };
  const pick = async (item) => { await page.ev(`document.querySelector('.menu .menu-item[data-id="${item}"]').click(); true`); await poll(async () => !(await menuOpen()), 4000, 80); };
  await page.ev(`window.__clip = null; navigator.clipboard.writeText = (s) => { window.__clip = s; return Promise.resolve(); }; window.__sent = []; ${modState}.then((s) => { const f = s.ws.send.bind(s.ws); s.ws.send = (d) => { try { window.__sent.push(JSON.parse(d)); } catch {} return f(d); }; }); true`);
  await sleep(300);

  t.check('every pane header has a "⋯" button with a label', await page.ev(`[...document.querySelectorAll('.pane')].every((p) => { const b = p.querySelector('[data-act="menu"]'); return !!b && b.getAttribute('aria-label').length > 3 && b.getAttribute('aria-haspopup') === 'menu'; })`));

  // ---------- פריטי התפריט ----------
  await openVia(P);
  t.check('a running PowerShell pane: rename, duplicate, copy path, reveal, clear, expand, move to tab, close (no restart, no compact)', (await menuIds()) === 'rename,duplicate,copy-path,reveal,clear,expand,move,close', await menuIds());
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await poll(async () => !(await menuOpen()), 3000, 80);
  await openVia(C);
  t.check('a running Claude pane also has "דחיסת השיחה עכשיו"', (await menuIds()) === 'rename,duplicate,copy-path,reveal,clear,expand,move,compact,close', await menuIds());
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await poll(async () => !(await menuOpen()), 3000, 80);
  await page.ev(`${pane(P)}.querySelector('.pane-head').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 100 })); true`);
  t.check('right-click on the header opens the same menu', await poll(menuOpen, 4000, 80) && (await menuIds()) === 'rename,duplicate,copy-path,reveal,clear,expand,move,close');
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await poll(async () => !(await menuOpen()), 3000, 80);

  // ---------- פעולות ----------
  await openVia(P); await pick('copy-path');
  t.check('copy path puts the terminal folder on the clipboard', await poll(() => page.ev('window.__clip'), 3000, 100) === dirs[0], String(await page.ev('window.__clip')));
  await openVia(P); await pick('reveal');
  t.check('reveal asks the server to open that terminal folder', await poll(() => fs.existsSync(revealLog) && fs.readFileSync(revealLog, 'utf8').includes(JSON.stringify(dirs[0]).slice(1, -1)), 5000, 100));

  keeper.send({ t: 'input', id: P, d: 'echo clearme-marker\r' });
  const bufHas = (x, s) => page.ev(`${modState}.then((st) => { const b = st.panes.get('${x}').term.buffer.active; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString(true).includes('${s}')) return true; return false; })`);
  t.check('(setup) the marker text is on the PowerShell screen', await poll(() => bufHas(P, 'clearme-marker'), 15000, 200));
  // מחכים שה-prompt יחזור (השורה האחרונה היא "PS ...>" בלי הסמן על שורת הפקודה): clear משאיר את שורת הסמן, ואם הפקודה עוד רצה היא הייתה נשארת
  await poll(() => page.ev(`${modState}.then((st) => { const b = st.panes.get('${P}').term.buffer.active; for (let y = b.length - 1; y >= 0; y--) { const s = b.getLine(y).translateToString(true).trim(); if (s) return s.startsWith('PS ') && !s.includes('clearme-marker'); } return false; })`), 15000, 200);
  await openVia(P); await pick('clear');
  t.check('clear removes the screen content (client buffer)', await poll(async () => !(await bufHas(P, 'clearme-marker')), 6000, 150));

  // הסטטוס של Claude בלי hooks הוא ניחוש לפי תזמון הפלט (ציור מחדש אחרי שינוי גודל נראה "עובד" שנייה-שתיים): מחכים שיירגע
  await poll(() => page.ev(`!${pane(C)}.classList.contains('s-busy')`), 15000, 200);
  await page.ev('window.__sent.length = 0; true');
  await openVia(C); await pick('compact');
  const sent = await page.ev('JSON.stringify(window.__sent)').then(JSON.parse);
  const inp = sent.find((m) => m.t === 'input' && m.id === C);
  t.check('compact sends /compact as a bracketed paste followed by Enter to that terminal', !!inp && inp.d === '\x1b[200~/compact\x1b[201~\r', JSON.stringify(inp));
  t.check('an idle agent gets no "working" warning', await page.ev(`![...document.querySelectorAll('#toasts .toast')].some((x) => x.textContent.includes('עובד עכשיו'))`), await page.ev(`[...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | ') + ' status=' + ${pane(C)}.className`));
  await page.ev(`${modState}.then((s) => { s.panes.get('${C}').meta.agentState = 'working'; }); document.querySelectorAll('#toasts .toast').forEach((x) => x.remove()); true`);
  await openVia(C); await pick('compact');
  t.check('while the agent works the toast explains that /compact is queued', await poll(() => page.ev(`[...document.querySelectorAll('#toasts .toast')].some((x) => x.textContent.includes('הדחיסה תתבצע כשיסיים את התור'))`), 3000, 100));

  const ordBefore = await order();
  await openVia(P); await pick('duplicate');
  t.check('duplicate opens a new terminal of the same kind and folder right after the original', await poll(async () => { const o = await order(); return o.length === 4 && o[o.indexOf(P) + 1] !== ordBefore[ordBefore.indexOf(P) + 1]; }, 10000, 150));
  const dupId = (await order())[(await order()).indexOf(P) + 1];
  t.check('the copy has the same folder', keeper.sessions.get(dupId) && keeper.sessions.get(dupId).cwd === dirs[0] && keeper.sessions.get(dupId).kind === 'powershell');

  await openVia(Q); await pick('expand');
  t.check('expand makes it the main terminal (the others become tiles)', await poll(() => page.ev(`document.querySelectorAll('.pane.tile').length === 3 && !${pane(Q)}.classList.contains('tile')`), 6000, 100));
  await openVia(Q);
  t.check('and the item now offers to go back to the grid', await page.ev(`document.querySelector('.menu .menu-item[data-id="expand"]').textContent.includes('חזרה לתצוגת רשת')`));
  await pick('expand');
  t.check('collapse returns to the grid', await poll(() => page.ev(`document.querySelectorAll('.pane.tile').length === 0`), 6000, 100));

  await openVia(C); await pick('close');
  t.check('close from the menu closes at once, like the X button (T55)', await poll(async () => !(await order()).includes(C), 8000, 100));

  // ---------- התהליך הסתיים ----------
  t.check('a running terminal has no exit overlay', await page.ev(`${pane(Q)}.querySelector('.pane-exit').hidden`));
  keeper.send({ t: 'input', id: Q, d: 'exit\r' });
  t.check('after the process exits the overlay shows the exit code with restart and close', await poll(() => page.ev(`(() => { const o = ${pane(Q)}.querySelector('.pane-exit'); return !o.hidden && /exit code 0/.test(o.textContent) && /הפעלה מחדש/.test(o.textContent) && /סגירה/.test(o.textContent); })()`), 20000, 200));
  await openVia(Q);
  t.check('the menu of an exited pane now has "הפעלה מחדש"', (await menuIds()).includes('restart'), await menuIds());
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await poll(async () => !(await menuOpen()), 3000, 80);
  const posQ = (await order()).indexOf(Q);
  await page.ev(`${pane(Q)}.querySelector('.pane-exit [data-act="restart"]').click(); true`);
  t.check('the overlay restart button reopens it in the same place and the overlay goes away', await poll(async () => { const o = await order(); return o.length === 3 && !o.includes(Q) && o.indexOf(o[posQ]) === posQ && await page.ev(`!document.querySelector('.pane-exit:not([hidden])')`); }, 25000, 200));

  keeper.send({ t: 'input', id: dupId, d: 'exit\r' });
  await poll(() => page.ev(`!${pane(dupId)}.querySelector('.pane-exit').hidden`), 20000, 200);
  await page.ev(`${pane(dupId)}.querySelector('.pane-exit [data-act="close"]').click(); true`);
  t.check('the overlay close button removes an exited terminal at once (no second click)', await poll(async () => !(await order()).includes(dupId) && !(await page.ev(`!!${pane(dupId)}`)), 8000, 150));
  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
