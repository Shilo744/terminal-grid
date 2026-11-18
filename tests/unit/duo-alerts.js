'use strict';
// התראות הזוג מתנקות לבד (T46): לכל התראה מפתח והיא פעילה עד שהבעיה נפתרה. רק התראות פעילות מגיעות ללוח ולנקודה; ההיסטוריה נשארת ב"פעילות אחרונה".
// Duo אמיתי עם api מדומה (בלי טרמינלים): כל סוג התראה נוצר, ואז נפתר בתנאי שלו.
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { Duo } = require('../../server/duo/duo');

const t = checker('pair alerts clear themselves (unit)');
const project = path.join(TMP, 'duo-alerts-' + process.pid);
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(project, { recursive: true });

let n = 0;
const api = { startAgent: () => ({ sessionId: 's' + ++n, claudeId: null }), closeSession() {}, writeInput() {}, claudeIdOf: () => null, emit() {}, persist() {}, log() {}, trustAccepted: () => false };
const d = new Duo({ id: 'u1', project, goal: '', permissionMode: 'auto', paused: true }, api); // מושהה: אף אחד לא מתעורר
d.start(false);

const active = () => d.snapshot().alerts.map((a) => a.key);
const events = () => d.snapshot().events.map((e) => e.text);
const permission = (role) => d.onHook(role, 'notify', { notificationType: 'permission_prompt', message: 'Claude needs your permission' });

// ---------- ממתין לאישור הרשאה: נפתר כשהסוכן ממשיך לעבוד או מסיים תור ----------
d.onHook('architect', 'start');
permission('architect');
t.check('a permission request raises one active alert with a key', JSON.stringify(active()) === JSON.stringify(['permission:architect']) && d.agents.architect.state === 'attention', JSON.stringify(active()));
permission('architect');
t.check('the same problem twice does not duplicate the alert', active().length === 1 && d.alerts.length === 1);
d.onHook('architect', 'notify', { notificationType: 'idle_prompt' });
t.check('an unrelated notification does not clear it', active().length === 1);
d.onHook('architect', 'submit');
t.check('when the agent continues working the alert is resolved and disappears from the snapshot', active().length === 0 && d.agents.architect.state === 'working');
t.check('the history keeps both lines in "אירועים אחרונים" (raised and resolved)', events().some((e) => /^התראה: .*ממתין לאישור/.test(e)) && events().some((e) => /^נפתר: .*ממתין לאישור/.test(e)), JSON.stringify(events().slice(-4)));
t.check('a resolved alert stays in the internal list (marked resolved) but the pair status no longer sees it', d.alerts[0].resolved === true && d.snapshot().alerts.length === 0);
permission('architect');
d.onHook('architect', 'stop');
t.check('finishing the turn also resolves a permission alert', active().length === 0);

// ---------- הסוכן נסגר: נפתר כשהוא חי שוב (אירוע hook אחריו) ----------
d.onSessionExit('worker');
t.check('a closed agent raises a red (error) alert', JSON.stringify(active()) === JSON.stringify(['closed:worker']) && d.snapshot().alerts[0].level === 'error' && d.agents.worker.state === 'exited');
d.onHook('worker', 'start');
t.check('when the agent is alive again (its next hook event) the alert is resolved', active().length === 0);

// ---------- לא התחיל / לא מגיב להוראות (התראה רק על התמדה, T65): נפתרים באירוע הבא של אותו סוכן ----------
d.alert('warn', 'העובד עוד לא התחיל', 'nostart:worker', [{ type: 'open', role: 'worker' }]);
d.alert('warn', 'הארכיטקט לא מגיב להוראות כבר 5 דקות', 'unresponsive:architect', [{ type: 'open', role: 'architect' }]);
t.check('two problems are active at once, each with its own key and an action button', JSON.stringify(active()) === JSON.stringify(['nostart:worker', 'unresponsive:architect']) && d.snapshot().alerts.every((a) => a.actions.length === 1 && a.actions[0].type === 'open'));
d.onHook('worker', 'start');
t.check('SessionStart of the worker resolves "did not start" only', JSON.stringify(active()) === JSON.stringify(['unresponsive:architect']));
d.onHook('architect', 'submit');
t.check('the next event of the architect resolves "not responding"', active().length === 0);

// ---------- עוצר בלי להתקדם: ה-hook של Stop מחזיר את העובד לעבודה, ואחרי שלוש חזרות בלי שינוי בתור מתריעים; נפתר כשהעובד מתקדם ----------
fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T1 — first\n- [ ] T2 — second\n');
const w = d.agents.worker;
w.baseline = {}; w.feedSig = d.queueSig(); // כמו ברגע ההזרקה
d.paused = false; // ה-hook של Stop לא מחזיר עובד לעבודה כשהזוג מושהה
const s1 = d.stopDecision();
t.check('one stop without progress: the Stop hook sends the worker back to work with the open tasks, and it is not an alert', !!s1 && /T1, T2/.test(s1.block) && active().length === 0 && w.noProgress === 1, JSON.stringify(s1));
const s2 = d.stopDecision();
t.check('the second stop without progress is sent back too (still no alert)', !!s2 && active().length === 0 && w.noProgress === 2);
const s3 = d.stopDecision();
d.afterStop('worker');
t.check('the third is let through, and ONE "stuck" alert appears with "open the worker terminal" and "write a note"', s3 === null && JSON.stringify(active()) === JSON.stringify(['stuck']) && JSON.stringify(d.snapshot().alerts[0].actions.map((a) => a.type)) === JSON.stringify(['open', 'note']), JSON.stringify(d.snapshot().alerts));
t.check('...and the worker is woken again only after a waiting time that grows', w.nextEligibleAt > Date.now());
fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — first\n  Result: done\n- [ ] T2 — second\n');
const s4 = d.stopDecision();
t.check('when a task finishes (progress) "stuck" is resolved, the finished task is archived, and the worker is sent on to the next one', !!s4 && /T2/.test(s4.block) && !/T1/.test(s4.block) && active().length === 0 && w.noProgress === 0 && !/\[x\] T1/.test(fs.readFileSync(path.join(project, '.duo', 'TASKS.md'), 'utf8')));
fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n');
t.check('with no open task left the worker is allowed to stop', d.stopDecision() === null);
d.paused = true;
fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T3 — third\n');
t.check('a paused pair never sends the worker back to work', d.stopDecision() === null);

// ---------- הכול נקי: הזוג בריא ----------
t.check('the snapshot of a healthy pair has no alerts at all', d.snapshot().alerts.length === 0);
d.close();
fs.rmSync(project, { recursive: true, force: true });
process.exit(t.finish() ? 0 : 1);
