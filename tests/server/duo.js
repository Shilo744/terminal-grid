'use strict';
// @slow: לא רץ ב-npm run test:quick (ארוך, תלוי בסוכנים/טרמינלים אמיתיים)
// The agent duo (protocol v3), end to end with fake agents: the goal wakes the architect, the worker is given ONE goal (the whole queue) and the Stop hook carries it
// from task to task in the same conversation, the architect is not woken per task, no self-loops, pause/resume, keep-alive when the window closes,
// and restore after the server dies.
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, checker, startServer, connect } = require('../lib/harness');

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
function latestDuo(c) {
  for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; }
  return null;
}
async function waitFor(fn, ms, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}
const mkProject = (name) => { const p = path.join(TMP, name + '-' + Date.now()); fs.mkdirSync(p, { recursive: true }); return p; };

(async () => {
  const t = checker('agent duo');
  const binDir = path.join(FIXTURES, 'bin-duo');
  const stateFile = path.join(TMP, 'duo-state.json');
  try { fs.unlinkSync(stateFile); } catch { /* none */ }

  /* ---------- A: the normal loop ---------- */
  const project = mkProject('duo-a');
  const f = (n) => path.join(project, '.duo', n);
  let srv = await startServer({ stateFile, binDir });
  let c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: 'Build the thing', reqId: 'd1' });

  const created = await waitFor(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 10000);
  t.check('duo created', !!created);
  const duoId = created && created.duoId;
  await waitFor(() => [...c.sessions.values()].filter((s) => s.duo).length === 2, 10000);
  const ss = [...c.sessions.values()].filter((s) => s.duo);
  t.check('two tagged terminals (architect + worker)', ss.length === 2 && ss.some((s) => s.duo.role === 'architect') && ss.some((s) => s.duo.role === 'worker'));
  t.check('there is no chat file: the goal reaches the architect through its inbox', !fs.existsSync(f('CHAT.md')));

  // the architect is woken by the goal -> writes tasks; the worker is given the goal once and does T1 and T2 in one run
  const finished = await waitFor(() => { const d = latestDuo(c); return d && d.tasks.counts.done === 2 && d.tasks.open === 0 && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle' ? d : null; }, 60000);
  const d = latestDuo(c);
  t.check('the architect wrote the tasks after being woken by the goal (from its inbox)', !!finished && /ARCH user users=1/.test(read(f('arch.log'))), read(f('arch.log')));
  t.check('the worker did both tasks from ONE wake (the goal), the Stop hook carried it on', !!finished && d.tasks.counts.done === 2 && d.tasks.total === 2 && d.agents.worker.wakes === 1, `worker wakes=${d && d.agents.worker.wakes}`);
  t.check('the goal listed both tasks, and both ran in the same conversation (ctx 1, then 2)', /GOAL T1, T2\nTASK T1 ctx=1\n/.test(read(f('worker.log'))) && /TASK T2 ctx=2/.test(read(f('worker.log'))), read(f('worker.log')));
  t.check('no /clear is ever sent between tasks', !read(f('clear.log')), JSON.stringify(read(f('clear.log'))));
  t.check('the architect was woken exactly once, by the goal: never per task and not for a final review', d.agents.architect.wakes === 1 && !/ARCH review/.test(read(f('arch.log'))), read(f('arch.log')));
  t.check('the finished tasks are archived with their Result, the queue file holds only the index line', /T1 — first thing[\s\S]*Result: done by the fake worker/.test(read(f('archive/TASKS-done-1.md'))) && !/^- \[x\]/m.test(read(f('TASKS.md'))) && /Done and archived[^\n]*T1-T2/.test(read(f('TASKS.md'))), read(f('TASKS.md')));
  t.check('STATUS.json keeps the counters (2 done) and the board shows 2 of 2', JSON.parse(read(f('STATUS.json'))).done === 2 && d.tasks.counts.done === 2 && d.tasks.total === 2);
  t.check('the board feed shows the goal, the architect plan, and both finished tasks (a read-only activity feed)', d.feed.some((e) => e.author === 'user' && /Build the thing/.test(e.body)) && d.feed.some((e) => e.author === 'architect' && /Plan written/.test(e.body)) && d.feed.filter((e) => e.author === 'worker').length === 2, JSON.stringify(d.feed.map((e) => e.author)));

  const w1 = [d.agents.architect.wakes, d.agents.worker.wakes];
  await sleep(6000);
  const d2 = latestDuo(c);
  t.check('quiet when there is nothing to do (no self-triggered loop)', d2.agents.architect.wakes === w1[0] && d2.agents.worker.wakes === w1[1], `wakes ${w1} -> ${[d2.agents.architect.wakes, d2.agents.worker.wakes]}`);

  /* ---------- pause / resume ---------- */
  c.send({ t: 'duo', op: 'pause', duoId });
  await sleep(500);
  c.send({ t: 'duo', op: 'say', duoId, text: 'One more thing please NOTASKS' });
  await sleep(4500); // בדיקה שלילית: מוודאים שבזמן הזה אף אחד לא התעורר
  const dp = latestDuo(c);
  t.check('paused: a new user message does not wake anyone', dp.paused && dp.agents.architect.wakes === w1[0], `architect wakes=${dp.agents.architect.wakes}`);
  c.send({ t: 'duo', op: 'resume', duoId });
  const woke = await waitFor(() => { const x = latestDuo(c); return x && x.agents.architect.wakes > w1[0]; }, 15000);
  t.check('resume: the pending message wakes the architect, with the message in its inbox', !!woke && /ARCH user users=1/.test(read(f('arch.log')).split('\n').slice(-3).join('\n')), read(f('arch.log')));
  await waitFor(() => { const x = latestDuo(c); return x && x.agents.architect.state === 'idle'; }, 15000);

  /* ---------- the window closing must NOT stop an active duo ---------- */
  c.close();
  await sleep(16000);
  t.check('server stays alive after the window closed (duo active)', !srv.child.exited);

  /* ---------- restore after the server dies ---------- */
  const before = latestDuo(c);
  srv.stop();
  await sleep(1500);
  srv = await startServer({ stateFile, binDir, keepState: true });
  c = await connect(srv.port);
  const back = await waitFor(() => { const m = c.messages.find((x) => x.t === 'list'); return m && m.duos && m.duos.length ? m.duos[0] : null; }, 15000);
  t.check('duo restored with the same project after a restart', !!back && back.project === project);
  await sleep(5000);
  const after = latestDuo(c) || back;
  t.check('restored duo does not re-wake agents for old work, and the counters are the same', !!after && after.agents.architect.wakes === before.agents.architect.wakes && after.agents.worker.wakes === before.agents.worker.wakes && after.tasks.counts.done === before.tasks.counts.done && after.tasks.total === before.tasks.total,
    `wakes ${before.agents.architect.wakes}/${before.agents.worker.wakes} -> ${after && after.agents.architect.wakes}/${after && after.agents.worker.wakes}`);
  t.check('and no /clear was sent after the restart (nothing to feed)', !read(f('clear.log')));
  const sessions2 = [...c.sessions.values()].filter((s) => s.duo);
  t.check('both agent terminals came back', sessions2.length === 2);
  c.send({ t: 'duo', op: 'close', duoId: back.id });
  await waitFor(() => ![...c.sessions.values()].some((s) => s.duo), 8000);
  t.check('closing the duo removes it and its terminals', ![...c.sessions.values()].some((s) => s.duo));
  c.close(); srv.stop();

  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
