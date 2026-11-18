'use strict';
// תור המשימות של הזוג (T78, server/duo/queue.js + tasks.js): גושי משימות, ארכיון, מונים, שורת אינדקס, תיבות, ומעבר מגרסה 1 עם גיבוי. טהור: קבצים בתיקייה זמנית, בלי סוכנים.
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { taskBlocks } = require('../../server/duo/tasks');
const queue = require('../../server/duo/queue');
const { Duo } = require('../../server/duo/duo');

const t = checker('pair task queue: blocks, archive, counters, inboxes, migration (unit)');
const root = path.join(TMP, 'duo-queue-' + process.pid);
fs.rmSync(root, { recursive: true, force: true });
const mk = (name, tasks, chat) => {
  const p = path.join(root, name);
  fs.mkdirSync(path.join(p, '.duo'), { recursive: true });
  if (tasks != null) fs.writeFileSync(path.join(p, '.duo', 'TASKS.md'), tasks);
  if (chat != null) fs.writeFileSync(path.join(p, '.duo', 'CHAT.md'), chat);
  return p;
};
const rd = (p, ...f) => fs.readFileSync(path.join(p, '.duo', ...f), 'utf8');

/* ---------- גושי משימות ---------- */
const md = '# Tasks\n\n<!-- - [ ] T9 — only an example in a comment\n-->\n  >>> banner line\n- [x] T1 — one\n  details\n  Result: did it\n\n- [ ] T2 — two\n  more details\n## A heading ends the block\n- [!] T3 — three\n  Result: blocked: why\n- [ ] a task without a number\n';
const bl = taskBlocks(md);
t.check('blocks: the example inside a comment is ignored, four real tasks in order', bl.map((b) => b.key).join() === 'T1,T2,T3,' + bl[3].key && bl.length === 4, JSON.stringify(bl.map((b) => b.key)));
t.check('a block is the task line plus its indented lines (a blank line inside is fine, a heading ends it)', bl[0].raw === '- [x] T1 — one\n  details\n  Result: did it' && bl[1].raw === '- [ ] T2 — two\n  more details', JSON.stringify([bl[0].raw, bl[1].raw]));
t.check('status, title and the Result line are read per block', bl[0].status === 'done' && bl[0].result === 'did it' && bl[1].status === 'todo' && bl[2].status === 'blocked' && bl[2].result === 'blocked: why' && bl[1].title === 'two');
t.check('a task without a number gets a stable key from its text (#xxxxxx)', /^#[0-9a-f]{6}$/.test(bl[3].key) && taskBlocks(md)[3].key === bl[3].key);

/* ---------- שורת אינדקס ---------- */
t.check('the index line compresses consecutive numbers into ranges', queue.indexLine(['T1', 'T2', 'T3', 'T5', 'T7', 'T8']) === 'Done and archived (see .duo/archive/): T1-T3, T5, T7-T8' && queue.indexLine([]) === '');

/* ---------- ארכיון ---------- */
const proj = mk('archive', '# Tasks\n\n- [x] T1 — a\n  Result: ra\n- [ ] T2 — b\n  keep me\n- [x] T3 — c\n  Result: rc\n- [!] T4 — d\n  Result: blocked: no\n');
queue.ensure(proj); // זוג בלי STATUS: מעבר (יש משימות שהסתיימו)
let st = queue.readStatus(proj);
t.check('first ensure migrates: both finished tasks are archived, counted, and removed from the queue', st.done === 2 && st.doneIds.join() === 'T1,T3' && !/T1 — a|T3 — c/.test(rd(proj, 'TASKS.md')) && /T2 — b/.test(rd(proj, 'TASKS.md')) && /T4 — d/.test(rd(proj, 'TASKS.md')), JSON.stringify(st) + rd(proj, 'TASKS.md'));
t.check('the archive file holds the full text (including the Result lines)', /T1 — a\n  Result: ra/.test(rd(proj, 'archive', 'TASKS-done-1.md')) && /T3 — c\n  Result: rc/.test(rd(proj, 'archive', 'TASKS-done-1.md')));
t.check('TASKS.md has ONE index line with the archived numbers', (rd(proj, 'TASKS.md').match(/^Done and archived/gm) || []).length === 1 && /T1, T3/.test(rd(proj, 'TASKS.md')), rd(proj, 'TASKS.md'));
t.check('the backup copy of the original queue exists before anything was changed', fs.existsSync(path.join(proj, '.duo', 'backup-before-v2', 'TASKS.md')) && /T1 — a/.test(rd(proj, 'backup-before-v2', 'TASKS.md')));
queue.ensure(proj);
t.check('a second ensure changes nothing (idempotent)', queue.readStatus(proj).done === 2);

// הסימון [x] בתור חי: עוברת לארכיון, נרשמת לסקירה ולפעילות; חסומה נרשמת פעם אחת בלבד
fs.writeFileSync(path.join(proj, '.duo', 'TASKS.md'), rd(proj, 'TASKS.md').replace('- [ ] T2 — b\n  keep me', '- [x] T2 — b\n  keep me\n  Result: finished b; learned x'));
st = queue.readStatus(proj);
const moved = queue.archiveDone(proj, st);
const blocked = queue.noteBlocked(proj, st);
queue.writeStatus(proj, st);
t.check('a task marked [x] later is moved with its Result, counted (3), queued for the architect review and shown in the feed', moved.length === 1 && moved[0].id === 'T2' && queue.readStatus(proj).done === 3 && st.pendingReview.some((r) => r.id === 'T2' && r.status === 'done' && /learned x/.test(r.result)) && st.feed.some((f) => /T2 — b/.test(f.text)), JSON.stringify(st.pendingReview));
t.check('a blocked task is reported ONCE (review + feed), and stays in the queue file', blocked.length === 1 && blocked[0].id === 'T4' && queue.noteBlocked(proj, st).length === 0 && /T4 — d/.test(rd(proj, 'TASKS.md')));
t.check('archiving again when nothing is finished does nothing', queue.archiveDone(proj, st).length === 0);

// קריסה בין כתיבת המונים לכתיבת התור: מסירים בלי לספור שוב
const crash = mk('crash', '# Tasks\n\n- [x] T1 — a\n  Result: ra\n');
queue.ensure(crash);
fs.writeFileSync(path.join(crash, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — a\n  Result: ra\n'); // כאילו הקובץ לא נכתב מחדש אחרי שהמונים כבר נשמרו
const stC = queue.readStatus(crash);
queue.archiveDone(crash, stC);
t.check('a task that is already counted is only removed from the queue, never counted or archived twice', stC.done === 1 && (rd(crash, 'archive', 'TASKS-done-1.md').match(/T1 — a/g) || []).length === 1 && !/\[x\] T1/.test(rd(crash, 'TASKS.md')));

// סיבוב קבצי ארכיון
let many = '# Tasks\n\n';
for (let i = 1; i <= 45; i++) many += `- [x] T${i} — t${i}\n  Result: r${i}\n`;
const big = mk('big', many);
queue.ensure(big);
t.check(`the archive rotates after ${queue.ARCHIVE_FILE_MAX} tasks per file (45 tasks: 40 + 5), the counter says 45, the index is one range`, fs.existsSync(path.join(big, '.duo', 'archive', 'TASKS-done-2.md')) && (rd(big, 'archive', 'TASKS-done-1.md').match(/^- \[x\]/gm) || []).length === 40 && (rd(big, 'archive', 'TASKS-done-2.md').match(/^- \[x\]/gm) || []).length === 5 && queue.readStatus(big).done === 45 && /T1-T45/.test(rd(big, 'TASKS.md')));

/* ---------- מעבר מגרסה 1: שיחה ישנה ומשימות שהסתיימו, והמונים בלוח לא משתנים ---------- */
const old = mk('old', '# Tasks\n\n- [x] T1 — one\n  Result: ok\n- [x] T2 — two\n  Result: ok\n- [ ] T3 — three\n  do it\n', '# Chat\n\n### architect · 10:00\nplan\n\n### worker · 10:05\ndone\n');
const before = (() => { const bl2 = taskBlocks(fs.readFileSync(path.join(old, '.duo', 'TASKS.md'), 'utf8')); return { done: bl2.filter((b) => b.status === 'done').length, total: bl2.length }; })();
let n = 0;
const api = { startAgent: () => ({ sessionId: 's' + ++n, claudeId: null }), closeSession() {}, writeInput() {}, claudeIdOf: () => null, emit() {}, persist() {}, log() {}, trustAccepted: () => false };
const d = new Duo({ id: 'q1', project: old, goal: '', permissionMode: 'auto', paused: true }, api);
d.start(true);
const snap = d.snapshot();
t.check('migration: the board counters are exactly what they were (2 of 3 done), the queue file holds only the open task', snap.tasks.counts.done === before.done && snap.tasks.total === before.total && snap.tasks.open === 1 && !/\[x\]/.test(rd(old, 'TASKS.md')), JSON.stringify(snap.tasks.counts));
t.check('migration: the old chat moved to the archive and a backup copy of the chat and the queue was kept', !fs.existsSync(path.join(old, '.duo', 'CHAT.md')) && /plan/.test(rd(old, 'archive', 'CHAT-before-v2.md')) && /### worker/.test(rd(old, 'backup-before-v2', 'CHAT.md')) && /T1 — one/.test(rd(old, 'backup-before-v2', 'TASKS.md')));
t.check('migration: the done tasks the board lists come from the archive record (recent), not from the file', snap.tasks.items.filter((i) => i.status === 'done').map((i) => i.id).join() === 'T1,T2');
d.close();

/* ---------- ארכיון בזמן שהעובד באמצע תור ---------- */
const ib = mk('inbox', '# Tasks\n\n- [ ] T5 — five\n  details here\n');
queue.ensure(ib);
const tasksFile = path.join(ib, '.duo', 'TASKS.md');
fs.writeFileSync(tasksFile, '# Tasks\n\n- [x] T5 — five\n  details here\n- [x] T6 — six\n  details\n  Result: done six\n- [ ] T7 — seven\n');
const stq = queue.readStatus(ib);
const m1 = queue.archiveDone(ib, stq, { ready: (b) => !!b.result });
t.check('archive with a "ready" filter: only the finished task that has its Result line moves; one marked [x] but still without a Result stays in the file', m1.map((m) => m.id).join() === 'T6' && /\[x\] T5 — five/.test(rd(ib, 'TASKS.md')) && !/T6 — six/.test(rd(ib, 'TASKS.md')) && /\[ \] T7/.test(rd(ib, 'TASKS.md')) && /T6 — six[\s\S]*Result: done six/.test(rd(ib, 'archive', 'TASKS-done-1.md')) && stq.done === 1, rd(ib, 'TASKS.md'));
const m2 = queue.archiveDone(ib, stq);
t.check('without the filter (the worker stopped) the rest moves too, and the count is right', m2.map((m) => m.id).join() === 'T5' && stq.done === 2 && !/\[x\]/.test(rd(ib, 'TASKS.md')) && /Done and archived[^\n]*T5-T6/.test(rd(ib, 'TASKS.md')), rd(ib, 'TASKS.md'));
// העובד והארכיטקט עורכים את הקובץ בזמן שהשרת מארכב: אם הקובץ השתנה מאז שהשרת קרא אותו, השרת לא דורס (ולא סופר)
fs.writeFileSync(tasksFile, '# Tasks\n\n- [x] T8 — eight\n  Result: ok\n- [ ] T9 — nine\n');
const st2 = queue.readStatus(ib);
const m3 = queue.archiveDone(ib, st2, { ready: () => { fs.appendFileSync(tasksFile, '- [ ] T10 — added by the architect meanwhile\n'); return true; } });
t.check('a change to the file made while the server archives is never overwritten: nothing moves, nothing is counted, the new task is still there', m3.length === 0 && st2.done === 2 && /T10 — added by the architect meanwhile/.test(rd(ib, 'TASKS.md')) && /\[x\] T8/.test(rd(ib, 'TASKS.md')), rd(ib, 'TASKS.md'));
const m4 = queue.archiveDone(ib, st2);
t.check('...and the next round (the watcher fires on the change) archives it', m4.map((m) => m.id).join() === 'T8' && /T10 — added/.test(rd(ib, 'TASKS.md')));

/* ---------- תיבת הארכיטקט ---------- */
queue.writeArchitectInbox(ib, { users: [{ text: 'please add a login page' }], review: [{ id: 'T1', title: 'a', result: 'did a', status: 'done' }, { id: 'T2', title: 'b', result: 'cannot', status: 'blocked' }], remaining: 3 });
const ai = rd(ib, 'INBOX-architect.md');
t.check('the architect inbox has the user message, the finished tasks with their Result, the blocked ones with the reason, and the queue size', /Message from the user\n\nplease add a login page/.test(ai) && /Finished since your last review[\s\S]*T1 — a\n  Result: did a/.test(ai) && /Blocked tasks[\s\S]*T2 — b\n  Reason: cannot/.test(ai) && /3 open task/.test(ai), ai);

try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* נעול */ }
process.exit(t.finish() ? 0 : 1);
