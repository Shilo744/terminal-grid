'use strict';
// @slow
/*
 * הוראה ממתינה כי המשתמש כותב לסוכן (T62): שורה אחת רגועה בכרטיס הסוכן ובכותרת הפאן ("הודעה ממתינה"), בלי התראה ובלי שהסוכן נראה עובד; נעלמת כשההוראה נמסרת.
 * צילום מסך: docs/screens/T62-pending-wake.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('pending wake is shown calmly');
  const project = path.join(TMP, 'duo-pending-ui');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nAll set.\n');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { FAKE_UI: '1', FAKE_NO_STASH: '1', FAKE_LOG: path.join(project, 'fake-log'), TG_TEST_PENDING_SHOW_MS: '300' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'p' });
  const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const latest = () => { for (let i = keeper.messages.length - 1; i >= 0; i--) { const m = keeper.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
  await poll(() => { const d = latest(); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 30000);
  const arch = [...keeper.sessions.values()].find((s) => s.duo && s.duo.role === 'architect');
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 700 });
  await page.appReady(0);
  await page.ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.db-agent[data-role="architect"]')`, 20000);

  keeper.send({ t: 'input', id: arch.id, d: 'half a sentence' });
  await sleep(2300);
  keeper.send({ t: 'duo', op: 'say', duoId: created.duoId, text: 'ping while you write' });
  const view = () => page.ev(`(() => { const c = document.querySelector('.db-agent[data-role="architect"]'); const p = document.querySelector('.duo-col[data-role="architect"] .pane .pstatus');
    return { card: c.querySelector('.stw').textContent, pending: c.dataset.pending, title: c.title, pill: p && !p.hidden ? p.textContent : '', pillTitle: p ? p.title : '', state: c.dataset.state }; })()`);
  const v = await poll(async () => { const x = await view(); return x.pending === 'true' ? x : null; }, 15000, 100);
  t.check('the agent card says "הודעה ממתינה" (idle underneath), with the explanation as its tooltip', !!v && v.card === 'הודעה ממתינה' && v.state === 'idle' && /תישלח כשתסיים לכתוב/.test(v.title), JSON.stringify(v));
  // תווית הכותרת מתעדכנת בבדיקת המצב של הלקוח (כל 400ms), אחרי שהכרטיס כבר מעודכן: ממתינים לה במקום לדגום פעם אחת
  const vp = (await poll(async () => { const x = await view(); return x.pill === 'הודעה ממתינה' ? x : null; }, 5000, 100)) || v;
  t.check('the pane header shows the same quiet label with the explanation', !!vp && vp.pill === 'הודעה ממתינה' && /תישלח כשתסיים לכתוב/.test(vp.pillTitle), JSON.stringify(vp));
  t.check('no alert and no red/amber state for it (the pair dot stays idle)', (await page.ev(`document.querySelector('.duo-tab[data-id]').dataset.status`)) === 'idle' && latest().alerts.length === 0, JSON.stringify(latest().alerts));
  await sleep(300);
  const out = path.join(__dirname, '..', '..', 'docs', 'screens', 'T62-pending-wake.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));

  keeper.send({ t: 'input', id: arch.id, d: '\x03' }); // המשתמש מנקה את התיבה
  const gone = await poll(async () => { const x = await view(); return x.pending !== 'true' && x.card !== 'הודעה ממתינה' ? x : null; }, 15000, 100);
  t.check('when the box is cleared the wake is delivered and the label goes away', !!gone, JSON.stringify(gone));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
