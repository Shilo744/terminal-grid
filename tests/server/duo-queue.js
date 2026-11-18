'use strict';
// @slow
/*
 * The task runner (protocol v3: the worker is on ONE goal, the whole queue), end to end with fake agents (tests/fixtures/bin-duo; the fake worker logs the goal it was given,
 * every task with the number of tasks done in the same conversation, and every time the Stop hook sent it back to work):
 *   A. three tasks written by the "architect": the worker is given its goal ONCE (listing all three), the Stop hook carries it from task to task in the same conversation
 *      (no /clear, no new wake), a blocked task [!] does not stop it, finished tasks leave the file with their Result (also when [x] is written before the Result line),
 *      the architect is not woken at all, counters and archive are right;
 *   B. a task added while the worker is busy is picked up by the Stop hook (no second wake);
 *   C. a worker that never makes progress is sent back to work a few times, then let go: one "stuck" alert, and it is woken again later (never abandoned silently);
 *   D. a Stop hook that did not reach Claude (the worker stops with tasks open): the server gives it the goal again.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const latest = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

async function pair(name, env) {
  const project = path.join(TMP, `duo-queue-${name}-${Date.now()}`);
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'q' });
  const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  await poll(() => { const d = latest(c); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 30000);
  const f = (n) => path.join(project, '.duo', n);
  return { project, srv, c, duoId: created.duoId, f, duo: () => latest(c), stop() { c.close(); srv.stop(); } };
}
const tasks3 = '\n- [ ] T1 — first\n  do the first\n- [ ] T2 — second\n  do the second\n- [ ] T3 — third\n  do the third\n';

(async () => {
  const t = checker('duo task runner (protocol v3)');

  /* ---------- A ---------- */
  const A = await pair('a', { FAKE_BLOCK: 'T2', FAKE_SLOW_RESULT: '1' });
  fs.appendFileSync(A.f('TASKS.md'), tasks3);
  const ended = await poll(() => { const d = A.duo(); return d && d.tasks.counts.done === 2 && d.tasks.counts.blocked === 1 && d.tasks.open === 0 && d.agents.worker.state === 'idle' ? d : null; }, 90000, 250);
  const dA = A.duo();
  t.check('A. all three tasks ran: 2 done, 1 blocked, nothing open', !!ended && dA.tasks.counts.done === 2 && dA.tasks.counts.blocked === 1 && dA.tasks.total === 3, JSON.stringify(dA.tasks.counts));
  const wl = read(A.f('worker.log'));
  t.check('A. the worker got its goal ONCE, listing the whole queue, and the Stop hook carried it through the tasks in file order in the SAME conversation (ctx 1, 2, 3)', /^GOAL T1, T2, T3\nTASK T1 ctx=1\nBLOCKED [^\n]*: T2, T3\.[^\n]*\nTASK T2 ctx=2\nBLOCKED [^\n]*: T3\.[^\n]*\nTASK T3 ctx=3\n$/.test(wl), wl);
  t.check('A. a single wake of the worker for the whole queue, and no /clear anywhere', dA.agents.worker.wakes === 1 && !read(A.f('clear.log')), String(dA.agents.worker.wakes));
  t.check('A. the architect was not woken at all (not per task, not for the blocked one, not for the empty queue)', !/ARCH review/.test(read(A.f('arch.log'))) && dA.agents.architect.wakes === 0, read(A.f('arch.log')));
  t.check('A. there is no worker inbox file any more (the worker reads TASKS.md itself)', !fs.existsSync(A.f('INBOX-worker.md')));
  t.check('A. "[x]" written before the Result line was NOT archived early: the archive has the Result of both finished tasks', /T1 — first\n  do the first\n  Result: done by the fake worker/.test(read(A.f('archive/TASKS-done-1.md'))) && /T3 — third\n  do the third\n  Result: done/.test(read(A.f('archive/TASKS-done-1.md'))));
  t.check('A. finished tasks left the file while the blocked one stays with its reason (and is not counted as done)', /^- \[!\] T2 — second\n  do the second\n  Result: blocked:/m.test(read(A.f('TASKS.md'))) && !/T2 — second/.test(read(A.f('archive/TASKS-done-1.md'))) && !/^- \[x\]/m.test(read(A.f('TASKS.md'))));
  t.check('A. the board feed shows the blocked task (marked) and both finished ones', dA.feed.some((e) => e.kind === 'blocked' && /T2/.test(e.body)) && dA.feed.filter((e) => e.author === 'worker').length === 3, JSON.stringify(dA.feed.map((e) => e.author + ':' + (e.kind || ''))));
  const stA = JSON.parse(read(A.f('STATUS.json')));
  t.check('A. STATUS.json counters: 2 done, nothing waiting for the architect', stA.done === 2 && stA.pendingReview.length === 0, JSON.stringify({ done: stA.done, pr: stA.pendingReview.length }));
  A.stop();
  await sleep(600);

  /* ---------- B ---------- */
  const B = await pair('b', { FAKE_SLOW_RESULT: '1' });
  fs.appendFileSync(B.f('TASKS.md'), '\n- [ ] T1 — first\n  do the first\n');
  await poll(() => /TASK T1/.test(read(B.f('worker.log'))), 30000, 100);
  fs.appendFileSync(B.f('TASKS.md'), '\n- [ ] T2 — second\n  added while T1 is being worked on\n'); // T1 עסוק (המדומה מסיים את ה-Result שלו רק אחרי 1.2 שניות)
  await poll(() => { const d = B.duo(); return d && d.tasks.counts.done === 2 && d.agents.worker.state === 'idle'; }, 40000, 200);
  const wb = read(B.f('worker.log'));
  t.check('B. a task added while the worker is busy is done in the same run: found by the Stop hook, no second wake, same conversation', /^GOAL T1\nTASK T1 ctx=1\nBLOCKED [^\n]*: T2\.[^\n]*\nTASK T2 ctx=2\n$/.test(wb) && B.duo().agents.worker.wakes === 1, wb);
  B.stop();
  await sleep(600);

  /* ---------- C ---------- */
  const C = await pair('c', { FAKE_STUCK: '1', TG_TEST_RETRY_MS: '1500' });
  fs.appendFileSync(C.f('TASKS.md'), '\n- [ ] T1 — never finished\n  one\n');
  const stuck = await poll(() => { const d = C.duo(); return d && d.alerts.some((a) => a.key === 'stuck') ? d : null; }, 60000, 200);
  const wc = read(C.f('worker.log'));
  t.check('C. a worker that does not progress is sent back a few times (the first mark [~] counts as progress), then let go with ONE "stuck" alert', !!stuck && stuck.alerts.filter((a) => a.key === 'stuck').length === 1 && (wc.match(/BLOCKED/g) || []).length >= 2, wc);
  t.check('C. ...with "open the worker terminal" and "write a note" buttons', !!stuck && stuck.alerts[0].actions.map((a) => a.type).join() === 'open,note', JSON.stringify(stuck && stuck.alerts));
  C.stop();
  await sleep(600);

  /* ---------- D ---------- */
  const D = await pair('d', { FAKE_NO_BLOCK: '1', TG_TEST_SUBMIT_TIMEOUT_MS: '1500' });
  fs.appendFileSync(D.f('TASKS.md'), tasks3);
  const doneD = await poll(() => { const d = D.duo(); return d && d.tasks.counts.done === 3 && d.agents.worker.state === 'idle' ? d : null; }, 90000, 250);
  const wd = read(D.f('worker.log'));
  t.check('D. when the Stop hook does not get through (the worker stops with tasks open) the server gives it the goal again, and everything still gets done', !!doneD && (wd.match(/^GOAL/gm) || []).length >= 2 && /TASK T3/.test(wd), wd);
  D.stop();

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
