'use strict';
// @slow
// T69: ONE row of Chrome-like tabs for grids and pairs. No "רשת | זוגות" switch; "+" opens a new tab that shows the start screen (Claude, PowerShell, agent pair);
// what you choose is created IN that tab; an untouched new tab closes without leaving anything; reload keeps everything.
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('one tab row for grids and pairs');
  const project = path.join(TMP, 'one-tab-project');
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const srv = await startServer({ stateFile: path.join(TMP, 'one-tab-state.json'), binDir: path.join(FIXTURES, 'bin-duo') });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'settings:set', patch: { ui: { cwd: project } } });
  for (let i = 0; i < 50 && !(keeper.settings && keeper.settings.ui.cwd === project); i++) await sleep(100);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 800 });
  const { ev } = page;
  await page.reload();
  await page.appReady(0);
  const click = async (sel) => { const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); if (!r) throw new Error('no element ' + sel); await page.mouse('mouseMoved', r.x, r.y); await page.mouse('mousePressed', r.x, r.y); await page.mouse('mouseReleased', r.x, r.y); await sleep(200); };
  const rows = () => ev(`[...document.querySelectorAll('#duoTabs .gtab, #duoTabs .duo-tab[data-id]')].map((e) => ({ kind: e.classList.contains('gtab') ? 'grid' : 'pair', name: e.querySelector('.nm').textContent, n: (e.querySelector('.pr') || {}).textContent || '', sel: e.getAttribute('aria-selected'), icon: !!e.querySelector('.tab-ic svg') }))`);
  const serverTabs = async () => { const c = await connect(srv.port); await poll(() => c.view, 8000); const n = c.view.tabs.length; c.close(); return n; };
  const shot = async (name) => fs.writeFileSync(path.join(shots, name), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  t.check('there is no "רשת | זוגות" switch in the top bar any more, and the old "+ זוג חדש" button is gone', await ev(`!document.querySelector('.viewseg') && !document.querySelector('#viewGridBtn') && !document.querySelector('#viewDuoBtn') && ![...document.querySelectorAll('.duo-tab-new')].some((b) => /זוג/.test(b.textContent))`));
  t.check('one tab ("ראשי") and the "+"', (await rows()).length === 1 && (await rows())[0].name === 'ראשי');

  /* ---------- "+" פותח לשונית חדשה עם מסך הפתיחה ---------- */
  await click('.duo-tab-new');
  let r = await rows();
  t.check('"+" opens a new tab at once and it is the active one', r.length === 2 && r[1].sel === 'true');
  t.check('the new tab shows the start screen with Claude, PowerShell and an agent pair', await ev(`(() => { const e = document.querySelector('#empty'); return !e.hidden && e.getClientRects().length > 0 && !!e.querySelector('#startClaude') && !!e.querySelector('[data-launch="powershell"]') && !!e.querySelector('#startDuo'); })()`));
  await sleep(500);
  await shot('T69-new-tab-ide.png');
  await click('.gtab:nth-child(2) .x');
  t.check('an untouched new tab closes with its X', (await rows()).length === 1);
  await sleep(600);
  t.check('and nothing is left behind on the server (one tab)', (await serverTabs()) === 1);

  /* ---------- PowerShell בלשונית חדשה ---------- */
  await click('.duo-tab-new');
  await click('#empty [data-launch="powershell"]');
  t.check('choosing PowerShell creates the terminal IN the new tab (count 1), the start screen is gone', !!(await poll(async () => { const x = await rows(); return x.length === 2 && x[1].n === '1' && x[1].sel === 'true'; }, 15000, 150)) && (await ev(`document.querySelector('#empty').hidden`)));
  t.check('the first tab stays empty and untouched', (await rows())[0].n === '');

  /* ---------- Claude בלשונית חדשה ---------- */
  await click('.duo-tab-new');
  await click('#startClaude');
  t.check('choosing Claude creates it in its own new tab', !!(await poll(async () => { const x = await rows(); return x.length === 3 && x[2].n === '1' && x[2].sel === 'true'; }, 20000, 150)), JSON.stringify(await rows()));

  /* ---------- זוג סוכנים בלשונית חדשה ---------- */
  await click('.duo-tab-new');
  await click('#startDuo');
  t.check('"זוג סוכנים" opens the creation dialog', await page.waitFor(`document.querySelector('#duoDlg').open === true`, 5000));
  await ev(`document.querySelector('#duoGoal').value = 'Build the thing'`);
  await ev(`document.querySelector('#duoDlg .dlg-actions .btn.primary').click()`);
  t.check('the pair gets its own tab (with the pair icon) and the screen shows the pair', await page.waitFor(`document.querySelector('#duoView').hidden === false && document.querySelectorAll('.duo-slot .pane[data-duo]').length === 2 && !!document.querySelector('.duo-tab[data-id] .tab-ic svg')`, 40000));
  r = await rows();
  t.check('the empty new tab it was started from disappeared: three grid tabs and one pair tab', r.filter((x) => x.kind === 'grid').length === 3 && r.filter((x) => x.kind === 'pair').length === 1 && r.find((x) => x.kind === 'pair').sel === 'true' && r.filter((x) => x.kind === 'grid').every((x) => x.sel === 'false'), JSON.stringify(r));
  t.check('a grid tab and a pair tab are told apart: the pair tab has an icon, the grid tabs do not', r.find((x) => x.kind === 'pair').icon === true && r.filter((x) => x.kind === 'grid').every((x) => x.icon === false));

  /* ---------- מראה Chrome ---------- */
  const look = await ev(`(() => { const row = document.querySelector('#duoTabs').getBoundingClientRect(); const cs = (e) => getComputedStyle(e); const pair = document.querySelector('.duo-tab[data-id]'); const grid = document.querySelector('.gtab'); const plus = document.querySelector('.duo-tab-new');
    return { rowH: Math.round(row.height), pairR: cs(pair).borderTopLeftRadius + '/' + cs(pair).borderBottomLeftRadius, pairBg: cs(pair).backgroundColor, bodyBg: cs(document.body).backgroundColor, gridBg: cs(grid).backgroundColor, plusW: Math.round(plus.getBoundingClientRect().width) }; })()`);
  t.check('Chrome-like: slightly rounded (4px, T73) top corners only, the active tab has the page colour (joined to the content), the row is 46 px (44 px tabs, T71)', look.pairR === '4px/0px' && look.pairBg === look.bodyBg && look.gridBg !== look.bodyBg && look.rowH >= 44 && look.rowH <= 50, JSON.stringify(look));

  /* ---------- צילומי הסגנונות ---------- */
  for (const st of ['ide', 'classic', 'paper']) {
    await ev(`document.documentElement.dataset.style = '${st}'; true`);
    await sleep(500);
    const same = await ev(`(() => { const t = document.querySelector('.duo-tab[data-id][aria-selected="true"]'); return t ? [getComputedStyle(t).backgroundColor, getComputedStyle(document.body).backgroundColor] : null; })()`);
    t.check(`${st}: the selected tab has the page colour (joined to the content)`, !!same && same[0] === same[1], JSON.stringify(same));
    await shot(`T69-tabs-${st}.png`);
  }
  await ev(`document.documentElement.dataset.style = 'ide'; true`);

  /* ---------- רענון: הכול נשאר ---------- */
  await page.reload();
  await page.appReady(1);
  await page.waitFor(`document.querySelectorAll('#duoTabs .gtab').length === 3 && !!document.querySelector('#duoTabs .duo-tab[data-id]')`, 20000);
  r = await rows();
  t.check('after a reload: the three grid tabs and the pair tab are back, the pair tab is the selected one', r.filter((x) => x.kind === 'grid').length === 3 && r.some((x) => x.kind === 'pair' && x.sel === 'true'), JSON.stringify(r));

  /* ---------- 12 לשוניות ובמסך צר ---------- */
  await ev(`document.querySelector('.gtab').click(); true`);
  for (let i = 0; i < 9; i++) await ev(`import('/js/tabs.js').then((m) => { m.newTab({ activate: false }); return true; })`);
  await page.resize(1100, 700);
  await sleep(500);
  const geo = await ev(`(() => { const row = document.querySelector('#duoTabs'); const plus = document.querySelector('.duo-tab-new').getBoundingClientRect(); return { n: document.querySelectorAll('#duoTabs .gtab, #duoTabs .duo-tab[data-id]').length, docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, plusIn: plus.left >= 0 && plus.right <= innerWidth, h: Math.round(row.getBoundingClientRect().height) }; })()`);
  t.check('13 tabs at 1100 px: the strip scrolls inside the row (no scrollbar, the wheel scrolls it), "+" stays in view, no page overflow, same row height', geo.n === 13 && !geo.docOverflow && geo.plusIn && geo.h >= 44 && geo.h <= 50, JSON.stringify(geo));
  const wheel = await ev(`(() => { const s = document.querySelector('.tabs-scroll'); const before = s.scrollLeft; const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }); s.dispatchEvent(e); return { moved: s.scrollLeft !== before, prevented: e.defaultPrevented, overflow: s.scrollWidth > s.clientWidth }; })()`);
  t.check('a plain (vertical) wheel over the row scrolls the strip sideways when it overflows', wheel.overflow && wheel.prevented && wheel.moved, JSON.stringify(wheel));
  await shot('T69-tabs-13-1100.png');

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
