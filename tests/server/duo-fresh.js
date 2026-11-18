'use strict';
// @slow
/*
 * T72 (and T78): a NEW pair must not act before the user did anything. The user's fresh pair in the home folder woke its architect at once because that folder already had a
 * .duo\CHAT.md (an old "user" entry) and TASKS.md from an earlier pair: old files counted as news. Now what is in the files at creation is history.
 * With the queue protocol (T78) the old chat is migrated into the archive (with a backup) and open tasks that were already there are history too: the worker is not fed them.
 *   a. old chat entry + open tasks, NO goal      -> nobody is woken; the old chat is archived (backup kept), the old task stays untouched in the queue
 *   b. the same folder, WITH a goal              -> the architect is woken exactly once (for the goal), the worker not
 *   c. a user message after creation (case a)    -> the architect is woken once
 *   d. a NEW task after creation (case a)        -> the worker's goal lists exactly that task (never the old one)
 * (Fake agents, tests/fixtures/bin-duo.)
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const duoOf = (c, id) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state' && m.duo && (!id || m.duo.id === id)) return m.duo; } return null; };
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

(async () => {
  const t = checker('a new pair stays idle until the user acts');
  const stamp = Date.now();
  const mk = (name) => {
    const project = path.join(TMP, `duo-fresh-${name}-${stamp}`);
    fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
    fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '# Chat\n\n### user · 00:59\nBuild the thing\n\n### architect · 00:59\nPlan written: T1.\n\n### user · 01:10\nOne more thing please\n');
    fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T1 — an old open task\n  do it\n');
    return project;
  };
  const srv = await startServer({ stateFile: path.join(TMP, 'duo-fresh-state.json'), binDir: path.join(FIXTURES, 'bin-duo') });
  const c = await connect(srv.port);
  const create = async (project, goal) => {
    const before = new Set(c.messages.filter((m) => m.t === 'duo' && m.op === 'created').map((m) => m.duoId));
    c.send({ t: 'duo', op: 'create', project, goal, permissionMode: 'auto', reqId: 'r' + Math.random().toString(36).slice(2) });
    const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created' && !before.has(m.duoId)), 20000, 100);
    const id = created.duoId;
    await poll(() => { const d = duoOf(c, id); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 60000, 200);
    return id;
  };
  const wakes = (id) => { const d = duoOf(c, id); return d ? [d.agents.architect.wakes, d.agents.worker.wakes] : null; };

  /* a. no goal: nobody is woken */
  const pa = mk('a');
  const A = await create(pa, '');
  await sleep(9000);
  const tasksA = read(path.join(pa, '.duo', 'TASKS.md'));
  t.check('a. a pair created WITHOUT a goal in a folder with an old chat entry and an open task: nobody is woken', JSON.stringify(wakes(A)) === '[0,0]', JSON.stringify(wakes(A)));
  t.check('a. ...the old task is untouched in the queue, nothing was fed (no inbox) and nothing was written by an agent', tasksA.includes('an old open task') && !read(path.join(pa, '.duo', 'INBOX-worker.md')) && !read(path.join(pa, '.duo', 'worker.log')) && !read(path.join(pa, '.duo', 'arch.log')));
  t.check('a. ...and the old chat moved to the archive with a backup copy (no CHAT.md any more)', !fs.existsSync(path.join(pa, '.duo', 'CHAT.md')) && /One more thing please/.test(read(path.join(pa, '.duo', 'archive', 'CHAT-before-v2.md'))) && /One more thing please/.test(read(path.join(pa, '.duo', 'backup-before-v2', 'CHAT.md'))));

  /* c. the user writes: the architect is woken once */
  c.send({ t: 'duo', op: 'say', duoId: A, text: 'Please add a footer NOTASKS' });
  t.check('c. a user message after creation wakes the architect (once)', !!(await poll(() => { const w = wakes(A); return w && w[0] === 1; }, 40000, 250)));
  await sleep(1500);
  t.check('c. ...and the old task was still not fed to the worker', JSON.stringify(wakes(A)) === '[1,0]', JSON.stringify(wakes(A)));

  /* d. a NEW task: the worker gets exactly that one */
  fs.appendFileSync(path.join(pa, '.duo', 'TASKS.md'), '\n- [ ] T2 — a new task\n  do it too\n');
  t.check('d. a new task after creation wakes the worker', !!(await poll(() => { const w = wakes(A); return w && w[1] >= 1; }, 40000, 250)));
  await poll(() => /TASK T2/.test(read(path.join(pa, '.duo', 'worker.log'))), 20000, 200);
  await sleep(2500);
  t.check('d. the worker\'s goal lists T2 only: the old open task T1 stays history (not listed, not done, still in the queue)', /^GOAL T2\nTASK T2/.test(read(path.join(pa, '.duo', 'worker.log'))) && !/T1/.test(read(path.join(pa, '.duo', 'worker.log'))) && /T1 — an old open task/.test(read(path.join(pa, '.duo', 'TASKS.md'))), read(path.join(pa, '.duo', 'worker.log')));

  /* b. with a goal: one wake of the architect */
  const pb = mk('b');
  const B = await create(pb, 'Build a footer NOTASKS');
  await poll(() => { const w = wakes(B); return w && w[0] >= 1; }, 60000, 250);
  await sleep(6000);
  t.check('b. a pair created WITH a goal wakes the architect exactly once, and the worker (old task, nothing new) not at all', JSON.stringify(wakes(B)) === '[1,0]', JSON.stringify(wakes(B)));
  t.check('b. the goal reached the architect inbox and the board feed shows it as the user\'s message', /Message from the user\n\nBuild a footer/.test(read(path.join(pb, '.duo', 'INBOX-architect.md'))) && duoOf(c, B).feed.some((e) => e.author === 'user' && /Build a footer/.test(e.body)));

  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
