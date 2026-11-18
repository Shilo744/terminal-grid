'use strict';
// @slow
/*
 * שינוי שם בכל משטח שיש לו שם (T56), בדפדפן אמיתי: כותרת פאן, אריח, לשונית זוג, כותרת לוח הזוג, פריט הזוג בתפריט הצד, ופרויקט בתפריט הצד.
 * כל אחד: לחיצה כפולה (עכבר אמיתי), F2, Enter שומר, Esc מבטל, עברית, שם ארוך (נחתך ל-60 בשרת, והפריסה לא נשברת), נשמר אחרי טעינה מחדש.
 * סוכני זוג: התפקיד קבוע. צילומי מסך: docs/screens/T56-rename-pencil.png, T56-rename-tile.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, TEST_HOME, sleep, poll, checker, startServer, connect, openPage, seedHistory } = require('../lib/harness');

(async () => {
  const t = checker('rename on every card');
  seedHistory(TEST_HOME, { projects: 1, perProject: 2 });
  const project = path.join(TMP, 'rename-ui-pair');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nHi.\n');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo') });
  const keeper = await connect(srv.port);
  for (const n of ['A', 'B', 'C']) keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: n });
  await poll(() => keeper.sessions.size === 3, 20000);
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r' });
  const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  keeper.send({ t: 'duo', op: 'pause', duoId: created.duoId });
  await poll(() => [...keeper.sessions.values()].filter((s) => s.duo).length === 2, 30000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 800 });
  const { ev } = page;
  await page.appReady(3);
  const byName = (n) => [...keeper.sessions.values()].find((s) => s.name === n && !s.duo);
  const key = (k, code, vk) => page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }));
  const dbl = async (sel) => { const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); await page.mouse('mouseMoved', r.x, r.y); await page.mouse('mousePressed', r.x, r.y, { clickCount: 1 }); await page.mouse('mouseReleased', r.x, r.y, { clickCount: 1 }); await page.mouse('mousePressed', r.x, r.y, { clickCount: 2 }); await page.mouse('mouseReleased', r.x, r.y, { clickCount: 2 }); await sleep(200); };
  const nameOf = (id) => `document.querySelector('.pane[data-id="${id}"] .name')`;
  const editing = (id) => ev(`${nameOf(id)}.getAttribute('contenteditable') === 'plaintext-only'`);

  /* ---------- כותרת פאן ---------- */
  const A = byName('A').id;
  await ev(`${nameOf(A)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  t.check('pane: double-click makes the name editable', await editing(A));
  await page.call('Input.insertText', { text: 'שרת הבדיקות' });
  await key('Enter', 'Enter', 13);
  t.check('pane: Enter saves a Hebrew name (header and server)', !!(await poll(async () => (await ev(`${nameOf(A)}.textContent`)) === 'שרת הבדיקות', 5000, 100)) && keeper.messages.some((m) => m.t === 'renamed' && m.id === A && m.name === 'שרת הבדיקות'));
  await ev(`${nameOf(A)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  await page.call('Input.insertText', { text: 'zzz' });
  await key('Escape', 'Escape', 27);
  t.check('pane: Esc cancels (the old name stays)', (await ev(`${nameOf(A)}.textContent`)) === 'שרת הבדיקות' && !(await editing(A)));
  await ev(`${nameOf(A)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  await page.call('Input.insertText', { text: 'ש'.repeat(80) });
  await key('Enter', 'Enter', 13);
  await poll(async () => (await ev(`${nameOf(A)}.textContent`)).length === 60, 5000, 100);
  t.check('pane: a very long name is cut to 60 and the header layout holds (buttons stay inside the pane)', await ev(`(() => { const p = document.querySelector('.pane[data-id="${A}"]'); const pr = p.getBoundingClientRect(); const c = p.querySelector('[data-act="close"]').getBoundingClientRect(); const n = ${nameOf(A)}; return n.textContent.length === 60 && c.left >= pr.left && c.right <= pr.right + 1 && n.scrollWidth >= n.clientWidth; })()`));
  await ev(`${nameOf(A)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  await page.call('Input.insertText', { text: '   ' });
  await key('Enter', 'Enter', 13);
  t.check('pane: an empty name keeps the old one', (await ev(`${nameOf(A)}.textContent`)).length === 60);
  await ev(`${nameOf(A)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  await page.call('Input.insertText', { text: 'A2' });
  await key('Enter', 'Enter', 13);
  await poll(async () => (await ev(`${nameOf(A)}.textContent`)) === 'A2' && !(await editing(A)), 5000, 50);
  await ev(`document.querySelector('.pane[data-id="${A}"] [data-act="close"]').focus(); true`);
  await key('F2', 'F2', 113);
  t.check('pane: F2 with the focus on the pane header starts the rename', await editing(A));
  await key('Escape', 'Escape', 27);
  await ev(`document.querySelector('.pane[data-id="${A}"] .xterm-helper-textarea').focus(); true`);
  await key('F2', 'F2', 113);
  t.check('pane: F2 inside the terminal is NOT intercepted', !(await editing(A)));
  // עיפרון בריחוף
  const r = await ev(`(() => { const b = ${nameOf(A)}.getBoundingClientRect(); return { x: b.x + 10, y: b.y + b.height / 2 }; })()`);
  await page.mouse('mouseMoved', r.x, r.y);
  await poll(() => ev(`${nameOf(A)}.matches(':hover')`), 3000, 50);
  await sleep(150);
  const pen = await ev(`JSON.stringify({ at: (document.elementFromPoint(${r.x}, ${r.y}) || {}).className, rect: ${nameOf(A)}.getBoundingClientRect().toJSON(), hover: ${nameOf(A)}.matches(':hover'), content: getComputedStyle(${nameOf(A)}, '::after').content, w: getComputedStyle(${nameOf(A)}, '::after').width })`);
  t.check('pane: a faint pencil appears when hovering the name', JSON.parse(pen).hover && JSON.parse(pen).content !== 'none' && JSON.parse(pen).w === '11px', pen);
  const out1 = path.join(__dirname, '..', '..', 'docs', 'screens', 'T56-rename-pencil.png');
  fs.mkdirSync(path.dirname(out1), { recursive: true });
  fs.writeFileSync(out1, Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  /* ---------- אריח ---------- */
  const C = byName('C').id;
  await ev(`import('/js/layout.js').then((m) => { m.setExpanded('${A}'); return true; })`);
  await page.waitFor(`document.querySelectorAll('.pane.tile').length >= 2`, 8000);
  await ev(`${nameOf(C)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
  t.check('tile: double-click on the name makes it editable', await editing(C));
  await page.call('Input.insertText', { text: 'אריח ג' });
  const out2 = path.join(__dirname, '..', '..', 'docs', 'screens', 'T56-rename-tile.png');
  fs.writeFileSync(out2, Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await key('Enter', 'Enter', 13);
  t.check('tile: Enter saves it', !!(await poll(async () => (await ev(`${nameOf(C)}.textContent`)) === 'אריח ג', 5000, 100)));
  await ev(`import('/js/layout.js').then((m) => { m.setExpanded(null); return true; })`);

  /* ---------- זוג: לשונית, לוח, תפריט הצד ---------- */
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.duo-tab[data-id] .nm') && !!document.querySelector('.db-name')`, 20000);
  const tabName = () => ev(`document.querySelector('.duo-tab[data-id] .nm').textContent`);
  const surfaces = () => ev(`({ tab: document.querySelector('.duo-tab[data-id] .nm').textContent, board: document.querySelector('.db-name').textContent, list: document.querySelector('.duo-item .nm').textContent })`);
  t.check('pair: before renaming all three surfaces show the project folder name', JSON.stringify(await surfaces()) === JSON.stringify({ tab: 'rename-ui-pair', board: 'rename-ui-pair', list: 'rename-ui-pair' }), JSON.stringify(await surfaces()));
  await dbl('.duo-tab[data-id] .nm');
  const inputOn = () => ev(`(() => { const i = document.querySelector('.rename-input'); return i ? { v: i.value, dir: i.dir, max: i.maxLength } : null; })()`);
  const inp = await inputOn();
  t.check('pair: a real double-click on the tab opens an inline editor with the current name (RTL-aware, max 60)', !!inp && inp.v === 'rename-ui-pair' && inp.dir === 'auto' && inp.max === 60, JSON.stringify(inp));
  await page.call('Input.insertText', { text: 'צוות האתר' });
  await key('Enter', 'Enter', 13);
  const s1 = await poll(async () => { const s = await surfaces(); return s.tab === 'צוות האתר' && s.board === 'צוות האתר' && s.list === 'צוות האתר' ? s : null; }, 8000, 100);
  t.check('pair: the new name shows in the tab, the board title and the side-menu row (one source)', !!s1, JSON.stringify(await surfaces()));
  t.check('pair: the agent roles keep their fixed names', (await ev(`[...document.querySelectorAll('.db-agent b')].map((b) => b.textContent).join()`)) === 'ארכיטקט,עובד');
  await dbl('.duo-tab[data-id] .nm');
  await page.call('Input.insertText', { text: 'לא לשמור' });
  await key('Escape', 'Escape', 27);
  t.check('pair: Esc cancels', (await tabName()) === 'צוות האתר' && !(await inputOn()));
  await ev(`document.querySelector('.duo-tab[data-id]').focus(); true`);
  await key('F2', 'F2', 113);
  t.check('pair: F2 with the tab focused opens the editor', !!(await inputOn()));
  await page.call('Input.insertText', { text: 'ש'.repeat(80) });
  await key('Enter', 'Enter', 13);
  await poll(async () => (await tabName()).length === 60, 8000, 100);
  t.check('pair: a long name is cut to 60 and the tab keeps its layout (ellipsis, the progress label stays inside the tab)', await ev(`(() => { const tab = document.querySelector('.duo-tab[data-id]'); const tr = tab.getBoundingClientRect(); const pr = tab.querySelector('.pr').getBoundingClientRect(); return pr.right <= tr.right + 1 && pr.left >= tr.left - 1 && tab.getBoundingClientRect().width < 700; })()`));
  await dbl('.db-name');
  t.check('pair: double-click on the board title opens the editor too', !!(await inputOn()));
  await page.call('Input.insertText', { text: 'הזוג הראשי' });
  await key('Enter', 'Enter', 13);
  t.check('pair: renamed from the board title', !!(await poll(async () => (await tabName()) === 'הזוג הראשי', 8000, 100)));
  await dbl('.duo-col[data-role="worker"] .name');
  t.check('pair agents: the role name cannot be edited (no editor, no contenteditable)', !(await inputOn()) && !(await ev(`!!document.querySelector('.duo-col .name[contenteditable]')`)));
  await page.reload();
  await page.appReady(1);
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.duo-tab[data-id] .nm')`, 20000);
  t.check('pair: the name survives a reload', (await tabName()) === 'הזוג הראשי');

  /* ---------- פרויקט בתפריט הצד ---------- */
  await ev(`document.querySelector('.gtab').click(); document.querySelector('#sideBtn').click(); true`);
  await page.waitFor(`!!document.querySelector('.grp-head')`, 20000);
  const grp = () => ev(`(() => { const h = document.querySelector('.grp-head'); return { name: h.querySelector('.grp-name').textContent, title: h.title, ses: [...document.querySelectorAll('.grp:first-child .ses .ses-title')].map((s) => s.textContent) }; })()`);
  const g0 = await grp();
  t.check('project: the row shows the folder name and the real path in the tooltip', g0.name === 'proj1' && /proj1/.test(g0.title), JSON.stringify(g0));
  await dbl('.grp-head .grp-name');
  t.check('project: a real double-click opens the editor with the current name', (await inputOn() || {}).v === 'proj1');
  await page.call('Input.insertText', { text: 'הפרויקט הראשון' });
  await key('Enter', 'Enter', 13);
  const g1 = await poll(async () => { const g = await grp(); return g.name === 'הפרויקט הראשון' ? g : null; }, 8000, 100);
  t.check('project: the display name is shown, the folder path stays in the tooltip, the conversation rows keep their own names', !!g1 && /proj1/.test(g1.title) && /הפרויקט הראשון/.test(g1.title) && g1.ses.join() === g0.ses.join(), JSON.stringify(g1));
  await page.reload();
  await page.appReady(1);
  await page.ev(`if (!document.querySelector('.grp-head')) document.querySelector('#sideBtn').click(); true`);
  await page.waitFor(`!!document.querySelector('.grp-head')`, 20000);
  t.check('project: the name survives a reload (stored on the server by the path)', (await grp()).name === 'הפרויקט הראשון');
  await ev(`document.querySelector('.grp-head').focus(); true`);
  await key('F2', 'F2', 113);
  t.check('project: F2 with the row focused opens the editor', !!(await inputOn()));
  await page.call('Input.insertText', { text: 'proj1' });
  await key('Enter', 'Enter', 13);
  const g2 = await poll(async () => { const g = await grp(); return g.name === 'proj1' ? g : null; }, 8000, 100);
  t.check('project: typing the folder name again removes the custom name', !!g2 && !/הפרויקט הראשון/.test(g2.title), JSON.stringify(g2));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
