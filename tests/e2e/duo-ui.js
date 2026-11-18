'use strict';
// The agent-duo screen in a real headless Chrome with fake agents: create from the button, three columns, board, compose,
// pause, grid/duo switch, side-menu list, reload. Also asserts there are no JS errors.
const path = require('path');
const fs = require('fs');
const { APP, FIXTURES, TMP, sleep, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('duo UI');
  let failedAny = false;
  const rawCheck = t.check.bind(t);
  t.check = (name, ok, extra) => { if (!ok) failedAny = true; return rawCheck(name, ok, extra); };
  const project = path.join(TMP, 'duo-ui-' + Date.now());
  fs.mkdirSync(project, { recursive: true });
  const srv = await startServer({ stateFile: path.join(TMP, 'duo-ui-state.json'), binDir: path.join(FIXTURES, 'bin-duo') });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1600, height: 900 });
  const { ev } = page;
  await page.appReady(0);
  // the dialog starts from the working folder: point it at the temp project (a server-side setting since T3), then reload so the page picks it up
  const keeper = await connect(srv.port);
  keeper.send({ t: 'settings:set', patch: { ui: { cwd: project } } });
  for (let i = 0; i < 50 && !(keeper.settings && keeper.settings.ui.cwd === project); i++) await sleep(100);
  keeper.close();
  await page.reload();
  await page.appReady(0);

  t.check('there is a place to create a duo: the New menu + the "+" of the tab row', await ev(`!!document.querySelector('#newMenuBtn') && !!document.querySelector('.duo-tab-new') && !!document.querySelector('#sideNewDuo')`));
  t.check('starts in the grid view', await ev(`document.querySelector('#stage').hidden === false && document.querySelector('#duoView').hidden === true`));

  await ev(`document.querySelector('#newMenuBtn').click()`);
  await page.waitFor(`!!document.querySelector('.menu')`, 5000);
  await ev(`document.querySelector('.menu [data-id="duo"]').click()`);
  t.check('the menu item opens the creation dialog', await page.waitFor(`document.querySelector('#duoDlg').open === true`, 5000));
  t.check('dialog shows the working folder', (await ev(`document.querySelector('#duoFolderLabel').textContent`)) === path.basename(project), await ev(`document.querySelector('#duoFolderLabel').textContent`));
  await ev(`document.querySelector('#duoGoal').value = 'Build the thing'`);
  // משוב מיידי (T38): עוקבים אחרי ה-DOM מרגע הלחיצה, כדי לדעת שהלשונית/הכרטיס "יוצר..." הופיעו לפני שהשרת ענה (גם אם הוא עונה מהר)
  await ev(`window.__sawCreating = false; new MutationObserver(() => { if (document.querySelector('.duo-tab.pending') || !document.querySelector('#duoCreating').hidden) window.__sawCreating = true; }).observe(document.body, { subtree: true, childList: true, attributes: true }); true`);
  await ev(`document.querySelector('#duoDlg .dlg-actions .btn.primary').click()`);

  t.check('after creating, the duo screen is shown (grid hidden)', await page.waitFor(`document.querySelector('#duoView').hidden === false && document.querySelector('#stage').hidden === true && document.querySelectorAll('.duo-slot .pane[data-duo]').length === 2`, 30000));
  t.check('creating a duo showed the "יוצר..." tab/card at once, before the server answered', await ev(`window.__sawCreating === true`));
  t.check('and it is gone now that the duo exists', await ev(`!document.querySelector('.duo-tab.pending') && document.querySelector('#duoCreating').hidden`));
  t.check('one tab for the duo', await ev(`document.querySelectorAll('.duo-tab:not(.duo-tab-new)').length`) === 1);

  // geometry: architect on the RIGHT, board in the middle, worker on the LEFT, panes fill their columns
  const g = await ev(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
    return { arch: r('.pane[data-duo="architect"]'), work: r('.pane[data-duo="worker"]'), board: r('#duoBoard'),
      archSlot: r('.duo-col[data-role="architect"] .duo-slot'), workSlot: r('.duo-col[data-role="worker"] .duo-slot') }; })()`);
  t.check('both agent terminals are shown', !!g.arch && !!g.work);
  t.check('architect is on the right, board in the middle, worker on the left', !!g.arch && g.arch.l >= g.board.r - 4 && g.work.r <= g.board.l + 4, JSON.stringify({ arch: g.arch && [g.arch.l, g.arch.r], board: [g.board.l, g.board.r], work: g.work && [g.work.l, g.work.r] }));
  const fill = (p, s) => p && Math.abs(p.l - s.l) <= 2 && Math.abs(p.r - s.r) <= 2 && Math.abs(p.t - s.t) <= 2 && Math.abs(p.b - s.b) <= 2;
  t.check('each terminal fills its column', fill(g.arch, g.archSlot) && fill(g.work, g.workSlot), JSON.stringify({ arch: g.arch, slot: g.archSlot }));
  t.check('duo terminals are not in the regular grid', await ev(`document.querySelectorAll('#stage .pane').length`) === 0);

  // the loop runs (fake agents) and the board follows
  const done = await (async () => { for (let i = 0; i < 300; i++) { if (/2 מתוך 2/.test(await ev(`document.querySelector('.db-progress-text') ? document.querySelector('.db-progress-text').textContent : ''`))) return true; await sleep(500); } return false; })();
  t.check('the board shows the tasks completed (2 מתוך 2)', done, await ev(`document.querySelector('.db-progress-text') && document.querySelector('.db-progress-text').textContent`));
  t.check('task list shows both tasks as done', await ev(`document.querySelectorAll('.db-task.s-done').length`) === 2);
  const waitUntil = async (fn, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(400); } return false; };
  t.check('shared chat shows the messages (user, architect, worker, architect)', await waitUntil(async () => (await ev(`document.querySelectorAll('.db-bubble').length`)) >= 4), String(await ev(`document.querySelectorAll('.db-bubble').length`)));
  t.check('chat entries are labeled by role', (await ev(`[...document.querySelectorAll('.db-group-head b')].map(b => b.textContent)`)).join(',').includes('ארכיטקט') && (await ev(`[...document.querySelectorAll('.db-group-head b')].map(b => b.textContent)`)).join(',').includes('עובד'));
  t.check('both agents show as idle when there is nothing to do', await waitUntil(async () => (await ev(`[...document.querySelectorAll('.db-agent .st')].map(s => s.textContent)`)).every((x) => x.startsWith('פנוי'))), JSON.stringify(await ev(`[...document.querySelectorAll('.db-agent .st')].map(s => s.textContent)`)));

  // write to the shared chat from the board
  const before = await ev(`document.querySelectorAll('.db-bubble').length`);
  await ev(`(() => { const x = document.querySelector('.db-compose textarea'); x.value = 'One more thing please'; x.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.db-compose').requestSubmit(); })()`);
  await page.waitFor(`document.querySelectorAll('.db-bubble').length > ${before}`, 15000);
  t.check('a message written in the board lands in the chat as the user and wakes the architect', await ev(`document.querySelectorAll('.db-bubble').length`) > before && (await ev(`[...document.querySelectorAll('.db-group.r-user .db-bubble')].map(b => b.textContent).join('|')`)).includes('One more thing'));

  // pause / resume
  const pausing = await ev(`(() => { const b = document.querySelector('.db-pause'); b.click(); return { busy: b.getAttribute('aria-busy'), disabled: b.disabled, spin: !!b.querySelector('.spin') }; })()`);
  t.check('pause shows a spinner and cannot be pressed twice until the server answers', pausing.busy === 'true' && pausing.disabled && pausing.spin, JSON.stringify(pausing));
  await page.waitFor(`document.querySelector('.db-head').classList.contains('is-paused')`, 10000);
  t.check('pause shows "resume" and marks the duo paused', await ev(`document.querySelector('.db-pause').getAttribute('aria-label') === 'המשך עבודה' && document.querySelector('.db-head').classList.contains('is-paused')`));
  await ev(`document.querySelector('.db-pause').click()`);
  await page.waitFor(`document.querySelector('.db-pause').getAttribute('aria-label') === 'השהיית הזוג'`, 10000);
  t.check('resume goes back', await ev(`document.querySelector('.db-pause').getAttribute('aria-label') === 'השהיית הזוג'`));

  // side menu list + switching views
  await ev(`document.querySelector('#sideBtn').click()`);
  await page.waitFor(`document.querySelectorAll('.duo-item').length === 1`, 15000);
  t.check('the side menu lists the duo', await ev(`document.querySelectorAll('.duo-item').length`) === 1);
  await ev(`document.querySelector('.gtab').click()`);
  await page.waitFor(`document.querySelector('#duoView').hidden === true`, 8000);
  t.check('switching to the grid hides the duo screen', await ev(`document.querySelector('#duoView').hidden === true && document.querySelector('#stage').hidden === false`));
  await ev(`document.querySelector('.duo-item').click()`);
  await page.waitFor(`document.querySelector('#duoView').hidden === false`, 8000);
  t.check('clicking the duo in the side menu opens the duo screen', await ev(`document.querySelector('#duoView').hidden === false`));
  t.check('the pair tab in the one tab row carries the pair icon (told apart from grid tabs at a glance), its dot and the progress label', await ev(`(() => { const t = document.querySelector('.duo-tab[data-id]'); return !!t && !!t.querySelector('.tab-ic svg') && !!t.querySelector('.dot') && !!t.querySelector('.pr') && !document.querySelector('#viewDuoBtn'); })()`));

  // reload: everything comes back
  await page.reload();
  await page.waitFor(`document.querySelector('#duoView').hidden === false && !!document.querySelector('.db-chat') && document.querySelectorAll('.duo-slot .pane[data-duo]').length === 2`, 30000);
  t.check('after a reload the duo screen is still open with the board', await ev(`document.querySelector('#duoView').hidden === false && !!document.querySelector('.db-chat')`));
  t.check('after a reload both terminals are back in their columns', await ev(`document.querySelectorAll('.duo-slot .pane[data-duo]').length`) === 2);
  t.check('a draft survives updates (compose box keeps its text)', await (async () => { await ev(`(() => { const x = document.querySelector('.db-compose textarea'); x.value = 'draft text'; x.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(2500); return (await ev(`document.querySelector('.db-compose textarea').value`)) === 'draft text'; })());

  t.check('no JavaScript errors in the page', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  if (failedAny) {
    // מצב הלוח והקבצים בזמן הכשל, כדי שכשל נדיר יוסבר ולא יהיה רק "נכשל"
    const rd = (n) => { try { return fs.readFileSync(path.join(project, '.duo', n), 'utf8').slice(-600); } catch { return '(אין)'; } };
    console.log('--- duo diagnostics: chips', JSON.stringify(await ev(`[...document.querySelectorAll('.db-agent')].map((c) => c.textContent)`)));
    console.log('--- progress', JSON.stringify(await ev(`(document.querySelector('.db-progress-text') || {}).textContent`)));
    console.log('--- TASKS.md tail:');
    console.log(rd('TASKS.md'));
    console.log('--- CHAT.md tail:');
    console.log(rd('CHAT.md'));
    try { console.log('--- server.log tail:'); console.log(fs.readFileSync(path.join(APP, 'server.log'), 'utf8').split(String.fromCharCode(10)).slice(-25).join(String.fromCharCode(10))); } catch { /* אין לוג */ }
  }
  page.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
