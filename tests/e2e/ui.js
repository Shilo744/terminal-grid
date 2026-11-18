'use strict';
// Real headless Chrome against a throw-away server: top bar, side menu, opening conversations, geometry, reload.
const path = require('path');
const { FIXTURES, TMP, sleep, checker, startServer, openPage, seedHistory } = require('../lib/harness');

(async () => {
  const t = checker('UI (side menu, panes, geometry)');
  seedHistory(); // שיחות שמורות מדומות בבית הזמני (לא ההיסטוריה האמיתית של המשתמש)
  const srv = await startServer({ stateFile: path.join(TMP, 'ui-state.json'), binDir: path.join(FIXTURES, 'bin-args') });
  const page = await openPage(`http://127.0.0.1:${srv.port}/`);
  const { ev } = page;
  await page.appReady(0);

  t.check('side-menu button exists, quit button is gone', await ev(`!!document.querySelector('#sideBtn') && !document.querySelector('#quitBtn') && !document.querySelector('#quitDlg')`));
  const where = await ev(`(() => { const r = document.querySelector('#sideBtn').getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), top: Math.round(r.top) }; })()`);
  t.check('side-menu button is at the top RIGHT corner', where.right < 40 && where.top < 20, JSON.stringify(where));
  t.check('side menu starts closed', await ev(`document.querySelector('#side').hidden === true`));

  await ev(`document.querySelector('#sideBtn').click()`);
  await page.waitFor(`document.querySelectorAll('.ses').length > 0`, 30000);
  const info = await ev(`(() => ({ groups: document.querySelectorAll('.grp').length, sessions: document.querySelectorAll('.ses').length,
    sideRight: Math.round(innerWidth - document.querySelector('#side').getBoundingClientRect().right), stageRight: Math.round(innerWidth - document.querySelector('#stage').getBoundingClientRect().right) }))()`);
  t.check('side menu lists project folders with conversations', info.groups > 0 && info.sessions > 0, `${info.groups} folders, ${info.sessions} rows`);
  t.check('side menu docked on the right, grid pushed aside', info.sideRight < 20 && info.stageRight > 300, `side@${info.sideRight} stage@${info.stageRight}`);

  await page.waitFor(`document.querySelector('#side').dataset.liveReady === 'true'`, 40000); // "running outside" check must be ready before a click opens anything
  const before = await ev(`document.querySelectorAll('.pane').length`);
  // any saved conversation that is not running anywhere: the top folders may hold only live agents (other windows on this machine), so expand a group if needed
  const picked = await ev(`(() => { const g = [...document.querySelectorAll('.grp:not(.missing)')].find((x) => x.querySelector('.ses:not(.live):not(.open)')); if (!g) return null; if (g.classList.contains('collapsed')) g.querySelector('.grp-head').click(); const b = document.querySelector('.grp:not(.missing):not(.collapsed) .ses:not(.live):not(.open)'); if (!b) return null; const x = b.querySelector('.ses-title').textContent; b.click(); return x; })()`);
  await page.waitFor(`document.querySelectorAll('.pane').length === ${before + 1}`, 20000);
  const after = await ev(`document.querySelectorAll('.pane').length`);
  t.check('clicking a conversation opens a terminal for it', !!picked && after === before + 1, `"${picked}" panes ${before}->${after}`);
  t.check('the opened conversation is marked open', await page.waitFor(`[...document.querySelectorAll('.ses.open .ses-title')].some((e) => e.textContent === ${JSON.stringify(picked)})`, 15000));
  await ev(`document.querySelector('.ses.open').click()`); await sleep(800);
  t.check('clicking an open conversation does not open a duplicate', await ev(`document.querySelectorAll('.pane').length`) === after);
  await ev(`document.querySelector('.grp:not(.missing) .grp-add').click()`);
  await page.waitFor(`document.querySelectorAll('.pane').length === ${after + 1}`, 20000);
  t.check('"+" next to a folder opens a new conversation', await ev(`document.querySelectorAll('.pane').length`) === after + 1);

  const geo = () => ev(`(() => { const s = document.querySelector('#stage').getBoundingClientRect(); const ps = [...document.querySelectorAll('.pane')].map(p => p.getBoundingClientRect());
    return { sb: Math.round(s.bottom), sl: Math.round(s.left), sr: Math.round(s.right), maxB: Math.round(Math.max(...ps.map(r => r.bottom))), minL: Math.round(Math.min(...ps.map(r => r.left))), maxR: Math.round(Math.max(...ps.map(r => r.right))) }; })()`);
  const fills = (g) => Math.abs(g.maxB - g.sb) <= 3 && Math.abs(g.maxR - g.sr) <= 3 && Math.abs(g.minL - g.sl) <= 3;
  // הפריסה (ResizeObserver -> requestAnimationFrame) מתעדכנת רגע אחרי שינוי הגודל: ממתינים עד שהיא באמת מילאה את האזור
  const settled = async () => { for (let i = 0; i < 80; i++) { const g = await geo(); if (fills(g)) return g; await sleep(100); } return geo(); };
  t.check('menu open: panes fill the stage', fills(await settled()));
  await page.resize(1300, 700);
  await page.waitFor(`(() => { const s = document.querySelector('#stage').getBoundingClientRect(); return Math.round(s.right) <= 1300; })()`);
  const g2 = await settled(); t.check('after window resize: panes still fill the stage', fills(g2), JSON.stringify(g2));
  await ev(`document.querySelector('#sideBtn').click()`);
  await page.waitFor(`document.querySelector('#side').hidden === true`);
  await page.waitFor(`Math.round(document.querySelector('#stage').getBoundingClientRect().right) > ${g2.sr + 300}`);
  const g3 = await settled(); t.check('menu closed: panes grow to the full width', fills(g3) && g3.sr > g2.sr + 300, JSON.stringify(g3));
  await ev(`document.querySelector('#sideBtn').click()`);
  await page.waitFor(`document.querySelector('#side').hidden === false`);

  await ev(`(() => { const q = document.querySelector('#sideQ'); q.value = 'question 1-1'; q.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  t.check('search filters the list', await page.waitFor(`document.querySelectorAll('.ses').length < ${info.sessions}`));
  await ev(`(() => { const q = document.querySelector('#sideQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  const names = await ev(`[...document.querySelectorAll('.pane .name')].map(e => e.textContent)`);
  await page.reload();
  await page.appReady(names.length);
  await page.waitFor(`document.querySelector('#side').hidden === false`);
  t.check('after reload the same terminals are there', JSON.stringify(names) === JSON.stringify(await ev(`[...document.querySelectorAll('.pane .name')].map(e => e.textContent)`)));
  t.check('after reload the side menu is still open', await ev(`document.querySelector('#side').hidden === false`));

  page.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
