'use strict';
// @slow
/*
 * הסטטוס בממשק לפי hooks (T11): הטרמינל מציג עובד / ממתין לך / פנוי לפי אירועי Claude Code ולא לפי תזמון הפלט.
 *  - לפני האירוע הראשון ההיגיון הישן (תזמון פלט) ממשיך לעבוד; אחרי האירוע הראשון hooks קובעים (data-agent על הפאן);
 *  - UserPromptSubmit = עובד (s-busy), בקשת הרשאה = ממתין לך (s-wait) גם בפאן ממוקד, Stop בפאן לא ממוקד = ממתין לך עד שמסתכלים בו;
 *  - הקלדה בפאן אחרי בקשת הרשאה (המשתמש ענה) מחזירה אותו ל"עובד" בלי לחכות ל-Stop; טרמינל PowerShell נשאר עם ההיגיון הישן.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect, openPage } = require('../lib/harness');

const postEvent = (port, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: '127.0.0.1', port, path: '/api/agent/event', method: 'POST', headers: { Origin: `http://127.0.0.1:${port}`, 'x-tg': '1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
  rq.on('error', reject); rq.end(data);
});

(async () => {
  const t = checker('agent status in the UI (hooks)');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-agent') });
  const keeper = await connect(srv.port);
  const work = path.join(TMP, 'agent-status-ui');
  fs.mkdirSync(work, { recursive: true });
  keeper.send({ t: 'create', kind: 'claude', cwd: work, name: 'A' });
  keeper.send({ t: 'create', kind: 'claude', cwd: work, name: 'B' });
  keeper.send({ t: 'create', kind: 'powershell', cwd: work, name: 'P' });
  await poll(() => keeper.sessions.size === 3, 20000);
  const id = (n) => [...keeper.sessions.values()].find((s) => s.name === n).id;
  const [A, B, P] = [id('A'), id('B'), id('P')];

  const page = await openPage(`http://127.0.0.1:${srv.port}/`, { width: 1500, height: 900 });
  await page.appReady(3);
  const pane = (x) => `document.querySelector('.pane[data-id="${x}"]')`;
  const cls = (x) => page.ev(`[...${pane(x)}.classList].filter((c) => c.startsWith('s-')).join()`);
  const agent = (x) => page.ev(`${pane(x)}.dataset.agent || ''`);
  const focusPane = (x) => page.ev(`${pane(x)}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);

  await focusPane(B); // B ממוקד: A ברקע
  t.check('before any hook event a Claude terminal has no agent state (old output-timing logic)', (await agent(A)) === '');

  await postEvent(srv.port, { paneId: A, event: 'start', source: 'startup' });
  await page.waitFor(`${pane(A)}.dataset.agent === 'idle'`, 8000);
  t.check('SessionStart: data-agent=idle and the pane is idle', (await agent(A)) === 'idle' && await poll(async () => (await cls(A)) === 's-idle', 6000, 200), await cls(A));

  const label = (x) => page.ev(`${pane(x)}.querySelector('.pstatus').textContent`);
  await postEvent(srv.port, { paneId: A, event: 'submit' });
  t.check('UserPromptSubmit: working (s-busy), even with no output at all', await poll(async () => (await cls(A)) === 's-busy', 6000, 200), await cls(A));
  t.check('the header says "עובד…"', (await label(A)) === 'עובד…', await label(A));

  await postEvent(srv.port, { paneId: A, event: 'notify', notificationType: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  t.check('permission prompt in a background pane: waiting for you (s-wait)', await poll(async () => (await cls(A)) === 's-wait', 6000, 200), await cls(A));
  t.check('the header says "צריך אישור" (class k-attn)', (await label(A)) === 'צריך אישור' && await page.ev(`${pane(A)}.classList.contains('k-attn')`), await label(A));
  await focusPane(A);
  await sleep(1000);
  t.check('looking at the pane does NOT clear a permission prompt (the agent is still blocked)', (await cls(A)) === 's-wait', await cls(A));

  // המשתמש עונה (הקלדה בפאן): עובד שוב, בלי לחכות ל-Stop
  await page.ev(`${pane(A)}.querySelector('textarea').focus(); true`);
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', text: 'y', windowsVirtualKeyCode: 89 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89 });
  t.check('answering the prompt (typing in the pane) returns it to working', await poll(async () => (await cls(A)) === 's-busy', 6000, 200), await cls(A));

  // Stop בפאן ממוקד: פנוי; Stop בפאן ברקע: ממתין לך עד שמסתכלים בו
  await postEvent(srv.port, { paneId: A, event: 'stop' });
  t.check('Stop in the focused pane: idle (you are looking at it)', await poll(async () => (await cls(A)) === 's-idle', 6000, 200), await cls(A));
  await postEvent(srv.port, { paneId: B, event: 'start' });
  await postEvent(srv.port, { paneId: B, event: 'submit' });
  await focusPane(A);
  await postEvent(srv.port, { paneId: B, event: 'stop' });
  t.check('Stop in a background pane: waiting for you (s-wait)', await poll(async () => (await cls(B)) === 's-wait', 6000, 200), await cls(B));
  t.check('the header says "סיים — ממתין לך" (class k-done)', (await label(B)) === 'סיים — ממתין לך' && await page.ev(`${pane(B)}.classList.contains('k-done')`), await label(B));
  await focusPane(B);
  t.check('focusing it clears the "finished" mark: idle', await poll(async () => (await cls(B)) === 's-idle', 6000, 200), await cls(B));

  t.check('the PowerShell terminal keeps the old logic (no data-agent)', (await agent(P)) === '');
  t.check('an idle pane shows no status label (just the grey dot)', await page.ev(`${pane(A)}.querySelector('.pstatus').hidden`) === true);
  t.check('no page errors', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));

  page.close(); keeper.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
