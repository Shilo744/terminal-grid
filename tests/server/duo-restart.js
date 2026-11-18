'use strict';
// @slow
/*
 * זוגות סוכנים ממשיכים אחרי הפעלה מחדש של השרת (או של המחשב), גם כשהקבצים לא השתנו (T30). נבנה state.json ידנית עם כמה זוגות
 * (סוכנים מדומים, tests/fixtures/bin-duo), מפעילים שרת עם keepState, ובודקים מי מתעורר:
 *   א. משימות פתוחות, שום דבר לא השתנה           -> העובד מתעורר (ממשיך) ועושה את המשימה
 *   ב. אין משימות פתוחות                         -> אף אחד לא מתעורר
 *   ג. זוג מושהה עם משימות פתוחות                -> אף אחד לא מתעורר
 *   ד. הארכיטקט היה באמצע תור (wasWorking)       -> מתעורר פעם אחת, העובד לא
 *   ה. כמו ד', וגם הודעת משתמש ממתינה             -> מתעורר פעם אחת בלבד (לא כפול), וההודעה בתיבה שלו
 *   ו. העובד באמצע משימה ([~])                    -> מקבל שוב את המטרה (Your goal) ומשלים אותה, בלי /clear
 *   ז. משימה אחת כבר בארכיון, נשארה אחת            -> העובד מקבל את המטרה ועושה אותה, בלי /clear
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { FIXTURES, TMP, sleep, checker, startServer, connect } = require('../lib/harness');

async function waitFor(fn, ms, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}
const duoOf = (c, id) => {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m.t === 'duo' && m.op === 'state' && m.duo && m.duo.id === id) return m.duo;
    if (m.t === 'list' && m.duos) { const d = m.duos.find((x) => x.id === id); if (d) return d; }
  }
  return null;
};

(async () => {
  const t = checker('duo continues after a restart');
  const stamp = Date.now();
  const mk = (name, tasks) => {
    const project = path.join(TMP, `duo-restart-${name}-${stamp}`);
    fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
    fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), tasks);
    return project;
  };
  const OPEN = '# Tasks\n\n- [ ] T1 — first thing\n  do it\n';
  const DONE = '# Tasks\n\n- [x] T1 — first thing\n  Result: done\n';
  const DOING = '# Tasks\n\n- [~] T1 — first thing\n  do it\n';
  const SECOND = '# Tasks\n\n- [ ] T2 — second thing\n  do it too\n'; // T1 כבר בארכיון (STATUS)

  const scenarios = [
    { key: 'a', paused: false, tasks: OPEN, archWorking: false },
    { key: 'b', paused: false, tasks: DONE, archWorking: false },
    { key: 'c', paused: true, tasks: OPEN, archWorking: true },
    { key: 'd', paused: false, tasks: DONE, archWorking: true },
    { key: 'e', paused: false, tasks: DONE, archWorking: true, users: [{ t: Date.now(), text: 'One more thing. NOTASKS' }] },
    { key: 'f', paused: false, tasks: DOING, archWorking: false },
    { key: 'g', paused: false, tasks: SECOND, archWorking: false },
  ];
  const duos = scenarios.map((s) => {
    const project = mk(s.key, s.tasks);
    if (s.key === 'g') fs.writeFileSync(path.join(project, '.duo', 'STATUS.json'), JSON.stringify({ v: 1, done: 1, doneIds: ['T1'], archiveSeq: 1, archiveCount: 1, recent: [{ id: 'T1', title: 'first thing', result: 'did the first thing' }] }));
    const id = 'dr' + s.key + crypto.randomBytes(2).toString('hex');
    const agent = (extra) => ({ claudeId: crypto.randomUUID(), wakes: 0, wasWorking: false, ...extra });
    return { s, id, project, cfg: { id, project, goal: 'x', permissionMode: 'auto', paused: s.paused, createdAt: Date.now(), agents: { architect: agent({ wasWorking: s.archWorking, pendingUsers: s.users }), worker: agent({}) } } };
  });
  const stateFile = path.join(TMP, 'duo-restart-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), sessions: [], expanded: null, focus: null, duos: duos.map((d) => d.cfg) }));

  const srv = await startServer({ stateFile, binDir: path.join(FIXTURES, 'bin-duo'), keepState: true });
  const c = await connect(srv.port);
  const get = (k) => duoOf(c, duos.find((d) => d.s.key === k).id);

  t.check('all seven duos were restored', await waitFor(() => duos.every((d) => duoOf(c, d.id)), 20000));
  const wokeA = await waitFor(() => { const d = get('a'); return d && d.agents.worker.wakes >= 1; }, 60000);
  t.check('a. open tasks and no file change: the worker is woken to continue after a restart', !!wokeA);
  t.check('a. ...and does the task', !!(await waitFor(() => { const d = get('a'); return d && d.tasks.counts.done === 1; }, 40000)));
  const wokeD = await waitFor(() => { const d = get('d'); return d && d.agents.architect.wakes >= 1; }, 60000);
  t.check('d. the architect that was working at the last save is woken again', !!wokeD);
  const wokeE = await waitFor(() => { const d = get('e'); return d && d.agents.architect.wakes >= 1; }, 60000);
  t.check('e. same when a new message is also waiting', !!wokeE);
  const wokeF = await waitFor(() => { const d = get('f'); return d && d.agents.worker.wakes >= 1; }, 60000);
  const wokeG = await waitFor(() => { const d = get('g'); return d && d.agents.worker.wakes >= 1; }, 60000);
  const dirOf = (k) => path.join(duos.find((d) => d.s.key === k).project, '.duo');
  const rd = (k, f) => { try { return fs.readFileSync(path.join(dirOf(k), f), 'utf8'); } catch { return ''; } };
  await waitFor(() => /TASK T1/.test(rd('f', 'worker.log')) && /TASK T2/.test(rd('g', 'worker.log')), 30000);
  t.check('f. the worker that was in the middle of T1 is given its goal again, does T1, and NO /clear is sent', !!wokeF && /GOAL T1\nTASK T1 ctx=1/.test(rd('f', 'worker.log')) && !rd('f', 'clear.log'), rd('f', 'worker.log') + '|' + rd('f', 'clear.log'));
  t.check('g. with T1 already archived, the worker gets the goal for the one task that is left (T2), in the same conversation, with no /clear', !!wokeG && /GOAL T2\nTASK T2 ctx=1/.test(rd('g', 'worker.log')) && !rd('g', 'clear.log'), rd('g', 'worker.log') + '|' + rd('g', 'clear.log'));

  await sleep(9000); // בדיקות שליליות: מוודאים שבזמן הזה אף אחד לא מתעורר
  const dB = get('b'), dC = get('c'), dD = get('d'), dE = get('e');
  t.check('b. no open tasks and nobody was working: nobody is woken', dB.agents.worker.wakes === 0 && dB.agents.architect.wakes === 0, `${dB.agents.architect.wakes}/${dB.agents.worker.wakes}`);
  t.check('c. a paused duo stays paused: nobody is woken (even with open tasks and a "was working" architect)', dC.paused && dC.agents.worker.wakes === 0 && dC.agents.architect.wakes === 0, `${dC.agents.architect.wakes}/${dC.agents.worker.wakes}`);
  t.check('d. the architect is woken exactly once and the worker (no open tasks) not at all', dD.agents.architect.wakes === 1 && dD.agents.worker.wakes === 0, `${dD.agents.architect.wakes}/${dD.agents.worker.wakes}`);
  t.check('e. one wake only, not one for the restart and another for the new message, and the message is in its inbox', dE.agents.architect.wakes === 1 && dE.agents.worker.wakes === 0 && /One more thing/.test(rd('e', 'INBOX-architect.md')), `${dE.agents.architect.wakes}/${dE.agents.worker.wakes}`);

  // השרת שומר מי היה באמצע תור (wasWorking) בכל תחילת/סוף תור
  await sleep(800);
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  t.check('the saved state carries wasWorking for every agent', saved.duos.length === 7 && saved.duos.every((d) => typeof d.agents.architect.wasWorking === 'boolean' && typeof d.agents.worker.wasWorking === 'boolean'));

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
