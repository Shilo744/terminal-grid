'use strict';
// @slow
/*
 * התראות הזוג בלוח (T65), בדפדפן אמיתי מול סוכנים מדומים: שום דבר לא נראה על תקלה פנימית שמתאוששת לבד, התראה אחת רגועה (משפט קצר וכפתור שעושה את הדבר) על התמדה,
 * הנקודה של הזוג כנה, "פרטים טכניים" מקופל וזוכר את מצבו, וסוכן שנסגר נותן באנר אדום עם "הפעלה מחדש" שעובד.
 * צילום מסך: docs/screens/T65-alerts-after.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

(async () => {
  const t = checker('pair alerts: calm banner with a button, technical details collapsed');
  const project = path.join(TMP, 'duo-alerts-ui');
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nAll set.\n');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { TG_TEST_SUBMIT_TIMEOUT_MS: '1500', TG_TEST_RETRY_MS: '1500', TG_TEST_DRAFT_CHECK_MS: '200' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'u' });
  const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const latest = () => { for (let i = keeper.messages.length - 1; i >= 0; i--) { const m = keeper.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
  await poll(() => { const d = latest(); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 30000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 760 });
  await page.appReady(0);
  await page.ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.db-agent[data-role="architect"]')`, 20000);
  const ui = () => page.ev(`(() => ({ banners: [...document.querySelectorAll('.db-alerts .db-alert')].map((r) => ({ text: r.querySelector('.msg').textContent, level: r.className, buttons: [...r.querySelectorAll('.db-alert-act')].map((b) => b.textContent), more: !!r.querySelector('.db-alert-more'), ellipsis: getComputedStyle(r.querySelector('.msg')).textOverflow })), alertsHidden: document.querySelector('.db-alerts').hidden,
    dot: document.querySelector('.duo-tab[data-id]').dataset.status, techShown: !document.querySelector('.db-tech').hidden, techOpen: document.querySelector('.db-tech').open, techLines: [...document.querySelectorAll('.db-tech .db-events li span')].map((s) => s.textContent), activity: [...document.querySelectorAll('.db-activity:not(.db-tech) .db-events li span')].map((s) => s.textContent) }))()`);

  fs.writeFileSync(path.join(project, '.duo', 'DEAF'), '1');
  keeper.send({ t: 'duo', op: 'say', duoId: created.duoId, text: 'ping' });
  const first = await poll(async () => { const u = await ui(); return u.techLines.some((l) => /ניסיון 1/.test(l)) ? u : null; }, 20000, 100);
  t.check('a retry in progress shows NOTHING: no banner, a quiet pair dot, nothing about it in the activity list', !!first && first.alertsHidden && first.banners.length === 0 && first.dot !== 'warn' && !first.activity.some((l) => /לא התקבלה/.test(l)), JSON.stringify(first));
  t.check('"פרטים טכניים" holds the line, collapsed by default', !!first && first.techShown && first.techOpen === false, JSON.stringify(first && { s: first.techShown, o: first.techOpen }));
  const banner = await poll(async () => { const u = await ui(); return u.banners.length === 1 ? u : null; }, 40000, 100);
  t.check('on persistence ONE calm banner: a short sentence and one button, nothing truncated, no "less/more" toggle', !!banner && /^הארכיטקט לא מגיב להוראות כבר \d+ דק/.test(banner.banners[0].text) && banner.banners[0].buttons.length === 1 && banner.banners[0].buttons[0] === 'פתיחת הטרמינל של הארכיטקט' && !banner.banners[0].more && banner.banners[0].ellipsis !== 'ellipsis', JSON.stringify(banner));
  t.check('the pair dot is amber now (and only now)', !!banner && banner.dot === 'warn', JSON.stringify(banner && banner.dot));
  await sleep(300);
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  const out = path.join(__dirname, '..', '..', 'docs', 'screens', 'T65-alerts-after.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));

  await page.ev(`document.querySelector('.db-alerts .db-alert-act').click(); true`);
  await sleep(300);
  t.check('the button opens (focuses) the architect terminal', await page.ev(`(() => { const a = document.activeElement; const p = a && a.closest && a.closest('.pane'); return !!p && p.dataset.duo === 'architect'; })()`));
  await page.ev(`document.querySelector('.db-alerts .db-alert-x').click(); true`);
  t.check('X hides this alert', (await ui()).banners.length === 0);

  // פרטים טכניים: פתיחה נשמרת
  await page.ev(`const d = document.querySelector('.db-tech'); d.open = true; d.dispatchEvent(new Event('toggle')); true`);
  await sleep(200);
  await page.reload();
  await page.appReady(0);
  await page.ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.db-tech')`, 20000);
  t.check('the technical details remember that they were opened (after a reload)', (await ui()).techOpen === true);

  // התאוששות: ההתראה נעלמת ולא נשאר דבר
  fs.unlinkSync(path.join(project, '.duo', 'DEAF'));
  const gone = await poll(async () => { const u = await ui(); return u.banners.length === 0 && u.dot !== 'warn' ? u : null; }, 30000, 150);
  t.check('when the agent answers again the banner is gone and the dot is back to normal', !!gone, JSON.stringify(gone));
  await poll(() => latest().agents.architect.state === 'idle', 20000, 100);

  // סוכן שנסגר: באנר אדום עם הפעלה מחדש
  const worker = [...keeper.sessions.values()].find((s) => s.duo && s.duo.role === 'worker');
  keeper.send({ t: 'close', id: worker.id });
  const closed = await poll(async () => { const u = await ui(); return u.banners.some((b) => /העובד נסגר/.test(b.text)) ? u : null; }, 15000, 100);
  t.check('a closed agent gives a red banner with a "restart" button', !!closed && /error/.test(closed.banners[0].level) && closed.banners[0].buttons[0] === 'הפעלה מחדש של העובד', JSON.stringify(closed));
  t.check('...and the pair dot is red (problem)', !!closed && closed.dot === 'danger', JSON.stringify(closed && closed.dot));
  await page.ev(`document.querySelector('.db-alerts .db-alert-act').click(); true`);
  const back = await poll(async () => { const u = await ui(); return u.banners.length === 0 && latest().agents.worker.state === 'idle' ? u : null; }, 25000, 150);
  t.check('the banner button restarts the agent and the banner disappears', !!back, JSON.stringify(back));
  t.check('no JavaScript errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
