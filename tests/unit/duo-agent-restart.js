'use strict';
// הפעלה מחדש של סוכן שנסגר בזוג (T51): Duo אמיתי עם api מדומה (בלי טרמינלים). בודק את הכללים: רק סוכן ב-exited, אותו claudeId, הישן נסגר קודם ולא מסמן "נסגר" שוב,
// ההתראה "נסגר" נפתרת מיד, העובד עם משימות פתוחות ממשיך כשהוא חי, ארכיטקט שנסגר באמצע תור מתעורר פעם אחת.
process.env.TG_TEST_BOOT_SETTLE_MS = '1'; process.env.TG_TEST_PENDING_SHOW_MS = '-1'; // T65: בלי המתנת ההפעלה, וההמתנה מוצגת מיד (לפני טעינת duo.js)
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { Duo } = require('../../server/duo/duo');

const t = checker('restart an exited pair agent (unit)');
const project = path.join(TMP, 'duo-agent-restart-' + process.pid);
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T1 — first\n  do it\n');

let n = 0;
const calls = [];
const writes = [];
let d;
const api = {
  startAgent(duo, role, resume) { const r = { sessionId: 's' + ++n, claudeId: resume || 'claude-' + role }; calls.push({ role, resume, sessionId: r.sessionId }); return r; },
  // כמו השרת האמיתי: סגירת סשן של סוכן מדווחת ל-Duo (onSessionGone). אם הסשן הישן עדיין רשום אצל הסוכן, זה היה מסמן אותו שוב כ"נסגר"
  closeSession(id) { calls.push({ closed: id }); for (const [role, a] of Object.entries(d.agents)) if (a.sessionId === id) d.onSessionExit(role); },
  writeInput(id, data) { writes.push({ id, data }); }, claudeIdOf: () => null, emit() {}, persist() {}, log() {}, trustAccepted: () => false,
};
d = new Duo({ id: 'r1', project, goal: '', permissionMode: 'auto', paused: true }, api); // מושהה: אף אחד לא מתעורר מעצמו
d.start(false);
d.agents.worker.baseline = {}; // T1 פתוחה ולא בבסיס: זו עבודה אמיתית שמחכה
const firstWorker = d.agents.worker.sessionId, firstArch = d.agents.architect.sessionId;
const active = () => d.snapshot().alerts.map((a) => a.key);

t.check('restart is refused for an agent that is not exited (nothing is closed or started)', d.restartAgent('worker') === false && d.agents.worker.sessionId === firstWorker && !calls.some((c) => c.closed), JSON.stringify(calls));
t.check('...and for an unknown role', d.restartAgent('nobody') === false);

// ---------- עובד שנסגר, עם משימה פתוחה ----------
d.onHook('worker', 'start');
d.onHook('architect', 'start');
d.onSessionExit('worker');
t.check('a closed worker is exited and raises the red alert', d.agents.worker.state === 'exited' && JSON.stringify(active()) === JSON.stringify(['closed:worker']));
calls.length = 0;
const claudeBefore = d.agents.worker.claudeId;
t.check('restartAgent returns true for an exited agent', d.restartAgent('worker') === true);
t.check('the old session is closed first, then the new one starts with the SAME claudeId (resume)', calls.length === 2 && calls[0].closed === firstWorker && calls[1].role === 'worker' && calls[1].resume === claudeBefore, JSON.stringify(calls));
t.check('the agent has the new session, is "starting", and the old session did not mark it exited again', d.agents.worker.sessionId !== firstWorker && d.agents.worker.sessionId === calls[1].sessionId && d.agents.worker.state === 'starting', d.agents.worker.state);
t.check('the "closed" alert is resolved at once (the problem is over; a failed start raises its own alert)', active().length === 0);
t.check('the other agent is untouched', d.agents.architect.sessionId === firstArch && d.agents.architect.state === 'idle');
t.check('a second restart while it is starting is refused', d.restartAgent('worker') === false);
t.check('the history says it was restarted', d.snapshot().events.some((e) => /הופעל מחדש/.test(e.text)), JSON.stringify(d.snapshot().events.slice(-3)));

// העובד נשאר מושהה עד שהזוג מחודש; כשהוא חי (SessionStart) והזוג ממשיך, הוא מקבל את הודעת ההמשך (אחרי הפעלה מחדש של השרת זה אותו מנגנון)
d.onHook('worker', 'start');
t.check('worker SessionStart: idle again, with nothing holding it back (the open tasks make the server give it its goal again)', d.agents.worker.state === 'idle' && d.agents.worker.nextEligibleAt === 0);
writes.length = 0;
d.resume();
t.check('when the pair continues the worker is given its goal (with the open task listed) in the NEW session', writes.length > 0 && writes[0].id === d.agents.worker.sessionId && /Your goal: complete all the open tasks[^\n]*\(T1\)/.test(writes[0].data), JSON.stringify(writes[0] || null).slice(0, 200));

// ---------- ארכיטקט שנסגר באמצע תור ----------
d.pause();
d.onHook('architect', 'submit');
t.check('(setup) the architect is working', d.agents.architect.state === 'working');
d.onSessionExit('architect');
t.check('an architect that closed while working remembers it', d.agents.architect.diedWorking === true);
t.check('restartAgent works for the architect too', d.restartAgent('architect') === true && d.agents.architect.state === 'starting' && d.agents.architect.restartWake === true);

// ---------- ארכיטקט שנסגר כשהיה פנוי: אין התעוררות מיותרת ----------
d.onHook('architect', 'start');
d.onSessionExit('architect');
t.check('an architect that closed while idle does not remember "working"', d.agents.architect.diedWorking === false);
d.agents.architect.restartWake = false;
d.restartAgent('architect');
t.check('...so no restart wake is armed for it', d.agents.architect.restartWake === false);

// ---------- סגירת הזוג אחרי הפעלה מחדש לא נופלת ----------
calls.length = 0;
let closeErr = null;
try { d.close(); } catch (e) { closeErr = e; }
t.check('closing the pair after restarts closes the CURRENT sessions without error', !closeErr && calls.filter((c) => c.closed).length === 2 && calls.some((c) => c.closed === d.agents.worker.sessionId), String(closeErr) + JSON.stringify(calls));

try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
process.exit(t.finish() ? 0 : 1);
