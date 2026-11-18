'use strict';
// @slow
// T60: grid tabs. Two working sets of terminals, switching, moving a terminal by drag and by menu, attention across tabs, rename, close,
// reload, shortcuts, and a row with 12 tabs. Real mouse and keys through CDP (the HTML5 drag of a pane header is dispatched as drag events: CDP has no native drag).
const path = require('path');
const fs = require('fs');
const { TMP, FIXTURES, sleep, poll, checker, startServer, connect, openPage, seedHistory } = require('../lib/harness');

(async () => {
  const t = checker('grid tabs');
  const work = path.join(TMP, 'gtabs-work');
  const hist = seedHistory(undefined, { projects: 1, perProject: 1 })[0];
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.mkdirSync(shots, { recursive: true });
  const srv = await startServer({ stateFile: path.join(TMP, 'gtabs-state.json'), binDir: path.join(FIXTURES, 'bin-ticker') });
  const keeper = await connect(srv.port);
  for (const n of ['alpha1', 'alpha2', 'beta1', 'beta2']) {
    const d = path.join(work, n); fs.mkdirSync(d, { recursive: true });
    keeper.send({ t: 'create', kind: 'claude', cwd: d, name: n }); await sleep(150);
  }
  await poll(() => keeper.sessions.size === 4, 30000);
  const idOf = (n) => [...keeper.sessions.values()].find((s) => s.name === n).id;
  const [A1, A2, B1, B2] = ['alpha1', 'alpha2', 'beta1', 'beta2'].map(idOf);

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 800 });
  const { ev } = page;
  await page.appReady(4);
  const IN = (code) => ev(`import('/js/state.js').then(async ({ state, tabOf }) => { ${code} })`);
  const tabsInfo = () => ev(`[...document.querySelectorAll('.gtab')].map((e) => ({ id: e.dataset.tab, name: e.querySelector('.nm').textContent, n: e.querySelector('.pr').textContent, status: e.dataset.status, sel: e.getAttribute('aria-selected'), x: !!e.querySelector('.x') }))`);
  const shown = () => ev(`[...document.querySelectorAll('.pane')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.querySelector('.name').textContent).sort().join(',')`);
  const shownIs = async (want) => !!(await poll(async () => (await shown()) === want, 4000, 60));
  const rowHidden = () => ev(`document.querySelector('#duoTabs').hidden`);
  const key = (k, code, vk, modifiers = 0) => page.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }).then(() => page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }));
  const click = async (sel) => { const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); if (!r) throw new Error('no element ' + sel); await page.mouse('mouseMoved', r.x, r.y); await page.mouse('mousePressed', r.x, r.y); await page.mouse('mouseReleased', r.x, r.y); await sleep(150); };
  const rightClick = async (sel) => { const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`); await page.mouse('mouseMoved', r.x, r.y); await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'right', buttons: 2, clickCount: 1 }); await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(250); };
  const menuPick = async (id) => { await click(`.menu [data-id="${id}"]`); await sleep(200); };

  t.check('the row is ALWAYS there: with one tab and no pair it shows that tab (named after its project), its count and the "+", and an X (T72: it empties the tab)', (await rowHidden()) === false && (await tabsInfo()).length === 1 && (await tabsInfo())[0].name === 'alpha1' && (await tabsInfo())[0].n === '4' && (await tabsInfo())[0].x === true && (await ev(`!!document.querySelector('.duo-tab-new')`)) && (await shownIs('alpha1,alpha2,beta1,beta2')));
  const oneTabH = await ev(`Math.round(document.querySelector('#stage').getBoundingClientRect().height)`);
  t.check('the grid still fits under the row (the stage is shorter than the window by the top bar, the row, the gaps and the status bar)', oneTabH > 500 && oneTabH < 800 - 44 - 46, String(oneTabH));

  /* ---------- לשונית חדשה: ה-"+" שבשורה פותח לשונית שמציגה את מסך הפתיחה (T69), ואפשר גם מתפריט "חדש" ---------- */
  await click('.duo-tab-new');
  let tabs = await tabsInfo();
  t.check('a second tab exists, is active, empty, and the row stays', tabs.length === 2 && tabs[1].sel === 'true' && tabs[0].sel === 'false' && tabs[1].n === '' && (await rowHidden()) === false, JSON.stringify(tabs));
  t.check('an empty tab shows the start screen and none of the other terminals', (await ev(`!document.querySelector('#empty').hidden`)) && (await shownIs('')));
  t.check('the first tab is named after the project folder of its first Claude, the new one "לשונית 2"', tabs[0].name === 'alpha1' && tabs[1].name === 'לשונית 2', JSON.stringify(tabs.map((x) => x.name)));

  t.check('the new tab shows the start screen with all three choices: Claude, PowerShell and an agent pair', await ev(`(() => { const e = document.querySelector('#empty'); return !e.hidden && !!e.querySelector('#startClaude') && !!e.querySelector('[data-launch="powershell"]') && !!e.querySelector('#startDuo'); })()`));
  await click('#newMenuBtn');
  t.check('the "new" menu still offers "לשונית רשת חדשה"', await ev(`!!document.querySelector('.menu [data-id="tab"]')`));
  await menuPick('tab');
  t.check('...and it adds a third tab; close it again (the X of the empty tab)', (await tabsInfo()).length === 3);
  await click('.gtab:nth-child(3) .x');
  t.check('closing an empty tab removes just it and leaves a neighbour active', (await tabsInfo()).length === 2 && (await tabsInfo()).filter((x) => x.sel === 'true').length === 1);

  /* ---------- העברה בתפריט הטרמינל ---------- */
  await click('.gtab:nth-child(1)');
  t.check('clicking the first tab shows its four terminals again', (await shownIs('alpha1,alpha2,beta1,beta2')) && (await ev(`document.querySelector('#empty').hidden`)));
  await rightClick(`.pane[data-id="${B1}"] .pane-head`);
  t.check('the terminal menu has "העברה ללשונית…"', await ev(`!!document.querySelector('.menu [data-id="move"]')`));
  await menuPick('move');
  t.check('the sub menu lists the OTHER tabs and "לשונית חדשה"', (await ev(`[...document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent.trim().split('\\n')[0]).join('|')`)).startsWith('לשונית 2') && (await ev(`!!document.querySelector('.menu [data-id="to-new"]')`)));
  await click('.menu .menu-item[data-id^="to-t"]');
  tabs = await tabsInfo();
  t.check('beta1 moved to tab 2: it left this tab at once and the counts are 3 and 1', (await shownIs('alpha1,alpha2,beta2')) && tabs[0].n === '3' && tabs[1].n === '1', JSON.stringify(tabs));
  const dragPane = (paneId, tabSel) => ev(`(() => { const head = document.querySelector('.pane[data-id="${paneId}"] .pane-head'); const tab = document.querySelector(${JSON.stringify(tabSel)}); const dt = new DataTransfer(); const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); fire(head, 'dragstart'); fire(tab, 'dragenter'); fire(tab, 'dragover'); const marked = tab.classList.contains('drop-target'); fire(tab, 'drop'); fire(head, 'dragend'); return marked; })()`);
  const marked = await dragPane(B2, '.gtab:nth-child(2)');
  tabs = await tabsInfo();
  t.check('dragging beta2\'s header onto tab 2 highlights it and moves the terminal there', marked === true && (await shownIs('alpha1,alpha2')) && tabs[0].n === '2' && tabs[1].n === '2', JSON.stringify({ marked, tabs }));
  t.check('the moved terminals kept running (no restart): same ids, still alive on the server', keeper.sessions.has(B1) && keeper.sessions.has(B2));
  t.check('tab 2 is now named after its first Claude folder (beta1)', tabs[1].name === 'beta1', JSON.stringify(tabs.map((x) => x.name)));

  /* ---------- מעבר, קיצורים ---------- */
  await click('.gtab:nth-child(2)');
  t.check('switching is instant: only tab 2\'s terminals are shown', (await shownIs('beta1,beta2')));
  await key('1', 'Digit1', 49, 1); // Alt+1
  t.check('Alt+1 focuses terminal 1 OF THE ACTIVE TAB', (await IN('return state.focusId;')) === B1);
  await key('ArrowLeft', 'ArrowLeft', 37, 3); // Ctrl+Alt+Left
  t.check('Ctrl+Alt+Left in the RTL row goes to the next tab on its left... which here wraps to tab 1 (two tabs)', (await tabsInfo())[0].sel === 'true');
  await key('ArrowRight', 'ArrowRight', 39, 3);
  t.check('Ctrl+Alt+Right goes back', (await tabsInfo())[1].sel === 'true');
  await key('1', 'Digit1', 49, 3); // Ctrl+Alt+1
  t.check('Ctrl+Alt+1 jumps to tab 1', (await tabsInfo())[0].sel === 'true' && (await shownIs('alpha1,alpha2')));

  /* ---------- תשומת לב בין לשוניות ---------- */
  await IN(`const p = state.panes.get('${B2}'); p.meta.agentSource = 'hooks'; p.meta.agentState = 'attention'; p.meta.agentSince = Date.now() - 5000; p.lastKey = 0; return true;`);
  t.check('a terminal that needs approval in the INACTIVE tab gives that tab the amber dot', !!(await poll(async () => (await tabsInfo())[1].status === 'warn', 5000, 100)), JSON.stringify(await tabsInfo()));
  t.check('the summary counts it although it is not on screen', await ev(`!!document.querySelector('#summary .stat-wait')`));
  await key('w', 'KeyW', 87, 1); // Alt+W
  t.check('Alt+W switches to its tab and focuses it', !!(await poll(async () => (await tabsInfo())[1].sel === 'true' && (await IN('return state.focusId;')) === B2, 4000, 100)), JSON.stringify(await tabsInfo()));
  await IN(`const p = state.panes.get('${B2}'); p.meta.agentState = 'idle'; p.lastKey = Date.now(); return true;`);

  /* ---------- שינוי שם ---------- */
  const nm = await ev(`(() => { const e = document.querySelector('.gtab:nth-child(2) .nm').getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; })()`);
  await page.mouse('mouseMoved', nm.x, nm.y); await page.mouse('mousePressed', nm.x, nm.y, { clickCount: 2 }); await page.mouse('mouseReleased', nm.x, nm.y, { clickCount: 2 });
  await sleep(250);
  t.check('double click on a tab name opens the inline editor', await ev(`!!document.querySelector('input.rename-input')`));
  await ev(`(() => { const i = document.querySelector('input.rename-input'); i.value = 'פרויקט בטא'; return true; })()`);
  await key('Enter', 'Enter', 13);
  await sleep(300);
  t.check('the new name shows and survives a reload (stored on the server)', (await tabsInfo())[1].name === 'פרויקט בטא');
  await page.reload();
  await page.appReady(4);
  await page.waitFor(`document.querySelectorAll('.gtab').length === 2`, 15000);
  tabs = await tabsInfo();
  t.check('after a reload: two tabs, the names, the counts and the active tab are back', tabs.length === 2 && tabs[1].name === 'פרויקט בטא' && tabs[0].n === '2' && tabs[1].n === '2' && tabs[1].sel === 'true' && (await shownIs('beta1,beta2')), JSON.stringify(tabs));

  /* ---------- תפריט הצד: באיזו לשונית השיחה הפתוחה, והלחיצה עוברת אליה ---------- */
  keeper.send({ t: 'create', kind: 'claude', cwd: hist.cwd, resume: hist.id, name: 'hist' });
  await poll(() => [...keeper.sessions.values()].some((q) => q.name === 'hist'), 15000);
  const H = idOf('hist');
  await page.waitFor(`!!document.querySelector('.pane[data-id="${H}"]')`, 15000);
  const homeTab = await IN(`return tabOf('${H}').id;`);
  await click(`.gtab:not([data-tab="${homeTab}"])`);
  await click('#sideBtn');
  await page.waitFor(`document.querySelector('#side').dataset.liveReady === 'true'`, 40000);
  t.check('the side menu marks the open conversation with its tab name', !!(await poll(() => ev(`(() => { const e = document.querySelector('.ses.open .ses-time'); return !!e && e.textContent.startsWith('פתוחה · '); })()`), 8000, 150)), await ev(`(document.querySelector('.ses.open .ses-time') || {}).textContent`));
  await click('.ses.open');
  t.check('clicking it switches to that tab and focuses the terminal', !!(await poll(async () => (await IN('return state.activeTabId;')) === homeTab && (await IN('return state.focusId;')) === H, 5000, 100)));
  await click('#sideBtn');
  await click(`.pane[data-id="${H}"] [data-act="close"]`);
  await poll(() => !keeper.sessions.has(H), 10000, 150);

  /* ---------- תפריט קליק ימני, סדר הלשוניות בגרירה ובמקלדת ---------- */
  await rightClick('.gtab:nth-child(1)');
  t.check('right-click on a tab: rename / close the tab (with how many terminals close)', (await ev(`[...document.querySelectorAll('.menu .menu-item')].map((b) => b.dataset.id).join(',')`)) === 'rename,close' && /\d/.test(await ev(`document.querySelector('.menu [data-id="close"]').textContent`)));
  await key('Escape', 'Escape', 27);
  const names0 = (await tabsInfo()).map((x) => x.name).join('|');
  const rc = await ev(`[...document.querySelectorAll('.gtab')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
  await page.mouse('mouseMoved', rc[0].x, rc[0].y); await page.mouse('mousePressed', rc[0].x, rc[0].y);
  for (let i = 1; i <= 12; i++) await page.mouse('mouseMoved', rc[0].x + (rc[1].x - rc[0].x) * (i / 12) * 1.1, rc[0].y);
  await page.mouse('mouseReleased', rc[1].x, rc[0].y);
  await sleep(300);
  const names1 = (await tabsInfo()).map((x) => x.name).join('|');
  t.check('dragging the first tab over the second swaps them (RTL aware), and the drag does not switch tabs by accident', names1 === names0.split('|').reverse().join('|') && (await tabsInfo()).filter((x) => x.sel === 'true').length === 1, names0 + ' -> ' + names1);
  const order1 = await IN("return state.tabs.map((x) => x.name || '').join('|');");
  await key('Escape', 'Escape', 27);
  await ev("document.querySelector('.gtab').focus(); true");
  await key('ArrowLeft', 'ArrowLeft', 37, 9); // Alt+Shift+Left: later in the RTL row
  const names2 = (await tabsInfo()).map((x) => x.name).join('|');
  t.check('Alt+Shift+Arrow moves the focused tab one place and keeps the focus on it', names2 === names0 && (await ev("document.activeElement.classList.contains('gtab')")), names1 + ' -> ' + names2);
  t.check('the new order is kept in the model (and sent to the server)', order1 !== (await IN("return state.tabs.map((x) => x.name || '').join('|');")));

  /* ---------- צילומים ---------- */
  await page.resize(1920, 1000);
  await sleep(500);
  fs.writeFileSync(path.join(shots, 'T60-tabs-1920.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await page.resize(1100, 700);
  await sleep(500);
  fs.writeFileSync(path.join(shots, 'T60-tabs-1100.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await page.resize(1400, 800);

  /* ---------- סגירת לשונית ---------- */
  await click('.gtab:nth-child(1)');
  t.check('the X is on every tab when there are two', (await tabsInfo()).every((x) => x.x));
  const x2 = await ev(`document.querySelector('.gtab:nth-child(2) .x').title`);
  t.check('the X tooltip says how many terminals close with it', /2/.test(x2) && /היסטוריה/.test(x2), x2);
  await click('.gtab:nth-child(2) .x');
  tabs = await tabsInfo();
  t.check('closing tab 2 removes the tab at once and closes its two terminals on the server', tabs.length === 1 && !!(await poll(() => keeper.sessions.size === 2 && !keeper.sessions.has(B1) && !keeper.sessions.has(B2), 15000, 200)), JSON.stringify(tabs));
  t.check('the remaining tab keeps an X (T72: closing the last one empties it) and the row stays (T68)', tabs[0].x === true && (await rowHidden()) === false);

  /* ---------- 12 לשוניות ---------- */
  for (let i = 0; i < 11; i++) await IN(`const m = await import('/js/tabs.js'); m.newTab({ activate: false }); return true;`);
  await sleep(300);
  const geo = await ev(`(() => { const row = document.querySelector('#duoTabs').getBoundingClientRect(); const sc = document.querySelector('.tabs-scroll'); const plus = document.querySelector('.duo-tab-new').getBoundingClientRect(); const tabsEls = [...document.querySelectorAll('.gtab')].map((e) => e.getBoundingClientRect().width); return { n: tabsEls.length, minW: Math.min(...tabsEls), scrolls: sc.scrollWidth > sc.clientWidth, docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, plusIn: plus.left >= 0 && plus.right <= innerWidth, rowIn: row.left >= 0 && row.right <= innerWidth, h: row.height }; })()`);
  t.check('12 tabs: they shrink to fit; "+" stays visible; the page does not scroll sideways', geo.n === 12 && !geo.docOverflow && geo.plusIn && geo.rowIn && geo.h < 60 && geo.minW >= 100, JSON.stringify(geo));
  for (let i = 0; i < 20; i++) await IN(`const m = await import('/js/tabs.js'); m.newTab({ activate: false }); return true;`);
  await sleep(300);
  const geo2 = await ev(`(() => { const sc = document.querySelector('.tabs-scroll'); const plus = document.querySelector('.duo-tab-new').getBoundingClientRect(); return { n: document.querySelectorAll('.gtab').length, scrolls: sc.scrollWidth > sc.clientWidth, minW: Math.min(...[...document.querySelectorAll('.gtab')].map((e) => e.getBoundingClientRect().width)), docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, plusIn: plus.left >= 0 && plus.right <= innerWidth }; })()`);
  t.check('32 tabs: past the minimum width the tab strip scrolls inside the row, "+" stays in view, the page does not move', geo2.n === 32 && geo2.scrolls && geo2.minW >= 100 && !geo2.docOverflow && geo2.plusIn, JSON.stringify(geo2));
  await page.resize(1920, 1000);
  await sleep(400);
  fs.writeFileSync(path.join(shots, 'T60-tabs-12.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
