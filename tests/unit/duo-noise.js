'use strict';
process.env.TG_TEST_BOOT_SETTLE_MS = '1'; process.env.TG_TEST_PENDING_SHOW_MS = '-1';
process.env.TG_TEST_SUBMIT_TIMEOUT_MS = '150'; process.env.TG_TEST_RETRY_MS = '200'; process.env.TG_TEST_DRAFT_CHECK_MS = '40';
// התראות רק כשיש למשתמש מה לעשות (T65): תקלות פנימיות לא מוצגות, ועוברות להתראה אחת רק על התמדה. Duo אמיתי עם api מדומה שלא מגיב (אין hook של submit).
const path = require('path');
const fs = require('fs');
const { TMP, checker } = require('../lib/harness');
const { Duo } = require('../../server/duo/duo');

const t = checker('pair alerts only when they need the user (unit)');
const project = path.join(TMP, 'duo-noise-' + process.pid);
fs.rmSync(project, { recursive: true, force: true });
fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — first\n  Result: ok\n'); // אין משימות פתוחות: רק הארכיטקט מועיר (אחרת גם העובד, שאינו מגיב, מייצר התראה משלו)

let n = 0;
const writes = [];
const logs = [];
const api = { startAgent: () => ({ sessionId: 's' + ++n, claudeId: null }), closeSession() {}, writeInput: (id, d) => writes.push(d), claudeIdOf: () => null, emit() {}, persist() {}, log: (...a) => logs.push(a.join(' ')), trustAccepted: () => false };
const d = new Duo({ id: 'n1', project, goal: '', permissionMode: 'auto', paused: false }, api);
d.start(false);
d.onHook('architect', 'start'); d.onHook('worker', 'start');
const arch = d.agents.architect;
const alerts = () => d.snapshot().alerts;
const tech = () => d.snapshot().tech;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---------- ההוראה אינה מתקבלת: כישלון ראשון ושני בשקט ----------
  d.wake('architect', '[duo] user', {});
  await sleep(400);
  t.check('1st miss: nothing in the alerts, one technical line, one line in the server log, the agent is idle again', alerts().length === 0 && tech().filter((e) => /לא התקבלה \(ניסיון 1\)/.test(e.text)).length === 1 && logs.some((l) => /ניסיון 1/.test(l)) && arch.missed >= 1, JSON.stringify({ a: alerts(), t: tech().map((e) => e.text) }));
  t.check('the activity list has no "not received" line at all (technical lines are separate)', !d.snapshot().events.some((e) => /לא התקבלה/.test(e.text)));
  const waitFor = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(10); } return false; };
  t.check('a REAL retry is made (the old code promised one and never made it): the marker is pasted again', await waitFor(() => writes.filter((w) => /\[duo\] user/.test(w)).length >= 2), String(writes.length));
  t.check('the retry waiting is not shown as "הודעה ממתינה" (that label is for a held-back wake)', d.snapshot().agents.architect.pending === false || arch.pending === null);
  await waitFor(() => arch.missed === 2);
  t.check('after the 2nd miss still nothing is shown', alerts().length === 0 && arch.missed === 2, JSON.stringify({ missed: arch.missed, a: alerts() }));
  await waitFor(() => alerts().length === 1);
  t.check('3 misses in a row: exactly ONE alert, "not responding for N minutes", with an "open the terminal" button', alerts().length === 1 && alerts()[0].key === 'unresponsive:architect' && /לא מגיב להוראות כבר 1 דקה/.test(alerts()[0].text) && alerts()[0].actions.length === 1 && alerts()[0].actions[0].type === 'open' && alerts()[0].actions[0].role === 'architect', JSON.stringify(alerts()));
  const count = writes.filter((w) => /\[duo\] user/.test(w)).length;
  t.check('the wake was really retried (three pastes of the marker so far)', count >= 3, String(count));
  d.onHook('architect', 'submit');
  t.check('a submit (the agent answers) clears the alert and resets the counter', alerts().length === 0 && arch.missed === 0 && arch.missedSince === 0);
  d.onHook('architect', 'stop');
  arch.pending = null; clearTimeout(arch.submitTimer);

  // ---------- חמש דקות בלי תשובה: התראה גם אחרי כישלון אחד ----------
  arch.state = 'idle'; arch.missed = 0; arch.missedSince = Date.now() - 6 * 60 * 1000;
  d.wake('architect', '[duo] user', {});
  await sleep(400);
  t.check('five minutes without any answer promotes the alert even on the first new miss, with the real number of minutes', alerts().length === 1 && /כבר 6 דקות/.test(alerts()[0].text), JSON.stringify(alerts()));
  d.onHook('architect', 'submit'); d.onHook('architect', 'stop');
  arch.pending = null; clearTimeout(arch.submitTimer);

  // ---------- stuck: ה-hook של Stop מחזיר את העובד לעבודה, ורק אחרי שלוש חזרות בלי שינוי בתור הוא נעצר ומתריעים ----------
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [ ] T1 — first\n  do it\n');
  const w = d.agents.worker;
  w.baseline = {}; w.feedSig = d.queueSig();
  d.paused = false; // ה-hook של Stop לא מחזיר עובד לעבודה כשהזוג מושהה (evaluate כבר לא יעיר אותו: ההוראות כאן לא נשלחות לשום מקום)
  const r1 = d.stopDecision(), r2 = d.stopDecision();
  t.check('two stops without progress: the worker is sent back to work, no alert (a technical line at most)', !!r1 && !!r2 && alerts().length === 0);
  const r3 = d.stopDecision();
  d.afterStop('worker');
  t.check('the third is let through and raises one "stuck" alert with "open the worker terminal" and "write a note"', r3 === null && alerts().length === 1 && alerts()[0].key === 'stuck' && alerts()[0].actions.map((a) => a.type).join() === 'open,note' && alerts()[0].actions[0].role === 'worker', JSON.stringify(alerts()));
  t.check('...with a technical line about it', tech().some((e) => /בלי להתקדם/.test(e.text)));
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — first\n  Result: ok\n- [ ] T2 — second\n');
  const r4 = d.stopDecision();
  t.check('when the worker progresses the alert disappears and nothing remains', !!r4 && alerts().length === 0 && w.noProgress === 0 && w.stuckSince === 0);
  d.paused = true;

  // ---------- התראות שכן דורשות את המשתמש יש להן כפתור ----------
  d.onHook('worker', 'notify', { notificationType: 'permission_prompt', message: 'Claude needs your permission' });
  t.check('a permission request has an "open the terminal" button', alerts().some((a) => a.key === 'permission:worker' && a.actions[0].type === 'open' && a.actions[0].role === 'worker'));
  d.onSessionExit('architect');
  t.check('a closed agent has a "restart" button', alerts().some((a) => a.key === 'closed:architect' && a.level === 'error' && a.actions[0].type === 'restart' && a.actions[0].role === 'architect'));
  t.check('the pair status and the summary react only to these alerts (the technical lines are not alerts)', d.snapshot().alerts.every((a) => a.actions && a.actions.length > 0));

  // ---------- "הודעה ממתינה" מוצגת רק אחרי כמה שניות (T65), לא מיד ----------
  d.close();
  try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* נעול */ }
  process.exit(t.finish() ? 0 : 1);
})();
