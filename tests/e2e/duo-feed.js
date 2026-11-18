'use strict';
// @slow
/*
 * T78: the pair board without a chat. A read-only activity feed ("פעילות": the goal, the architect's summaries, every finished or blocked task with its Result),
 * the progress counters that do not change when tasks move to the archive (done / total, also on the tab), and a box that writes to the architect only.
 * Real browser, fake agents. Screenshot: docs/screens/T78-board.png
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

(async () => {
  const t = checker('pair board: activity feed, counters, writing to the architect');
  const project = path.join(TMP, 'duo-feed-' + process.pid);
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  const f = (n) => path.join(project, '.duo', n);
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { FAKE_BLOCK: 'T2' } });
  const keeper = await connect(srv.port);
  keeper.send({ t: 'duo', op: 'create', project, goal: 'Build the footer', permissionMode: 'auto', reqId: 'f' });
  const created = await poll(() => keeper.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  const { ev } = page;
  await page.appReady(0);
  await ev(`new Promise((res) => { const t0 = Date.now(); const go = () => { const b = document.querySelector('.duo-tab[data-id]'); if (b) { b.click(); res(true); } else if (Date.now() - t0 > 20000) res(false); else setTimeout(go, 100); }; go(); })`);
  await page.waitFor(`!!document.querySelector('.db-agent[data-role="architect"]')`, 20000);
  // the fake architect plans T1 and T2 (T2 will be blocked by the fake worker); wait for the end of the run
  await poll(() => /ARCH review users=0 finished=1 blocked=0|ARCH review users=0 finished=1 blocked=1/.test(read(f('arch.log'))) && /TASK T2/.test(read(f('worker.log'))), 90000, 300);
  await page.waitFor(`document.querySelectorAll('.db-group.r-worker .db-bubble').length >= 2`, 30000);
  await sleep(800);
  const ui = await ev(`(() => ({
    heading: document.querySelector('.db-chat-sec h3').textContent,
    placeholder: document.querySelector('.db-compose textarea').placeholder,
    userBubbles: [...document.querySelectorAll('.db-group.r-user .db-bubble')].map((b) => b.textContent),
    archBubbles: [...document.querySelectorAll('.db-group.r-architect .db-bubble')].map((b) => b.textContent),
    workerBubbles: [...document.querySelectorAll('.db-group.r-worker .db-bubble')].map((b) => b.textContent),
    blocked: document.querySelectorAll('.db-bubble.is-blocked').length,
    progress: document.querySelector('.db-progress-text').textContent,
    tab: document.querySelector('.duo-tab[data-id] .pr').textContent,
    text: document.querySelector('#duoView').innerText,
  }))()`);
  t.check('the feed section is titled "פעילות" and nothing on the board mentions a shared chat', ui.heading === 'פעילות' && !/שיחה משותפת/.test(ui.text), ui.heading);
  t.check('the feed shows the goal as the user message, and the architect summaries', ui.userBubbles.some((b) => /Build the footer/.test(b)) && ui.archBubbles.some((b) => /Plan written/.test(b)), JSON.stringify([ui.userBubbles, ui.archBubbles]));
  t.check('every finished task and the blocked one is in the feed with its Result (the blocked one is marked)', ui.workerBubbles.some((b) => /T1 — first thing[\s\S]*done by the fake worker/.test(b)) && ui.workerBubbles.some((b) => /T2 — second thing[\s\S]*blocked/.test(b)) && ui.blocked === 1, JSON.stringify(ui.workerBubbles));
  t.check('the progress text and the tab counter count the archived tasks too (1 of 2: one done, one blocked)', /1 מתוך 2/.test(ui.progress) && /חסומ/.test(ui.progress) && ui.tab === '1/2', JSON.stringify([ui.progress, ui.tab]));
  t.check('the box writes to the architect (placeholder says so)', /ארכיטקט/.test(ui.placeholder) && !/שיחה/.test(ui.placeholder), ui.placeholder);
  const shotFile = path.join(__dirname, '..', '..', 'docs', 'screens', 'T78-board.png');
  fs.mkdirSync(path.dirname(shotFile), { recursive: true });
  fs.writeFileSync(shotFile, Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  // typing in the box: a user message to the architect, shown in the feed, delivered through its inbox
  const wakesBefore = (read(f('arch.log')).match(/ARCH user/g) || []).length;
  await ev(`(() => { const ta = document.querySelector('.db-compose textarea'); ta.value = 'please also check the header NOTASKS'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.db-compose').requestSubmit(); return true; })()`);
  await poll(() => (read(f('arch.log')).match(/ARCH user/g) || []).length === wakesBefore + 1, 40000, 200);
  await page.waitFor(`[...document.querySelectorAll('.db-group.r-user .db-bubble')].some((b) => /check the header/.test(b.textContent))`, 20000);
  t.check('a message typed in the box wakes the architect once (through its inbox) and appears in the feed as the user', /please also check the header/.test(read(f('INBOX-architect.md'))));
  t.check('...and the worker was not touched by it', (read(f('worker.log')).match(/^TASK /gm) || []).length === 2);

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
