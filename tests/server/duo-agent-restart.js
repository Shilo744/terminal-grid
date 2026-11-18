'use strict';
// @slow
/*
 * הפעלה מחדש של סוכן שנסגר בזוג (T51), מקצה לקצה עם סוכנים מדומים (tests/fixtures/bin-duo):
 *   - סוכן שלא נסגר לא מופעל מחדש (שגיאה, לא נוגעים בכלום);
 *   - עובד שהמשתמש סגר (או שנפל) מופעל מחדש עם אותו claudeId: --session-id כשאין עדיין שיחה שמורה, --resume כשיש;
 *   - הטרמינל החדש נושא את אותו תג (זוג + תפקיד), המצב עובר starting -> idle ב-hooks הרגילים, ההתראה "נסגר" נפתרת;
 *   - כשהזוג ממשיך, הסוכן שהופעל מחדש עושה את המשימות (הוא מקבל את ההוראות בסשן החדש).
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, TEST_HOME, sleep, checker, startServer, connect } = require('../lib/harness');

async function waitFor(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}
const latestDuo = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };
const agentSession = (c, role, notId) => [...c.sessions.values()].find((s) => s.duo && s.duo.role === role && s.id !== notId);
const args = (c, sid) => /FAKE-ARGS (session-id|resume)=([0-9a-f-]{36})/.exec(c.out.get(sid) || '');
const idOf = (c, sid) => { const m = args(c, sid); return m && m[2]; };
const argOf = (c, sid) => { const m = args(c, sid); return m && m[1]; };

(async () => {
  const t = checker('restart an exited pair agent (server)');
  const project = path.join(TMP, 'duo-agent-restart-' + Date.now());
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  const srv = await startServer({ stateFile: path.join(TMP, 'duo-agent-restart-state.json'), binDir: path.join(FIXTURES, 'bin-duo') });
  const c = await connect(srv.port);

  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'r1' });
  const created = await waitFor(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 15000);
  t.check('pair created', !!created);
  const duoId = created && created.duoId;
  c.send({ t: 'duo', op: 'pause', duoId }); // מושהה מיד: שום סוכן לא מתעורר עד שנחליט
  const idle = await waitFor(() => { const d = latestDuo(c); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 30000);
  t.check('both fake agents are up and idle (paused pair)', !!idle);
  // המשימות נכתבות אחרי יצירת הזוג (משימות שהיו בתיקייה מראש הן היסטוריה, T72): העובד מקבל אותן רק כשהזוג ממשיך
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T1 — first thing\n  do it\n- [ ] T2 — second thing\n  do it too\n');

  const w1 = agentSession(c, 'worker');
  await waitFor(() => idOf(c, w1.id), 5000);
  const claudeId = idOf(c, w1.id);
  t.check('the first start uses --session-id with a fresh claudeId', !!claudeId && argOf(c, w1.id) === 'session-id', String(claudeId));

  // ---------- סוכן שלא נסגר ----------
  const errs0 = c.errors.length;
  c.send({ t: 'duo', op: 'restartAgent', duoId, role: 'architect' });
  const refused = await waitFor(() => c.errors.length > errs0, 5000);
  t.check('restarting an agent that is not exited is refused with an error', !!refused, JSON.stringify(c.errors.slice(-1)));
  t.check('...and nothing was touched (same sessions)', agentSession(c, 'architect') && agentSession(c, 'worker').id === w1.id);
  c.send({ t: 'duo', op: 'restartAgent', duoId: 'nope', role: 'worker' });
  t.check('an unknown pair is refused too', !!(await waitFor(() => c.errors.length > errs0 + 1, 5000)));

  // ---------- המשתמש סוגר את הטרמינל של העובד ----------
  c.send({ t: 'close', id: w1.id });
  const exited = await waitFor(() => { const d = latestDuo(c); return d && d.agents.worker.state === 'exited' && d.alerts.some((a) => /closed:worker/.test(a.key)); }, 10000);
  t.check('closing the worker terminal: state exited + the red alert', !!exited);

  // שיחה שמורה כבר קיימת (אחרי שהסוכן עבד): ההפעלה מחדש תהיה --resume
  const tdir = path.join(TEST_HOME, '.claude', 'projects', '-test-project');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, claudeId + '.jsonl'), JSON.stringify({ type: 'summary', summary: 'fake conversation for tests' }) + '\n');

  c.send({ t: 'duo', op: 'restartAgent', duoId, role: 'worker' });
  const w2 = await waitFor(() => agentSession(c, 'worker', w1.id), 10000);
  t.check('a new worker terminal appears, tagged with the same pair and role', !!w2 && w2.duo.duoId === duoId && w2.id !== w1.id);
  const back = await waitFor(() => { const d = latestDuo(c); return d && d.agents.worker.state === 'idle' && d.alerts.length === 0; }, 15000);
  t.check('the worker goes starting -> idle through its hooks and the alert is gone', !!back, JSON.stringify(latestDuo(c) && latestDuo(c).agents.worker.state));
  await waitFor(() => argOf(c, w2.id), 5000);
  t.check('the restart resumes the SAME conversation: --resume <same claudeId>', argOf(c, w2.id) === 'resume' && idOf(c, w2.id) === claudeId, `${argOf(c, w2.id)} ${idOf(c, w2.id)} vs ${claudeId}`);
  t.check('the old terminal is gone and exactly two agent terminals exist', !c.sessions.has(w1.id) && [...c.sessions.values()].filter((s) => s.duo).length === 2);
  t.check('the architect kept its terminal (not restarted)', !!agentSession(c, 'architect'));

  // ---------- הזוג ממשיך: העובד החדש עושה את המשימות ----------
  c.send({ t: 'duo', op: 'resume', duoId });
  const done = await waitFor(() => { const d = latestDuo(c); return d && d.tasks.counts.done === 2 && d.tasks.open === 0; }, 60000);
  t.check('when the pair continues, the restarted worker receives the instructions and finishes both tasks', !!done, JSON.stringify(latestDuo(c) && latestDuo(c).tasks.counts));
  t.check('no leftover alert', latestDuo(c).alerts.length === 0, JSON.stringify(latestDuo(c).alerts));

  // ---------- סוכן שנפל (התהליך יצא, הסשן עדיין רשום): הטרמינל הקיים מוחלף ----------
  c.send({ t: 'duo', op: 'pause', duoId });
  await sleep(400);
  const w3 = agentSession(c, 'worker');
  // הסוכן המדומה יוצא (כמו Claude שנסגר); הטרמינל נשאר עם PowerShell (-NoExit), ורק כש-PowerShell עצמו יוצא התהליך של הטרמינל מסתיים (כמו קריסה או exit)
  c.send({ t: 'input', id: w3.id, d: '\x1b[200~TG-FAKE-EXIT\x1b[201~\r' });
  await waitFor(() => /FAKE-ARGS[\s\S]*PS [A-Z]:/.test(c.out.get(w3.id) || ''), 10000);
  t.check('(setup) the agent quit but its terminal stays open with a PowerShell prompt: not exited yet', latestDuo(c).agents.worker.state !== 'exited');
  c.send({ t: 'input', id: w3.id, d: 'exit\r' });
  const crashed = await waitFor(() => { const d = latestDuo(c); return d && d.agents.worker.state === 'exited' && c.messages.some((m) => m.t === 'exit' && m.id === w3.id) && c.sessions.has(w3.id); }, 15000);
  t.check('a crashed agent (process exited, terminal still listed) is exited with the red alert', !!crashed && latestDuo(c).alerts.some((a) => a.key === 'closed:worker'));
  c.send({ t: 'duo', op: 'restartAgent', duoId, role: 'worker' });
  const w4 = await waitFor(() => agentSession(c, 'worker', w3.id), 10000);
  const back2 = await waitFor(() => { const d = latestDuo(c); return d && d.agents.worker.state === 'idle' && d.alerts.length === 0; }, 15000);
  t.check('restart replaces the lingering exited terminal with a new one that comes back idle', !!w4 && !c.sessions.has(w3.id) && !!back2);

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
