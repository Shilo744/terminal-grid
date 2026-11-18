'use strict';
// @slow
/*
 * סוכן בזוג שנסגר אפשר להפעיל מחדש (T51), בדפדפן אמיתי מול סוכנים מדומים:
 *  - כרטיס הסוכן בלוח: נקודה אדומה, "נסגר", וכפתור "הפעלה מחדש" במקום "העיר" (רק אצל הסוכן שנסגר);
 *  - הטרמינל של הסוכן בעמודה שלו מציג את שכבת "התהליך הסתיים" עם "הפעלה מחדש" (גם בטרמינל של זוג);
 *  - לחיצה אמיתית: הכפתור מקבל ספינר תוך 100ms (כלל המשוב המיידי), ואז הסוכן חוזר: הכרטיס לא אדום, השכבה נעלמת, נקודת הלשונית חוזרת למצב רגיל.
 * צילום מסך: docs/screens/T51-agent-restart.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

// מתקין בדף מתעד: כמה מילישניות עברו בין אירוע ה-click על הכפתור לבין הופעת aria-busy עליו (null אם לא הופיע)
const watchBusy = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); window.__busyMs = null; let t0 = 0; b.addEventListener('click', () => { t0 = performance.now(); }, true); new MutationObserver(() => { if (window.__busyMs === null && b.getAttribute('aria-busy') === 'true') window.__busyMs = performance.now() - t0; }).observe(b, { attributes: true }); return true; })()`;

(async () => {
  const t = checker('restart an exited pair agent (UI)');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { TG_STARTUP_QUIET_MS: '600' } });
  const keeper = await connect(srv.port);
  const project = path.join(TMP, 'duo-agent-restart-ui');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T1 — first thing\n  do it\n- [ ] T2 — second thing\n  do it too\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nThe plan is in TASKS.md.\n');
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'u1' });
  const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const duoId = created.duoId;
  keeper.send({ t: 'duo', op: 'pause', duoId });
  await poll(() => [...keeper.sessions.values()].filter((s) => s.duo).length === 2, 30000);
  const workerSession = () => [...keeper.sessions.values()].find((s) => s.duo && s.duo.role === 'worker');
  const latest = () => { for (let i = keeper.messages.length - 1; i >= 0; i--) { const m = keeper.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
  await poll(() => { const d = latest(); return d && d.agents.worker.state === 'idle' && d.agents.architect.state === 'idle'; }, 30000);

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 760 });
  const { ev } = page;
  await page.appReady(0);
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`document.querySelectorAll('.duo-tab[data-id]').length === 1 && !!document.querySelector('.db-agent[data-role="worker"]')`, 20000);

  const card = (role) => ev(`(() => { const c = document.querySelector('.db-agent[data-role="${role}"]'); const r = c.querySelector('.chip-restart'), w = c.querySelector('.chip-wake'); const vis = (e) => e.getClientRects().length > 0; return { state: c.dataset.state, restartVisible: vis(r), wakeVisible: vis(w), busy: r.getAttribute('aria-busy') }; })()`);
  const overlay = () => ev(`(() => { const p = document.querySelector('.duo-col[data-role="worker"] .pane'); if (!p) return null; const o = p.querySelector('.pane-exit'), b = o.querySelector('[data-act="restart"]'); return { shown: !o.hidden, code: o.querySelector('.pe-code').textContent, restartVisible: b.getClientRects().length > 0, sid: p.dataset.id }; })()`);
  const tabDot = () => ev(`(() => { const t = document.querySelector('.duo-tab[data-id]'); return { status: t.dataset.status, title: t.querySelector('.dot').title }; })()`);

  await poll(async () => (await card('worker')).state === 'idle', 15000, 100);
  let c1 = await card('worker');
  t.check('a healthy agent card: "העיר" is there, no restart button', c1.wakeVisible === true, JSON.stringify(c1));
  t.check('...and the restart button is not shown', c1.restartVisible === false, JSON.stringify(c1));
  const o0 = await overlay();
  t.check('the worker terminal has no exit overlay while alive', !!o0 && o0.shown === false, JSON.stringify(o0));

  /* ---------- הסוכן נופל: Claude יוצא ואחר כך גם PowerShell ---------- */
  async function crashWorker() {
    const s = workerSession();
    keeper.send({ t: 'input', id: s.id, d: '\x1b[200~TG-FAKE-EXIT\x1b[201~\r' });
    await poll(() => /FAKE-ARGS[\s\S]*PS [A-Z]:/.test(keeper.out.get(s.id) || ''), 10000, 100);
    keeper.send({ t: 'input', id: s.id, d: 'exit\r' });
    await poll(async () => (await card('worker')).state === 'exited', 15000, 100);
    return s;
  }
  const crashed = await crashWorker();
  c1 = await card('worker');
  const ca = await card('architect');
  t.check('the exited worker card: "נסגר", the restart button is shown and "העיר" is hidden', c1.state === 'exited' && c1.restartVisible && !c1.wakeVisible, JSON.stringify(c1));
  t.check('the architect card is untouched (no restart button)', ca.state === 'idle' && !ca.restartVisible, JSON.stringify(ca));
  const o1 = await poll(async () => { const o = await overlay(); return o && o.shown ? o : null; }, 8000, 100);
  t.check('the worker terminal shows the exit overlay with a visible "הפעלה מחדש" and the exit code', !!o1 && o1.restartVisible && /exit code/.test(o1.code), JSON.stringify(o1));
  const td = await tabDot();
  t.check('the pair tab dot is the red problem state with the reason', td.status === 'danger' && /בעיה: העובד נסגר/.test(td.title), JSON.stringify(td));
  await sleep(300);
  const out = path.join(__dirname, '..', '..', 'docs', 'screens', 'T51-agent-restart.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));

  // כפתור "⋯" בכותרת הטרמינל של זוג (עד T51 הלחיצות נתפסו רק באזור הרשת ולא הגיבו כאן): התפריט נפתח וכולל "הפעלה מחדש" לסוכן שנסגר
  await ev(`document.querySelector('.duo-col[data-role="worker"] [data-act="menu"]').click(); true`);
  const menuItems = await poll(() => ev(`[...document.querySelectorAll('.menu .menu-item')].map((b) => b.dataset.id).join(',')`), 3000, 100);
  t.check('the "⋯" button of a pair terminal opens its menu, with "הפעלה מחדש" for the exited agent', !!menuItems && menuItems.split(',').includes('restart'), String(menuItems));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await sleep(200);

  /* ---------- הפעלה מחדש מהשכבה שבטרמינל ---------- */
  const overlayBtn = '.duo-col[data-role="worker"] .pane-exit [data-act="restart"]';
  await ev(watchBusy(overlayBtn));
  await ev(`document.querySelector('${overlayBtn}').click(); true`);
  const spunMs = await ev('window.__busyMs');
  t.check('instant feedback: the overlay button shows its spinner within 100ms of the click', spunMs !== null && spunMs < 100, String(spunMs));
  const w2 = await poll(() => { const s = workerSession(); return s && s.id !== crashed.id ? s : null; }, 15000, 100);
  t.check('a new worker terminal replaces the dead one', !!w2 && !keeper.sessions.has(crashed.id));
  await poll(async () => { const c = await card('worker'); const o = await overlay(); return c.state === 'idle' && o && !o.shown; }, 20000, 100);
  c1 = await card('worker');
  const o2 = await overlay();
  t.check('the worker is back: card idle, restart button gone, overlay gone', c1.state === 'idle' && !c1.restartVisible && !!o2 && !o2.shown, JSON.stringify({ c1, o2 }));
  t.check('the new terminal is the one in the worker column', !!o2 && o2.sid === w2.id, JSON.stringify(o2));
  t.check('the pair tab dot is back to the quiet paused state (no leftover red)', (await tabDot()).status === 'paused', JSON.stringify(await tabDot()));

  /* ---------- וגם מכפתור הכרטיס, בלחיצת עכבר אמיתית ---------- */
  const crashed2 = await crashWorker();
  const rect = await ev(`(() => { const b = document.querySelector('.db-agent[data-role="worker"] .chip-restart'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.mouse('mouseMoved', rect.x, rect.y);
  await sleep(120);
  const hoverBg = await ev(`getComputedStyle(document.querySelector('.db-agent[data-role="worker"] .chip-restart')).backgroundColor`);
  t.check('hover gives the card button a background', hoverBg !== 'rgba(0, 0, 0, 0)' && hoverBg !== 'transparent', hoverBg);
  await ev(watchBusy('.db-agent[data-role="worker"] .chip-restart'));
  await page.mouse('mousePressed', rect.x, rect.y);
  await page.mouse('mouseReleased', rect.x, rect.y);
  await sleep(50);
  const spun2 = await ev('window.__busyMs');
  t.check('instant feedback: the card button shows its spinner within 100ms of the click', spun2 !== null && spun2 < 100, String(spun2));
  const w3 = await poll(() => { const s = workerSession(); return s && s.id !== crashed2.id ? s : null; }, 15000, 100);
  await poll(async () => (await card('worker')).state === 'idle', 20000, 100);
  c1 = await card('worker');
  t.check('after the card button: a new terminal, the card is idle and the button is gone (and not stuck busy)', !!w3 && c1.state === 'idle' && !c1.restartVisible, JSON.stringify(c1));

  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
