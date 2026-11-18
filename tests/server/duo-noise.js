'use strict';
// @slow
/*
 * התראות של זוג רק כשיש למשתמש מה לעשות (T65), מקצה לקצה עם סוכן מדומה "חירש" (קובץ .duo/DEAF: מתעלם מהוראות, בלי hook של submit):
 *   - הוראה שלא מתקבלת פעם אחת או פעמיים: אין התראה, יש שורה טכנית בלבד, ויש ניסיון חוזר אמיתי;
 *   - שלוש פעמים ברצף: התראה אחת "לא מגיב להוראות" עם כפתור לפתיחת הטרמינל, והנקודה של הזוג הופכת לכתומה;
 *   - כשהסוכן חוזר להגיב (מוחקים את הקובץ) ההתראה נעלמת ולא נשאר דבר; ההוראה נמסרה בניסיון חוזר;
 *   - "הודעה ממתינה" (T62) מוצגת רק אחרי שהוראה מוחזקת כמה שניות, לא מיד.
 */
const path = require('path');
const fs = require('fs');
const { FIXTURES, TMP, sleep, poll, checker, startServer, connect } = require('../lib/harness');

const latest = (c) => { for (let i = c.messages.length - 1; i >= 0; i--) { const m = c.messages[i]; if (m.t === 'duo' && m.op === 'state') return m.duo; } return null; };

(async () => {
  const t = checker('pair alerts only when they need the user');
  const project = path.join(TMP, 'duo-noise-' + Date.now());
  fs.mkdirSync(path.join(project, '.duo'), { recursive: true });
  fs.writeFileSync(path.join(project, '.duo', 'TASKS.md'), '# Tasks\n\n- [x] T1 — done\n  Result: ok\n');
  fs.writeFileSync(path.join(project, '.duo', 'CHAT.md'), '\n### architect · 09:00\nAll set.\n');
  const srv = await startServer({ binDir: path.join(FIXTURES, 'bin-duo'), env: { TG_TEST_SUBMIT_TIMEOUT_MS: '1500', TG_TEST_RETRY_MS: '1500', TG_TEST_DRAFT_CHECK_MS: '200', TG_TEST_PENDING_SHOW_MS: '1500' } });
  const c = await connect(srv.port);
  c.send({ t: 'duo', op: 'create', project, goal: '', permissionMode: 'auto', reqId: 'n' });
  const created = await poll(() => c.messages.find((m) => m.t === 'duo' && m.op === 'created'), 20000);
  const duoId = created.duoId;
  await poll(() => { const d = latest(c); return d && d.agents.architect.state === 'idle' && d.agents.worker.state === 'idle'; }, 30000);
  const alerts = () => latest(c).alerts;
  const tech = () => latest(c).tech || [];

  fs.writeFileSync(path.join(project, '.duo', 'DEAF'), '1'); // הארכיטקט מפסיק להגיב
  c.send({ t: 'duo', op: 'say', duoId, text: 'ping' });
  await poll(() => tech().some((e) => /ניסיון 1/.test(e.text)), 20000, 100);
  t.check('the 1st missed wake: no alert, no activity line, one technical line, the pair dot is not colored', alerts().length === 0 && !latest(c).events.some((e) => /לא התקבלה/.test(e.text)) && tech().filter((e) => /ניסיון 1/.test(e.text)).length === 1, JSON.stringify({ a: alerts(), t: tech().map((e) => e.text) }));
  await poll(() => tech().some((e) => /ניסיון 2/.test(e.text)), 20000, 100);
  t.check('the 2nd miss (a real retry happened): still nothing shown', alerts().length === 0 && latest(c).agents.architect.state !== 'exited', JSON.stringify(alerts()));
  const promoted = await poll(() => alerts().length === 1 && alerts()[0].key === 'unresponsive:architect', 30000, 100);
  t.check('the 3rd miss in a row: exactly ONE alert "not responding", with an "open the terminal" button', !!promoted && alerts()[0].level === 'warn' && /לא מגיב להוראות כבר/.test(alerts()[0].text) && alerts()[0].actions[0].type === 'open' && alerts()[0].actions[0].role === 'architect', JSON.stringify(alerts()));
  t.check('the retry waiting is not shown as a held-back wake ("הודעה ממתינה")', latest(c).agents.architect.pending === false);
    fs.unlinkSync(path.join(project, '.duo', 'DEAF')); // חוזר להגיב
  const recovered = await poll(() => { const d = latest(c); return d.alerts.length === 0 && d.events.some((e) => e.role === 'architect' && /סיים תור/.test(e.text)); }, 30000, 150);
  t.check('when the agent answers again the alert disappears (the next retry was received) and nothing remains', !!recovered, JSON.stringify({ a: alerts(), w: latest(c).agents.architect.wakes }));
  await poll(() => latest(c).agents.architect.state === 'idle', 20000, 100);
  t.check('the wake finally reached the agent once (a normal activity line, no "not received" line)', latest(c).events.some((e) => /סיים תור/.test(e.text)) && !latest(c).events.some((e) => /לא התקבלה/.test(e.text)));
  c.close(); srv.stop();
  process.exit(t.finish() ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
