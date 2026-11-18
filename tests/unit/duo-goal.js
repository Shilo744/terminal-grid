'use strict';
process.env.TG_TEST_BOOT_SETTLE_MS = '1'; process.env.TG_TEST_PENDING_SHOW_MS = '-1';
process.env.TG_TEST_SUBMIT_TIMEOUT_MS = '200'; process.env.TG_TEST_DRAFT_CHECK_MS = '40'; process.env.TG_TEST_ARCH_WRITING_MS = '1500';
// The worker's goal (protocol v3): Duo with a pretend api (no terminals). When the worker is given the goal, what the goal lists, who may start it (the architect must have
// finished writing), what the Stop hook answers, auto-compact in the middle of a turn, the proof of life that replaces a missing submit hook, and the watchdog after a "go on" answer.
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { Duo } = require('../../server/duo/duo');

const t = checker('worker goal and Stop hook (unit)');
const project = path.join(TMP, 'duo-goal-' + process.pid);
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
const tasksFile = path.join(project, '.duo', 'TASKS.md');
const setTasks = (body) => fs.writeFileSync(tasksFile, '# Tasks\n' + body);

let n = 0;
const writes = [];
let lastOut = 0;
const api = {
  startAgent: () => ({ sessionId: 's' + ++n, claudeId: 'c' + n }), closeSession() {}, writeInput: (id, data) => writes.push({ id, data }), claudeIdOf: () => null, setClaudeId() {},
  emit() {}, persist() {}, log() {}, trustAccepted: () => false, lastOutputAt: () => lastOut,
};
const d = new Duo({ id: 'g1', project, goal: '', permissionMode: 'auto', paused: false }, api);
d.start(false);
const w = d.agents.worker, arch = d.agents.architect;
d.onHook('architect', 'start'); d.onHook('worker', 'start');
const goals = () => writes.filter((x) => x.id === w.sessionId && /goal/.test(x.data));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tech = () => d.snapshot().tech.map((e) => e.text);

(async () => {
  // ---------- אין משימות: שקט ----------
  d.evaluate();
  t.check('no open tasks: nobody is given anything', goals().length === 0 && w.state === 'idle');

  // ---------- הארכיטקט עוד כותב: העובד מחכה ----------
  d.onHook('architect', 'submit'); // הארכיטקט באמצע תור
  setTasks('\n- [ ] T1 — first\n  do it\n- [ ] T2 — second\n  do it too\n');
  d.evaluate();
  t.check('the architect is still working (writing tasks): the worker is not started yet', goals().length === 0 && w.state === 'idle');
  d.onHook('architect', 'stop', { last: 'Plan written' }); // מסיים את התור: ה-hook מפעיל evaluate
  t.check('the architect finished its turn: the worker is given its goal, once, listing the whole queue', goals().length === 1 && /Your goal: complete all the open tasks in \.duo\/TASKS\.md \(T1, T2\)/.test(goals()[0].data) && w.state === 'working' && w.wakes === 1, JSON.stringify(goals().map((x) => x.data)));
  await sleep(0);

  // ---------- Stop של העובד: נשארו משימות ----------
  d.onHook('worker', 'submit');
  const r1 = d.onHook('worker', 'stop', { last: 'T1 done?' });
  t.check('the worker ends a turn with open tasks: the Stop hook answers "go on" with the open ids, and the worker stays "working"', !!r1 && /T1, T2/.test(r1.block) && w.state === 'working');
  setTasks('\n- [x] T1 — first\n  do it\n  Result: done\n- [~] T2 — second\n  do it too\n');
  const r2 = d.onHook('worker', 'stop', { last: 'T1 done' });
  t.check('after progress: T1 left the file (archived with its Result) and the answer lists only T2', !!r2 && /remain[^\n]*T2/.test(r2.block) && !/T1/.test(r2.block) && !/T1 — first/.test(fs.readFileSync(tasksFile, 'utf8')) && /Result: done/.test(fs.readFileSync(path.join(project, '.duo', 'archive', 'TASKS-done-1.md'), 'utf8')));
  setTasks('\n- [x] T2 — second\n  do it too\n  Result: done too\n');
  const r3 = d.onHook('worker', 'stop', { last: 'all done' });
  t.check('no open task left: the worker is allowed to stop (null), becomes idle, and everything is archived', r3 === null && w.state === 'idle' && d.snapshot().tasks.counts.done === 2 && !/T2 — second/.test(fs.readFileSync(tasksFile, 'utf8')));
  t.check('the worker was woken only once for the whole run', w.wakes === 1);

  // ---------- משימות ישנות (baseline) לא ברשימה ----------
  setTasks('\n- [ ] T9 — old leftover\n  was there before\n');
  const old = require('../../server/duo/tasks').taskBlocks(fs.readFileSync(tasksFile, 'utf8'))[0];
  w.baseline[old.key] = require('../../server/duo/tasks').sha(old.raw);
  writes.length = 0;
  d.evaluate();
  t.check('an old open task from before the pair was created is not part of the goal (nothing is given)', goals().length === 0 && w.state === 'idle');
  setTasks('\n- [ ] T9 — old leftover\n  was there before\n- [ ] T10 — new\n  now\n');
  d.evaluate();
  t.check('...but a new task is, and only it is listed ("Continue your goal" after the first time)', goals().length === 1 && /Continue your goal: complete all the open tasks in \.duo\/TASKS\.md \(T10\)/.test(goals()[0].data), JSON.stringify(goals().map((x) => x.data)));

  // ---------- דחיסה אוטומטית באמצע תור ----------
  d.onHook('worker', 'submit');
  d.onHook('worker', 'start', { source: 'compact', sessionId: 'c-new' });
  t.check('Claude compacts the conversation in the middle of a turn: the worker stays "working" (no goal is pasted into a running turn) and the new conversation id is kept', w.state === 'working' && w.claudeId === 'c-new');
  writes.length = 0;
  d.evaluate();
  t.check('...so evaluate gives it nothing', goals().length === 0);

  // ---------- הזוג מושהה / סגור: ה-hook לא מחזיר לעבודה ----------
  d.pause();
  t.check('a paused pair lets the worker stop at the end of its turn', d.stopDecision() === null);
  d.resume();

  // ---------- hook של submit שלא הגיע: הטרמינל פעיל ----------
  d.onHook('worker', 'stop', {}); // ריק את המצב: עובר ל-idle (או חוזר לעבודה)
  w.state = 'idle'; w.missed = 0; w.nextEligibleAt = 0;
  setTasks('\n- [ ] T11 — eleven\n  go\n');
  writes.length = 0;
  const wokenAt = Date.now();
  lastOut = 0;
  d.evaluate();
  t.check('(setup) the goal is pasted again', goals().length === 1 && w.state === 'working');
  setTimeout(() => { lastOut = Date.now(); }, 150); // הטרמינל מדפיס (הסוכן עובד) אחרי ההזרקה, אבל ה-hook של submit לא מגיע
  await sleep(420);
  t.check('no submit hook but the terminal is busy: NOT counted as "not received" (no second paste into a running turn)', w.state === 'working' && w.missed === 0 && w.submitSeen === true && goals().length === 1 && tech().some((x) => /לפי פעילות הטרמינל/.test(x)), JSON.stringify({ st: w.state, missed: w.missed, g: goals().length, wokenAt }));

  // ---------- באמת לא התקבל: שקט בטרמינל ----------
  w.state = 'idle'; w.missed = 0; w.nextEligibleAt = 0; w.submitSeen = false;
  lastOut = 0;
  d.evaluate();
  await sleep(420);
  t.check('no submit hook and a silent terminal: it IS counted as not received, and the goal is retried', w.missed >= 1 && tech().some((x) => /לא התקבלה/.test(x)));

  // ---------- שומר אחרי "תמשיך": התשובה לא הגיעה ל-Claude ----------
  w.state = 'working'; w.pending = null; w.missed = 0; clearTimeout(w.submitTimer);
  setTasks('\n- [ ] T12 — twelve\n  go\n- [ ] T13 — thirteen\n  go\n');
  w.feedSig = '';
  const r4 = d.onHook('worker', 'stop', {});
  t.check('(setup) a Stop with tasks open answers "go on"', !!r4 && w.state === 'working');
  lastOut = 0;
  await sleep(420);
  t.check('nothing happens after the "go on" answer (no output, no new Stop): the worker is considered idle and is given the goal again', tech().some((x) => /אין סימן חיים/.test(x)) && goals().length >= 1);

  d.close();
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
