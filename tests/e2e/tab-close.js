'use strict';
// @slow
// T72: EVERY tab can be closed (real mouse): grid tabs (also the last one, which empties and stays as an untouched "ראשי"), pair tabs (quiet two-step inside the tab:
// the first click arms "לסגור?", the second confirms, it disarms after 3 s), and a middle click closes like in Chrome.
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('close on every tab');
  const project = path.join(TMP, 'tab-close-project');
  fs.mkdirSync(project, { recursive: true });
  const srv = await startServer({ stateFile: path.join(TMP, 'tab-close-state.json'), binDir: path.join(FIXTURES, 'bin-duo') });
  const keeper = await connect(srv.port);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1400, height: 800 });
  const { ev } = page;
  await page.appReady(0);
  const mouse = async (sel, button = 'left') => {
    const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) throw new Error('no element ' + sel);
    await page.mouse('mouseMoved', r.x, r.y);
    if (button === 'middle') await ev(`window.__aux = 0; if (!window.__auxOn) { window.__auxOn = 1; document.addEventListener('auxclick', () => window.__aux++, true); } 1`);
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button, buttons: button === 'left' ? 1 : 4, clickCount: 1 });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button, buttons: 0, clickCount: 1 });
    // כרום headless לא תמיד מסנתז auxclick מלחיצת גלגלת ב-CDP: אם לא הגיע, שולחים את האירוע עצמו
    if (button === 'middle' && !(await ev('window.__aux > 0'))) await ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
    await sleep(250);
  };
  const tabs = () => ev(`[...document.querySelectorAll('#duoTabs .gtab, #duoTabs .duo-tab[data-id]')].map((e) => ({ kind: e.classList.contains('gtab') ? 'grid' : 'pair', name: e.querySelector('.nm').textContent, n: (e.querySelector('.pr') || {}).textContent || '', x: !!e.querySelector('.x'), armed: !!e.querySelector('.x.armed'), xText: (e.querySelector('.x') || {}).textContent || '' }))`);
  const panes = () => ev('document.querySelectorAll(".pane:not([data-duo])").length');

  /* ---------- הלשונית היחידה והריקה: אין מה לסגור ---------- */
  let r = await tabs();
  t.check('an empty single tab has nothing to close: no X', r.length === 1 && r[0].x === false, JSON.stringify(r));
  /* ---------- הלשונית האחרונה עם טרמינל: X שמרוקן אותה ---------- */
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps1' });
  await page.appReady(1);
  await poll(async () => (await tabs())[0].n === '1', 10000, 100);
  r = await tabs();
  t.check('the single tab with a terminal has an X', r.length === 1 && r[0].x === true, JSON.stringify(r));
  t.check('its tooltip says it empties the tab and that the conversations stay in the history', /ריקון הלשונית/.test(await ev(`document.querySelector('.gtab .x').title`)) && /היסטוריה/.test(await ev(`document.querySelector('.gtab .x').title`)));
  await mouse('.gtab .x');
  t.check('closing the LAST tab closes its terminal and the tab stays, empty, as an untouched "ראשי"', !!(await poll(async () => { const x = await tabs(); return (await panes()) === 0 && x.length === 1 && x[0].name === 'ראשי' && x[0].n === ''; }, 15000, 150)), JSON.stringify(await tabs()));
  t.check('...and the start screen is shown again', await ev(`!document.querySelector('#empty').hidden`));

  /* ---------- שתי לשוניות: X בכל אחת, גם בלא פעילה ---------- */
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps2' });
  await page.appReady(1);
  await mouse('.duo-tab-new');
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps3' });
  await poll(async () => { const x = await tabs(); return x.length === 2 && x[1].n === '1'; }, 15000, 150);
  r = await tabs();
  t.check('two grid tabs: both have an X', r.length === 2 && r.every((x) => x.x), JSON.stringify(r));
  await mouse('.gtab:nth-child(1) .x'); // the inactive first tab
  t.check('the X of the NON-active tab closes it and its terminal at once', !!(await poll(async () => { const x = await tabs(); return x.length === 1 && (await panes()) === 1; }, 15000, 150)), JSON.stringify(await tabs()));
  await mouse('.gtab', 'middle');
  t.check('a middle click on a tab closes it like Chrome (last tab: it empties)', !!(await poll(async () => { const x = await tabs(); return x.length === 1 && x[0].n === '' && (await panes()) === 0; }, 15000, 150)), JSON.stringify(await tabs()));

  /* ---------- לשונית זוג: שני צעדים בתוך הלשונית ---------- */
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'x1' });
  await poll(() => ev(`!!document.querySelector('.duo-tab[data-id] .x')`), 30000, 150);
  r = await tabs();
  const pair = r.find((x) => x.kind === 'pair');
  t.check('a pair tab has an X too', !!pair && pair.x === true && pair.xText === '×', JSON.stringify(r));
  await mouse('.duo-tab[data-id] .x');
  r = await tabs();
  t.check('the first click only ARMS it: the X becomes "לסגור?" inside the tab and the pair is still there', r.some((x) => x.kind === 'pair' && x.armed && x.xText === 'לסגור?'), JSON.stringify(r));
  await sleep(3600);
  r = await tabs();
  t.check('after 3 seconds it disarms by itself (nothing was closed)', r.some((x) => x.kind === 'pair' && !x.armed && x.xText === '×'), JSON.stringify(r));
  await mouse('.duo-tab[data-id]', 'middle');
  t.check('a middle click on a pair tab also only arms it (the two-step still applies)', (await tabs()).some((x) => x.kind === 'pair' && x.armed));
  await mouse('.duo-tab[data-id] .x');
  t.check('the second click confirms: the pair and its tab are gone', !!(await poll(async () => (await tabs()).every((x) => x.kind === 'grid'), 20000, 200)), JSON.stringify(await tabs()));
  t.check('...and the server forgot the pair (no pair left in a fresh connection)', await (async () => { const c = await connect(srv.port); await poll(() => c.messages.find((m) => m.t === 'list'), 8000, 100); const l = c.messages.find((m) => m.t === 'list'); c.close(); return !(l.duos || []).length; })());
  await sleep(300);
  await ev(`document.documentElement.dataset.style = 'paper'; true`);
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps4' });
  await poll(async () => (await tabs())[0].n === '1', 10000, 100);
  await sleep(4500); // שההודעה הקצרה תיעלם לפני הצילום
  keeper.send({ t: 'create', kind: 'powershell', cwd: process.env.USERPROFILE, name: 'ps5' });
  await poll(async () => (await tabs())[0].n === '2', 10000, 100);
  await page.mouse('mouseMoved', 1250, 70);
  const shots = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.writeFileSync(path.join(shots, 'T72-tab-x.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
